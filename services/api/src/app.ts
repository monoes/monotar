import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { avatarAgentRoutes } from "./routes/avatar-agents";
import { avatarRoutes } from "./routes/avatars";
import { sessionPlugin } from "./plugins/session";
import { realtimeRoutes } from "./realtime/ws-route";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(websocket);
  app.register(sessionPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(avatarAgentRoutes);
  app.register(avatarRoutes);
  app.register(realtimeRoutes);
  return app;
}
