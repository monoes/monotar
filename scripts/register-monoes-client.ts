#!/usr/bin/env tsx
// MonoES requires 127.0.0.1, not the "localhost" hostname, to recognize a
// redirect URI as loopback and allow http:// for it (see application_type below).
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const registrationEndpoint = "https://monoes.me/api/auth/oauth2/register";
const redirectUri = `${appUrl}/api/auth/callback/monoes`;

async function main() {
  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      // Without this, MonoES rejects http:// loopback redirect URIs outright
      // (its default "web" client type requires https, even for localhost).
      application_type: "native",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Registration failed: HTTP ${response.status}`);
    console.error(body);
    process.exit(1);
  }

  const body = (await response.json()) as { client_id: string };
  console.log(`Registered redirect_uri: ${redirectUri}`);
  console.log(`MONOES_CLIENT_ID=${body.client_id}`);
  console.log("Add this value to your .env.local — it is not written automatically.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
