#!/usr/bin/env tsx
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
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
    }),
  });

  if (!response.ok) {
    console.error(`Registration failed: HTTP ${response.status}`);
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
