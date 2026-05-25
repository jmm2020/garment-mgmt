import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  console.log(`[migrate] applying migrations to ${redact(url)}`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done");

  await sql.end({ timeout: 5 });
}

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+):[^@]+@/, "$1:***@");
}

main().catch((err) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});
