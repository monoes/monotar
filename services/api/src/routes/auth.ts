import type { FastifyInstance } from "fastify";
import { loadEnv } from "@monotar/config";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "@monotar/auth";

const LOGIN_TXN_COOKIE = "monotar_login_txn";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/login", async (_request, reply) => {
    const env = loadEnv();
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    reply.setCookie(LOGIN_TXN_COOKIE, JSON.stringify({ state, codeVerifier }), {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const authorizeUrl = new URL(`${env.monoesIssuer}/oauth2/authorize`);
    authorizeUrl.searchParams.set("client_id", env.monoesClientId);
    authorizeUrl.searchParams.set("redirect_uri", env.monoesRedirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", env.monoesScopes.join(" "));
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    return reply.redirect(authorizeUrl.toString(), 302);
  });
}

export const LOGIN_TXN_COOKIE_NAME = LOGIN_TXN_COOKIE;
