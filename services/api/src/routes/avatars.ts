import type { FastifyInstance } from "fastify";
import { CreateAvatarSchema } from "@monotar/contracts";
import { prisma } from "../db";
import { requireRole } from "../rbac";

const canWrite = requireRole("ADMIN");

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.get("/api/avatars", async (request) => {
    const orgId = request.currentUser!.organizationId;
    return prisma.avatar.findMany({ where: { organizationId: orgId } });
  });

  app.get("/api/avatars/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const avatar = await prisma.avatar.findFirst({ where: { id, organizationId: orgId } });
    if (!avatar) return reply.code(404).send({ error: "not_found" });
    return avatar;
  });

  app.post("/api/avatars", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const parsedInput = CreateAvatarSchema.safeParse(request.body);
    if (!parsedInput.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsedInput.error.issues });
    }
    const input = parsedInput.data;
    const orgId = request.currentUser!.organizationId;
    const avatar = await prisma.avatar.create({
      data: { name: input.name, organizationId: orgId, status: "PENDING" },
    });
    return reply.code(201).send(avatar);
  });

  app.delete("/api/avatars/:id", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const existing = await prisma.avatar.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await prisma.avatar.delete({ where: { id } });
    return reply.code(204).send();
  });
}
