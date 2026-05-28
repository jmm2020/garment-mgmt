import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Shopify Admin API push (background job). In test mode the client logs instead of
  // calling — CI never hits the network.
  SHOPIFY_SHOP_DOMAIN: z.string().optional(),
  SHOPIFY_ADMIN_TOKEN: z.string().optional(),
  SHOPIFY_LOCATION_ID: z.string().optional(),
  SHOPIFY_PUSH_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  // HMAC secret for the inbound orders/create webhook. Absent => verification skipped
  // (CI / local dev). Production deployments must set this to match the Shopify app
  // webhook secret.
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  // Per-product override lives on products.pvt_validity_months; this is the fallback.
  PVT_DEFAULT_VALIDITY_MONTHS: z.coerce.number().int().positive().default(6),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error("[env] invalid environment:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    throw new Error("Environment validation failed");
  }
  return result.data;
}

let cachedEnv: Env | null = null;
export function env(): Env {
  if (!cachedEnv) cachedEnv = loadEnv();
  return cachedEnv;
}
