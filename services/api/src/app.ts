import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(healthRoutes);
  app.register(authRoutes);
  return app;
}
