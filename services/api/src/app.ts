import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { loadEnv } from "@monotar/config";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { avatarAgentRoutes } from "./routes/avatar-agents";
import { avatarRoutes } from "./routes/avatars";
import { sessionPlugin } from "./plugins/session";
import { realtimeRoutes } from "./realtime/ws-route";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  const env = loadEnv();
  // The web app (apps/web) runs on a different origin/port and calls this API
  // with `credentials: "include"` — without CORS, browsers block those
  // client-side fetch()/WebSocket calls entirely (full-page redirects like the
  // OAuth login flow are unaffected, since CORS only applies to XHR/fetch).
  app.register(cors, { origin: env.appUrl, credentials: true });
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
