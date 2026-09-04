import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { sessionPlugin } from "./plugins/session";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(sessionPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  return app;
}
