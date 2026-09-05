import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { CreateAvatarAgentSchema, UpdateAvatarAgentSchema } from "@monotar/contracts";
import { prisma } from "../db";
import { requireRole } from "../rbac";

const canWrite = requireRole("ADMIN");

export async function avatarAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.get("/api/avatar-agents", async (request) => {
    const orgId = request.currentUser!.organizationId;
    return prisma.avatarAgent.findMany({ where: { organizationId: orgId } });
  });

  app.get("/api/avatar-agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const agent = await prisma.avatarAgent.findFirst({ where: { id, organizationId: orgId } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    return agent;
  });

  app.post("/api/avatar-agents", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const parsedInput = CreateAvatarAgentSchema.safeParse(request.body);
    if (!parsedInput.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsedInput.error.issues });
    }
    const input = parsedInput.data;
    const orgId = request.currentUser!.organizationId;
    if (input.avatarId) {
      const avatar = await prisma.avatar.findFirst({ where: { id: input.avatarId, organizationId: orgId } });
      if (!avatar) return reply.code(400).send({ error: "invalid_avatar_id" });
    }
    const agent = await prisma.avatarAgent.create({
      data: { ...input, organizationId: orgId } as Prisma.AvatarAgentUncheckedCreateInput,
    });
    return reply.code(201).send(agent);
  });

  app.patch("/api/avatar-agents/:id", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const existing = await prisma.avatarAgent.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const parsedInput = UpdateAvatarAgentSchema.safeParse(request.body);
    if (!parsedInput.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsedInput.error.issues });
    }
    const input = parsedInput.data;
    if (input.avatarId) {
      const avatar = await prisma.avatar.findFirst({ where: { id: input.avatarId, organizationId: orgId } });
      if (!avatar) return reply.code(400).send({ error: "invalid_avatar_id" });
    }
    return prisma.avatarAgent.update({
      where: { id },
      data: input as Prisma.AvatarAgentUncheckedUpdateInput,
    });
  });

  app.delete("/api/avatar-agents/:id", async (request, reply) => {
    if (!canWrite(request.currentUser)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = request.params as { id: string };
    const orgId = request.currentUser!.organizationId;
    const existing = await prisma.avatarAgent.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await prisma.avatarAgent.delete({ where: { id } });
    return reply.code(204).send();
  });
}
