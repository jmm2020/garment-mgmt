import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { createDb, type Database } from "@garment-mgmt/db";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { env, type Env } from "./env.js";
import { isDomainError } from "./errors.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBatchRoutes } from "./routes/batches.js";
import { registerBomRoutes } from "./routes/boms.js";
import { registerCutTicketRoutes } from "./routes/cut-tickets.js";
import { registerLotRoutes } from "./routes/lots.js";
import { registerMaterialRoutes } from "./routes/materials.js";
import { registerPoRoutes } from "./routes/pos.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerPvtRoutes, registerPvtStatusRoute } from "./routes/pvt.js";
import { registerBatchUnitRoutes, registerUnitRoutes } from "./routes/units.js";
import { registerVendorRoutes } from "./routes/vendors.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

declare module "fastify" {
  interface FastifyRequest {
    db: Database;
  }
}

declare module "@fastify/session" {
  interface FastifySessionObject {
    userId?: number;
  }
}

export interface AppOptions {
  db?: Database;
  envOverrides?: Partial<Env>;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const config = { ...env(), ...opts.envOverrides };
  const database = opts.db ?? createDb(config.DATABASE_URL).db;

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "warn" : "info",
    },
  });

  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET,
    cookieName: "gm_sid",
    cookie: {
      secure: config.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    },
    saveUninitialized: false,
  });

  app.addHook("onRequest", async (req) => {
    req.db = database;
  });

  app.setErrorHandler((err, req, reply) => {
    if (isDomainError(err)) {
      void reply.status(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err instanceof ZodError) {
      void reply.status(400).send({
        error: {
          code: "validation_failed",
          message: "Invalid input",
          details: err.issues,
        },
      });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.status(500).send({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(registerAuthRoutes, { prefix: "/auth" });
  await app.register(registerVendorRoutes, { prefix: "/api/vendors" });
  await app.register(registerMaterialRoutes, { prefix: "/api/materials" });
  await app.register(registerProductRoutes, { prefix: "/api/products" });
  await app.register(registerPvtStatusRoute, { prefix: "/api/products" });
  await app.register(registerPoRoutes, { prefix: "/api/pos" });
  await app.register(registerLotRoutes, { prefix: "/api/lots" });
  await app.register(registerBomRoutes, { prefix: "/api/boms" });
  await app.register(registerCutTicketRoutes, { prefix: "/api/cut-tickets" });
  await app.register(registerBatchRoutes, { prefix: "/api/batches" });
  await app.register(registerBatchUnitRoutes, { prefix: "/api/batches" });
  await app.register(registerUnitRoutes, { prefix: "/api/units" });
  await app.register(registerPvtRoutes, { prefix: "/api/pvt" });
  await app.register(registerWebhookRoutes, { prefix: "/webhooks/shopify" });

  return app;
}
