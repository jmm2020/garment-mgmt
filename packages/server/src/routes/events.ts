import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { bus, type TransitionEvent } from "../events/bus.js";

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/stream", { preHandler: requireAuth() }, async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    const write = (chunk: string) => {
      if (!reply.raw.writableEnded) reply.raw.write(chunk);
    };

    const onTransition = (event: TransitionEvent) => {
      write(`event: transition\ndata: ${JSON.stringify(event)}\n\n`);
    };

    bus.on("transition", onTransition);
    const pingTimer = setInterval(() => write(": ping\n\n"), 25_000);

    // Await client disconnect; clean up listeners on close.
    await new Promise<void>((resolve) => req.raw.once("close", resolve));

    clearInterval(pingTimer);
    bus.off("transition", onTransition);
    if (!reply.raw.writableEnded) reply.raw.end();
  });
}
