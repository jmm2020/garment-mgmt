import type { schema } from "@garment-mgmt/db";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { AuthError } from "../errors.js";
import { getCurrentUser, type SessionUser } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: SessionUser;
  }
}

export function requireAuth(roles?: schema.UserRole[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const userId = req.session.userId;
    if (!userId) throw new AuthError("unauthorized", "Authentication required");
    const user = await getCurrentUser(req.db, userId);
    if (!user) throw new AuthError("unauthorized", "Session invalid");
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw new AuthError("forbidden", `Requires role: ${roles.join(", ")}`);
    }
    req.currentUser = user;
  };
}
