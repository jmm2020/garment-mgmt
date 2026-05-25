import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
