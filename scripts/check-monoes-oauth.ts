#!/usr/bin/env tsx
const EXPECTED_ISSUER = "https://monoes.me/api/auth";
const metadataUrl = process.env.MONOES_METADATA_URL ?? `${EXPECTED_ISSUER}/.well-known/oauth-authorization-server`;

async function main() {
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    console.error(`Discovery request failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const metadata = (await response.json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string };

  if (metadata.issuer !== EXPECTED_ISSUER) {
    console.error(`Issuer mismatch: expected "${EXPECTED_ISSUER}", got "${metadata.issuer}"`);
    process.exit(1);
  }

  console.log("MonoES discovery OK");
  console.log(`  issuer: ${metadata.issuer}`);
  console.log(`  authorization_endpoint: ${metadata.authorization_endpoint}`);
  console.log(`  token_endpoint: ${metadata.token_endpoint}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
