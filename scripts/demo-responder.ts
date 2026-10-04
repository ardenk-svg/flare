import { createServer } from "node:http";

export const DEMO_UNITS = ["FIRE-01", "FIRE-02", "EMS-01", "EMS-02", "POLICE-01", "POLICE-02"];

/** Temporary loopback-only role bridge for the single responder demo tab. */
export async function startDemoResponderServer(options: {
  key: string;
  origin: string;
  authorize(identity: string, unit: string): void;
}): Promise<{ port: number; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const finish = (status: number) => { res.writeHead(status); res.end(); };
    if (req.url !== "/__flare_demo/responder" || req.method !== "POST") return finish(404);
    if (req.headers["x-flare-demo-key"] !== options.key || req.headers.origin !== options.origin) return finish(403);
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024) { finish(413); req.destroy(); }
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try {
        const { identity, unit } = JSON.parse(body);
        if (typeof identity !== "string" || !/^[0-9a-f]{64}$/i.test(identity) || !DEMO_UNITS.includes(unit)) return finish(400);
        options.authorize(identity.toLowerCase(), unit);
        finish(204);
      } catch { finish(403); }
    });
    req.on("error", () => { if (!res.writableEnded) finish(400); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Demo responder bridge did not bind a local port.");
  return { port: address.port, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}
