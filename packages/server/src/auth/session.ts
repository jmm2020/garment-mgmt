import { schema, type Database } from "@garment-mgmt/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "../errors.js";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: schema.UserRole;
}

// Real bcrypt hash of an unguessable string. Used when no user matches so
// bcrypt.compare runs its full cost-10 KDF on every authenticate call,
// keeping the user-miss path on the same timing budget as a wrong-password hit.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("__no_user_dummy_password__", 10);

export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<SessionUser> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const ok = await bcrypt.compare(password, hash);
  if (!user || user.status !== "active" || !ok) {
    throw new AuthError("invalid_credentials", "Invalid email or password");
  }

  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function getCurrentUser(
  db: Database,
  userId: number | undefined,
): Promise<SessionUser | null> {
  if (!userId) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.status !== "active") return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
