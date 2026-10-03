export interface AgentConfig {
  spacetimeUri: string;
  spacetimeDatabase: string;
  spacetimeToken?: string;
  notificationPollMs: number;
  notificationMaxAttempts: number;
}

function required(name: "SPACETIMEDB_URI" | "SPACETIMEDB_DATABASE"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to start the integrated Flare agent.`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function readAgentConfig(): AgentConfig {
  const token = process.env.SPACETIMEDB_AGENT_TOKEN?.trim();
  return {
    spacetimeUri: required("SPACETIMEDB_URI"),
    spacetimeDatabase: required("SPACETIMEDB_DATABASE"),
    ...(token ? { spacetimeToken: token } : {}),
    notificationPollMs: positiveInteger("FLARE_NOTIFICATION_POLL_MS", 2_000),
    notificationMaxAttempts: positiveInteger("FLARE_NOTIFICATION_MAX_ATTEMPTS", 5),
  };
}
