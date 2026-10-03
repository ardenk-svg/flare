import { handleEcho } from "./echo-handler.js";
import { runMessageLoop, type SpectrumAppEnvelope } from "./message-loop.js";

interface StoppableSpectrumApp extends SpectrumAppEnvelope {
  stop(): Promise<void>;
}

export async function runAgent(app: StoppableSpectrumApp): Promise<void> {
  let stopping = false;

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void app.stop().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown shutdown error";
      console.error(`Failed to stop Spectrum cleanly: ${message}`);
    });
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runMessageLoop(app, handleEcho);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
