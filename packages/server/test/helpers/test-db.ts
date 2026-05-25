import { createDb, type Database } from "@garment-mgmt/db";
import postgres from "postgres";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://dev:dev@localhost:5432/garment_mgmt_test";

let sharedSql: postgres.Sql | null = null;
let sharedDb: Database | null = null;

function getSharedDb(): Database {
  if (!sharedDb) {
    const { sql, db } = createDb(TEST_URL, { max: 5 });
    sharedSql = sql;
    sharedDb = db;
  }
  return sharedDb;
}

export async function closeTestDb(): Promise<void> {
  if (sharedSql) {
    await sharedSql.end({ timeout: 5 });
    sharedSql = null;
    sharedDb = null;
  }
}

/**
 * Runs the callback inside a transaction that is always rolled back.
 * Each test gets clean state without truncate overhead.
 */
export async function withTestDb<T>(cb: (db: Database) => Promise<T>): Promise<T> {
  const db = getSharedDb();
  let result: T | undefined;
  let captured: unknown;
  let didThrow = false;
  try {
    await db.transaction(async (tx) => {
      try {
        result = await cb(tx as unknown as Database);
      } catch (err) {
        captured = err;
        didThrow = true;
      }
      throw new Error("__ROLLBACK__");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "__ROLLBACK__") throw err;
  }
  if (didThrow) throw captured;
  return result as T;
}
