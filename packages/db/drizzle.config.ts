import type { Config } from "drizzle-kit";

const dbUrl = process.env.DATABASE_URL ?? "postgres://dev:dev@localhost:5432/garment_mgmt";

export default {
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
  strict: true,
  verbose: true,
} satisfies Config;
