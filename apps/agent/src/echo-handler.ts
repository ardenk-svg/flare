import type { InboundMessageHandler } from "./types.js";

const MAX_ECHO_CHARACTERS = 500;

/** First integration slice: a visibly simulated echo through every configured provider. */
export const handleEcho: InboundMessageHandler = async (message, reply) => {
  const clipped =
    message.text.length > MAX_ECHO_CHARACTERS
      ? `${message.text.slice(0, MAX_ECHO_CHARACTERS)}…`
      : message.text;

  await reply.send(`Simulation: received your message: ${clipped}`);
};
