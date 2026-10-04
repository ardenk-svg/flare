// Local end-to-end runner for Flare. Uses spacetime on PATH or FLARE_SPACETIME_BIN.
//
//   npm run e2e               phone demo: database, agent, web app, browser tabs with roles granted
//   npm run e2e:auto          scripted loop with fixture extraction and fake transport
//   npm run e2e:auto -- --live-gemini   use Gemini instead of fixtures
//   npm run e2e -- grant dispatcher|responder <identity> [unit]
//   npm run e2e -- reset      clear local incidents and messages; role grants are kept
//
// Flags: --keep (skip reset_demo), --wipe (republish with --delete-data), --live-gemini,
//        --no-agent (database and web only), --no-open (print the tab URLs instead of opening them).
// Env:   FLARE_DB_PORT, FLARE_WEB_PORT, FLARE_DB, FLARE_DB_DATA_DIR, FLARE_TMP, FLARE_AGENT_STATE_PATH.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { connectFlare } from "@flare/data";
import { configureSpacetimeCli } from "./spacetime-cli.js";
import { startDemoResponderServer } from "./demo-responder.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = resolve(process.env.FLARE_TMP ?? join(ROOT, ".flare/e2e"));
const SPACETIME = configureSpacetimeCli();
const DB_PORT = Number(process.env.FLARE_DB_PORT ?? 3000);
const WEB_PORT = Number(process.env.FLARE_WEB_PORT ?? 5173);
const DB = process.env.FLARE_DB ?? "flare-dev";
const DATA_DIR = resolve(process.env.FLARE_DB_DATA_DIR ?? join(TMP, "database"));
const AGENT_STATE = resolve(process.env.FLARE_AGENT_STATE_PATH ?? join(TMP, "agent-state-local.json"));
// The scripted loop mints its own agent; keep it away from the phone agent's identity file.
const HARNESS_STATE = join(TMP, "agent-state-harness.json");
const SERVER = `http://127.0.0.1:${DB_PORT}`;
const WS = `ws://127.0.0.1:${DB_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const LOG_DIR = join(ROOT, ".flare/logs");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const [command = "up", ...rest] = args.filter((arg) => !arg.startsWith("--"));
if (![DB_PORT, WEB_PORT].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error("FLARE_DB_PORT and FLARE_WEB_PORT must be valid TCP ports.");
}

// ---- Output ----

class Abort extends Error {}
const abort = (message: string): never => {
  throw new Abort(message);
};
const step = (text: string) => console.log(`\n▸ ${text}`);
const note = (text: string) => console.log(`  ${text}`);
const tail = (text: string, lines = 15) => text.trimEnd().split("\n").slice(-lines).map((l) => `    ${l}`).join("\n");
const short = (hex: string) => `${hex.slice(0, 8)}…`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- SpacetimeDB CLI ----

function stdb(...cliArgs: string[]): string {
  try {
    return execFileSync(SPACETIME, cliArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    throw new Error(`spacetime ${cliArgs[0]} failed:\n${tail(`${stdout}${stderr}`)}`);
  }
}
const call = (...reducerArgs: string[]) => stdb("call", "--server", SERVER, DB, ...reducerArgs);

function sql(query: string): string[][] {
  const lines = stdb("sql", "--server", SERVER, DB, query).split("\n");
  const header = lines.findIndex((line) => /^[-+]+$/.test(line.trim()));
  return lines
    .slice(header + 1)
    .filter((line) => line.trim())
    .map((line) => line.split("|").map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

const roleOf = (hex: string): string | undefined => sql(`SELECT role FROM role_grant WHERE identity = 0x${hex}`)[0]?.[0];
const unitOf = (hex: string): string | undefined => sql(`SELECT unit_id FROM role_grant WHERE identity = 0x${hex}`)[0]?.[0];

function grant(hex: string, role: string, unit?: string): void {
  call("grant_role", hex, role, unit ? JSON.stringify({ some: unit }) : '{"none":[]}');
}

/** Clients connected right now. `st_client` reports identities as decimal u256. */
function connections(): Array<{ hex: string; connectionId: string }> {
  return sql("SELECT identity, connection_id FROM st_client").map(([identity, connectionId]) => ({
    hex: BigInt(identity!).toString(16).padStart(64, "0"),
    connectionId: connectionId!,
  }));
}

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

// ---- Background services ----

interface Service {
  name: string;
  child: ChildProcess;
  output: string[];
  /** Once ready, an unexpected exit stops the whole run. */
  watched: boolean;
  echo: boolean;
}
const services: Service[] = [];
const exited = (s: Service) => s.child.exitCode !== null || s.child.signalCode !== null;
let shuttingDown = false;
let shutdownTask: Promise<never> | undefined;
let responderServer: Awaited<ReturnType<typeof startDemoResponderServer>> | undefined;

function startService(name: string, file: string, fileArgs: string[], cwd: string, env: Record<string, string>): Service {
  if (shuttingDown) abort("Demo is stopping.");
  mkdirSync(LOG_DIR, { recursive: true });
  const log = createWriteStream(join(LOG_DIR, `${name.replace(/\W+/g, "-")}.log`));
  // Own process group, so Ctrl+C reaches only this script and shutdown can stop each tree in order.
  const child = spawn(file, fileArgs, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const service: Service = { name, child, output: [], watched: false, echo: false };
  const onData = (chunk: Buffer) => {
    log.write(chunk);
    const text = chunk.toString();
    service.output.push(text);
    if (service.output.length > 300) service.output.shift();
    if (service.echo) for (const line of text.split("\n")) if (line.trim()) console.log(`  ${name} │ ${line}`);
  };
  child.stdout!.on("data", onData);
  child.stderr!.on("data", onData);
  child.on("exit", () => {
    log.end();
    if (!service.watched || shuttingDown) return;
    console.error(`\n✗ The ${name} stopped unexpectedly. Last output:\n${tail(service.output.join(""))}`);
    void shutdown(1);
  });
  child.on("error", error => {
    service.output.push(error.message);
    log.end();
  });
  services.push(service);
  return service;
}

async function ready(service: Service, check: () => boolean | Promise<boolean>, seconds: number): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (shuttingDown) abort("Demo is stopping.");
    if (await check()) {
      service.watched = true;
      return;
    }
    if (exited(service)) abort(`The ${service.name} stopped during startup. Last output:\n${tail(service.output.join(""))}`);
    await sleep(250);
  }
  abort(`The ${service.name} wasn't ready after ${seconds}s. Last output:\n${tail(service.output.join(""))}`);
}

