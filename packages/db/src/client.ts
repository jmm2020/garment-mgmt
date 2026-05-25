import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };
export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type DbExecutor = Database | DbTransaction;

let cached: { sql: postgres.Sql; db: Database } | null = null;

export function createDb(
  url: string,
  options: { max?: number } = {},
): {
  sql: postgres.Sql;
  db: Database;
} {
  const sql = postgres(url, { max: options.max ?? 20 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export function getDb(url?: string): Database {
  if (cached) return cached.db;
  const resolved = url ?? process.env.DATABASE_URL;
  if (!resolved) throw new Error("DATABASE_URL not set");
  cached = createDb(resolved);
  return cached.db;
}

export function getSql(url?: string): postgres.Sql {
  if (cached) return cached.sql;
  const resolved = url ?? process.env.DATABASE_URL;
  if (!resolved) throw new Error("DATABASE_URL not set");
  cached = createDb(resolved);
  return cached.sql;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.sql.end({ timeout: 5 });
    cached = null;
  }
}
