export interface MonoesMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

export async function fetchMonoesMetadata(
  metadataUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<MonoesMetadata> {
  const response = await fetchImpl(metadataUrl);
  if (!response.ok) {
    throw new Error(`MonoES discovery request failed with status ${response.status}`);
  }
  return (await response.json()) as MonoesMetadata;
}

export function validateMonoesMetadata(
  metadata: MonoesMetadata,
  expectedIssuer: string,
  mode: "development" | "production"
): void {
  if (metadata.issuer !== expectedIssuer) {
    const message = `MonoES discovery issuer mismatch: expected "${expectedIssuer}", got "${metadata.issuer}"`;
    if (mode === "production") {
      throw new Error(message);
    }
    console.warn(message);
  }
}
