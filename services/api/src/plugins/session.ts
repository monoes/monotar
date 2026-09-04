import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { loadEnv } from "@monotar/config";
import { prisma } from "../db";
import type { OrganizationRole } from "@prisma/client";

export interface CurrentUser {
  id: string;
  email: string;
  organizationId: string;
  role: OrganizationRole;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
}

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function resolveCurrentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const env = loadEnv();
  const sessionValue = request.cookies[env.sessionCookieName];
  if (!sessionValue) return null;

  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: hashSessionValue(sessionValue) },
    include: { user: { include: { organizationMembers: true } } },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }

  const membership = session.user.organizationMembers[0];
  if (!membership) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("currentUser", null);
  app.addHook("preHandler", async (request) => {
    request.currentUser = await resolveCurrentUser(request);
  });
});
