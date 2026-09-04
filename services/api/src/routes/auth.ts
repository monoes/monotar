import type { FastifyInstance } from "fastify";
import { loadEnv } from "@monotar/config";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "@monotar/auth";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";

const LOGIN_TXN_COOKIE = "monotar_login_txn";

interface MonoesOAuthResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

function decodeIdTokenPayload(idToken: string): { sub: string; email: string } {
  const [, payload] = idToken.split(".");
  const json = Buffer.from(payload, "base64url").toString("utf-8");
  return JSON.parse(json) as { sub: string; email: string };
}

function hashSessionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

  app.get("/api/auth/callback/monoes", async (request, reply) => {
    const env = loadEnv();
    const query = request.query as { code?: string; state?: string };
    const txnCookieRaw = request.cookies[LOGIN_TXN_COOKIE];

    if (!txnCookieRaw) {
      return reply.redirect(`${env.appUrl}/login?error=expired_transaction`, 302);
    }

    reply.clearCookie(LOGIN_TXN_COOKIE, { path: "/" });

    let txn: { state: string; codeVerifier: string };
    try {
      txn = JSON.parse(txnCookieRaw);
    } catch {
      return reply.redirect(`${env.appUrl}/login?error=expired_transaction`, 302);
    }

    if (!query.state) {
      return reply.redirect(`${env.appUrl}/login?error=missing_state`, 302);
    }
    if (query.state !== txn.state) {
      return reply.redirect(`${env.appUrl}/login?error=invalid_state`, 302);
    }
    if (!query.code) {
      return reply.redirect(`${env.appUrl}/login?error=missing_code`, 302);
    }

    const exchangeResponse = await fetch(`${env.monoesIssuer}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: env.monoesRedirectUri,
        client_id: env.monoesClientId,
        code_verifier: txn.codeVerifier,
      }),
    });

    if (!exchangeResponse.ok) {
      return reply.redirect(`${env.appUrl}/login?error=token_exchange_failed`, 302);
    }

    const oauthResponse = (await exchangeResponse.json()) as MonoesOAuthResponse;
    const { sub, email } = decodeIdTokenPayload(oauthResponse.id_token);

    const existingIdentity = await prisma.externalIdentity.findUnique({
      where: { provider_providerSubject: { provider: "monoes", providerSubject: sub } },
      include: { user: true },
    });

    let userId: string;
    if (existingIdentity) {
      userId = existingIdentity.userId;
      await prisma.user.update({
        where: { id: userId },
        data: { email, lastLoginAt: new Date() },
      });
    } else {
      const user = await prisma.user.create({
        data: { email, lastLoginAt: new Date() },
      });
      userId = user.id;
      await prisma.externalIdentity.create({
        data: { userId, provider: "monoes", providerSubject: sub, email },
      });
      const org = await prisma.organization.create({
        data: { name: `${email}'s Organization` },
      });
      await prisma.organizationMember.create({
        data: { organizationId: org.id, userId, role: "OWNER" },
      });
    }

    const sessionValue = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    await prisma.session.create({
      data: {
        userId,
        sessionTokenHash: hashSessionValue(sessionValue),
        expiresAt,
      },
    });

    reply.setCookie(env.sessionCookieName, sessionValue, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    return reply.redirect(`${env.appUrl}/dashboard`, 302);
  });

  app.get("/api/auth/session", async (request) => {
    return { authenticated: request.currentUser !== null };
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.currentUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.currentUser.id } });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      organizationId: request.currentUser.organizationId,
      role: request.currentUser.role,
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const env = loadEnv();
    const sessionValue = request.cookies[env.sessionCookieName];
    if (sessionValue) {
      await prisma.session.updateMany({
        where: { sessionTokenHash: hashSessionValue(sessionValue) },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie(env.sessionCookieName, { path: "/" });
    return { success: true };
  });
}

export const LOGIN_TXN_COOKIE_NAME = LOGIN_TXN_COOKIE;
