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

export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<SessionUser> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  // Constant-time guard: still hash a dummy on miss so timing leaks user existence less.
  const hash =
    user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid";
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