async function stopService(service: Service): Promise<void> {
  if (exited(service)) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-service.child.pid!, signal);
    } catch {
      // Already gone.
    }
  };
  signalGroup("SIGTERM");
  for (let i = 0; i < 40 && !exited(service); i++) await sleep(125);
  if (!exited(service)) signalGroup("SIGKILL");
}

function shutdown(code: number): Promise<never> {
  // npm and the terminal may both forward SIGINT. Every interrupt must await
  // the same cleanup rather than letting a second call exit halfway through.
  return shutdownTask ??= (async () => {
    shuttingDown = true;
    await responderServer?.close();
    if (services.some((s) => !exited(s))) {
      step("Stopping");
      for (const service of [...services].reverse()) {
        await stopService(service);
        note(`${service.name} stopped`);
      }
    }
    process.exit(code);
  })();
}

// ---- Steps ----

function runningImessageAgents(): string[] {
  try {
    return execFileSync("pgrep", ["-f", "src/imessage(-echo)?\\.ts"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function installIfStale(dir: string, label: string, npmArgs: string[]): void {
  const lock = join(dir, "package-lock.json");
  const installed = join(dir, "node_modules/.package-lock.json");
  if (existsSync(installed) && statSync(installed).mtimeMs >= statSync(lock).mtimeMs) return;
  note(`Installing ${label} dependencies…`);
  try {
    execFileSync("npm", npmArgs, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: Buffer; stderr?: Buffer };
    abort(`npm ${npmArgs.join(" ")} failed:\n${tail(`${stdout}${stderr}`)}`);
  }
}

async function prepare(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  try { execFileSync(SPACETIME, ["--version"], { stdio: "pipe" }); }
  catch { abort("SpacetimeDB CLI unavailable. Put spacetime on PATH or set FLARE_SPACETIME_BIN in .env to its executable path."); }
  installIfStale(ROOT, "app", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  installIfStale(join(ROOT, "spacetime"), "database module", ["run", "install:module"]);

  step("Database");
  if (await reachable(`${SERVER}/v1/ping`)) {
    note(`Using the database that's already running on port ${DB_PORT}.`);
  } else {
    const db = startService("database", SPACETIME, ["start", "--listen-addr", `127.0.0.1:${DB_PORT}`, ...(DATA_DIR ? ["--data-dir", DATA_DIR] : [])], ROOT, {});
    await ready(db, () => reachable(`${SERVER}/v1/ping`), 30);
    note(`Started on port ${DB_PORT}.`);
  }

  note("Publishing the module…");
  try {
    stdb("publish", "--server", SERVER, "--module-path", join(ROOT, "spacetime"), DB, "--yes", ...(flags.has("--wipe") ? ["--delete-data"] : []));
  } catch (error) {
    abort(`${(error as Error).message}\n  If the schema changed in a way that can't be applied in place, rerun with --wipe.\n  That erases the local database, including role grants; this script grants them again.`);
  }
  note(flags.has("--wipe") ? "Published with a fresh, empty database." : "Published.");
}

async function ensureAgentRole(): Promise<void> {
  const state: Record<string, unknown> = existsSync(AGENT_STATE) ? JSON.parse(readFileSync(AGENT_STATE, "utf8")) : {};
  const created = await connectFlare({ uri: WS, database: DB, token: typeof state.spacetimeToken === "string" ? state.spacetimeToken : undefined });
  const token = created.token;
  const hex = created.identityHex;
  created.conn.disconnect();
  const routes = state.routes && typeof state.routes === "object" ? state.routes : {};
  mkdirSync(dirname(AGENT_STATE), { recursive: true });
  writeFileSync(AGENT_STATE, `${JSON.stringify({ ...state, version: 1, spacetimeToken: token, routes }, null, 2)}\n`, { mode: 0o600 });

  if (roleOf(hex) === "AGENT") return note(`Agent identity ${short(hex)} has the AGENT role.`);
  grant(hex, "AGENT");
  note(`Granted AGENT to agent identity ${short(hex)}.`);
}

/**
 * Opens one view and grants its role to the identity that connects from it. Tabs left open from an
 * earlier run reconnect on their own, so only a new connection with no role, or with this role, counts.
 */
function openView(path: string): void {
  const url = `${WEB}${path}`;
  if (flags.has("--no-open")) note(`Open ${url}`);
  else if (process.platform === "darwin") execFileSync("open", [url]);
  else if (process.platform === "win32") execFileSync("explorer.exe", [url]);
  else execFileSync("xdg-open", [url]);
}

async function openAndGrant(path: string, role: "DISPATCHER" | "RESPONDER", unit?: string): Promise<void> {
  const url = `${WEB}${path}`;
  const before = new Set(connections().map((c) => c.connectionId));
  openView(path);

  let deadline = Date.now() + (flags.has("--no-open") ? 300_000 : 30_000);
  let alreadyGranted: string | undefined;
  while (Date.now() < deadline) {
    if (shuttingDown) return;
    await sleep(400);
    for (const hex of new Set(connections().filter((c) => !before.has(c.connectionId)).map((c) => c.hex))) {
      const current = roleOf(hex);
      if (!current) {
        grant(hex, role, unit);
        return note(`${path}: granted ${role}${unit ? ` for ${unit}` : ""} to identity ${short(hex)}.`);
      }
      if (current === role && (!unit || unitOf(hex) === unit) && !alreadyGranted) {
        alreadyGranted = hex;
        // A brand-new identity may still be connecting from the tab just opened.
        deadline = Math.min(deadline, Date.now() + 4000);
      }
    }
  }
  if (alreadyGranted) return note(`${path}: identity ${short(alreadyGranted)} already has ${role}.`);
  note(`No new tab connected from ${url}. If it says "no role", run: npm run e2e -- grant ${role.toLowerCase()} <identity>`);
}

function printPhoneSteps(): void {
  console.log(`
▸ Ready. From your registered phone, text the Photon number:
    1. "Simulation: I see smoke outside."     the agent asks a question; the incident appears
    2. Send My Current Location or an Apple Maps pin link  the console shows the pin
    3. Dispatcher tab: confirm FIRE, assign FIRE-01        you get a dispatch text
    4. Responder tab: Accept, then En route                you get an en-route text
    5. Text "Any update?"                      you get a status reply
    6. Responder: On scene, Completed. Dispatcher: Resolve
    7. Text a new report                       it opens a brand-new incident

  Dispatcher ${WEB}/dispatcher   Responder ${WEB}/responder
  Use Restart demo in the dispatcher to rehearse again without stopping.
  Logs in .flare/logs/. Press Ctrl+C to stop everything.
`);
}

// ---- Commands ----

async function up(): Promise<void> {
  const withAgent = !flags.has("--no-agent");
  if (withAgent) {
    const others = runningImessageAgents();
    if (others.length) {
      abort(`Another Flare iMessage agent is already running (pid ${others.join(", ")}).\n  Stop it first (Ctrl+C in its terminal); two agents on one Photon project split your texts.`);
    }
  }
  await prepare();
  if (!flags.has("--keep")) {
    call("reset_demo");
    note("Cleared old incidents and messages (role grants kept).");
  }

  let agent: Service | undefined;
  if (withAgent) {
    step("iMessage agent");
    await ensureAgentRole();
    agent = startService("agent", process.execPath, ["--env-file-if-exists=../../.env", "--import", "tsx", "src/imessage.ts"], join(ROOT, "apps/agent"), {
      SPACETIMEDB_URI: WS,
      SPACETIMEDB_DATABASE: DB,
      SPACETIMEDB_AGENT_TOKEN: "",
      FLARE_AGENT_STATE_PATH: AGENT_STATE,
      FLARE_NOTIFICATION_POLL_MS: "1000",
    });
    await ready(agent, () => /Flare agent is listening/.test(agent!.output.join("")), 60);
    note("Connected to Photon and the database.");
  }

  step("Web app");
  const responderKey = randomUUID();
  responderServer = await startDemoResponderServer({ key: responderKey, origin: WEB, restart: hex => {
    if (shuttingDown || !connections().some(c => c.hex === hex) || roleOf(hex) !== 'DISPATCHER') throw new Error('Only a connected local dispatcher can restart the demo.');
    call('restart_demo');
    note('Demo restarted. Same tabs and phone thread; send a new report.');
  }, authorize: (hex, unit) => {
    if (shuttingDown || !connections().some(c => c.hex === hex)) throw new Error("Responder must be connected to this local demo.");
    const role = roleOf(hex);
    if (role === "RESPONDER" && unitOf(hex) === unit) return;
    if (role) throw new Error("An existing role cannot be replaced by the demo bridge.");
    grant(hex, "RESPONDER", unit);
    note(`Responder dropdown: authorized ${unit}.`);
  } });
  const web = startService("web app", join(ROOT, "node_modules/.bin/vite"), ["--port", String(WEB_PORT), "--strictPort"], join(ROOT, "apps/web"), {
    VITE_DATA_MODE: "live",
    VITE_SPACETIMEDB_URI: WS,
    VITE_SPACETIMEDB_DATABASE: DB,
    FLARE_DEMO_GRANT_SERVER: `http://127.0.0.1:${responderServer.port}`,
    VITE_FLARE_DEMO_GRANT_KEY: responderKey,
  });
  await ready(web, () => reachable(WEB), 30);
  note(`Serving ${WEB}`);

  step("Dispatcher and responder tabs");
  await openAndGrant("/dispatcher", "DISPATCHER");
  // The responder bridge knows the selected unit. A connection-wide polling
  // grant here could assign FIRE-01 to a freshly selected EMS/Police identity.
  openView("/responder");
  note("Use the responder Unit dropdown for Fire, EMS or Police; no extra tabs are opened.");

  if (agent) {
    printPhoneSteps();
    agent.echo = true;
  } else {
    console.log(`\n▸ Ready without an agent. Press Ctrl+C to stop.\n`);
  }
  await new Promise(() => setInterval(() => {}, 60_000));
}

async function auto(): Promise<void> {
  await prepare();
  if (connections().some((c) => roleOf(c.hex) === "AGENT")) {
    abort("An agent is connected to this database. Stop it first: the scripted loop wipes the database and runs its own agent.");
  }
  step(`Scripted loop (real agent and database; ${flags.has("--live-gemini") ? "Gemini" : "fixture extraction"}; fake message transport)`);
  const code = await new Promise<number>((done) => {
    spawn(process.execPath, ["--env-file-if-exists=.env", "--import", "tsx", "scripts/loop-harness.ts", ...(flags.has("--live-gemini") ? ["--live-gemini"] : [])], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        SPACETIME_SERVER: SERVER,
        SPACETIMEDB_URI: WS,
        SPACETIMEDB_DATABASE: DB,
        SPACETIMEDB_AGENT_TOKEN: "",
        FLARE_AGENT_STATE_PATH: HARNESS_STATE,
        FLARE_NOTIFICATION_POLL_MS: "1000",
      },
    }).on("exit", (exitCode) => done(exitCode ?? 1)).on("error", () => done(1));
  });
  await shutdown(code);
}

async function requireDatabase(): Promise<void> {
  if (!(await reachable(`${SERVER}/v1/ping`))) abort(`No database is running on port ${DB_PORT}. Start the stack first.`);
}

async function grantCommand(): Promise<void> {
  const [who, identity, unit = "FIRE-01"] = rest;
  const role = who?.toUpperCase();
  if ((role !== "DISPATCHER" && role !== "RESPONDER") || !/^(0x)?[0-9a-f]{64}$/i.test(identity ?? "")) {
    abort("Usage: npm run e2e -- grant dispatcher|responder <identity> [unit]");
  }
  await requireDatabase();
  const hex = identity!.replace(/^0x/i, "").toLowerCase();
  grant(hex, role!, role === "RESPONDER" ? unit : undefined);
  note(`Granted ${role}${role === "RESPONDER" ? ` for ${unit}` : ""} to ${short(hex)}.`);
}

async function resetCommand(): Promise<void> {
  await requireDatabase();
  call("reset_demo");
  note("Cleared incidents and messages; role grants kept.");
}

const commands: Record<string, () => Promise<void>> = { up, auto, grant: grantCommand, reset: resetCommand };

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const run = commands[command];
if (!run) {
  console.error(`Unknown command "${command}". Use: up (default), auto, grant, reset.`);
  process.exit(1);
}
run()
  .then(() => shutdown(0))
  .catch(async (error) => {
    if (!shuttingDown) console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    await shutdown(1);
  });
