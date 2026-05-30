import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { AuthError, ValidationFailedError } from "../errors.js";
import { processOrderWebhook } from "../services/shopify-webhook-service.js";

// Shopify's `id` and `line_items[].id` may serialize as JSON numbers in older API
// versions and as strings in newer ones; normalize to string so downstream code never
// risks Number.MAX_SAFE_INTEGER loss on large order IDs.
const shopifyIdScalar = z.union([z.string(), z.number()]).transform(String);

const shopifyLineItemSchema = z.object({
  id: shopifyIdScalar,
  sku: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
});

const shopifyOrderSchema = z.object({
  id: shopifyIdScalar,
  line_items: z.array(shopifyLineItemSchema),
});

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Capture the raw request body for HMAC verification. Fastify encapsulation scopes
  // this parser to the plugin only — /api/* routes still use the default JSON parser.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/orders", async (req, reply) => {
    const rawBody = req.body as Buffer;
    const cfg = env();
    const secret = cfg.SHOPIFY_WEBHOOK_SECRET;
    if (secret) {
      const header = (req.headers["x-shopify-hmac-sha256"] as string | undefined) ?? "";
      if (!verifyHmac(rawBody, secret, header)) {
        throw new AuthError("unauthorized", "hmac_verification_failed");
      }
    }

    let parsed: z.infer<typeof shopifyOrderSchema>;
    try {
      const json = JSON.parse(rawBody.toString("utf-8")) as unknown;
      parsed = shopifyOrderSchema.parse(json);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new ValidationFailedError("invalid_json_body");
      }
      throw err;
    }

    await processOrderWebhook(req.db, parsed, req.log);
    return reply.status(200).send({ ok: true });
  });
}

function verifyHmac(rawBody: Buffer, secret: string, header: string): boolean {
  if (!header) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    const headerBytes = Buffer.from(header, "base64");
    const computedBytes = Buffer.from(computed, "base64");
    if (headerBytes.length !== computedBytes.length) return false;
    return timingSafeEqual(headerBytes, computedBytes);
  } catch {
    return false;
  }
}
