import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { authenticate, getCurrentUser } from "../auth/session.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (req) => {
    const body = loginSchema.parse(req.body);
    const user = await authenticate(req.db, body.email, body.password);
    req.session.userId = user.id;
    return { user };
  });

  app.post("/logout", async (req, reply) => {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth() }, async (req) => {
    const user = await getCurrentUser(req.db, req.session.userId);
    return { user };
  });
}
