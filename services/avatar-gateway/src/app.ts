import Fastify, { type FastifyInstance } from "fastify";
import { avatarSessionRoutes, type AvatarSessionsConfig } from "./routes/avatar-sessions";

export function buildApp(config: AvatarSessionsConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(avatarSessionRoutes, config);
  return app;
}
