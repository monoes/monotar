// Must match the host MONOES_REDIRECT_URI is registered with (127.0.0.1, not
// localhost) — browsers scope cookies per-host, so the login-transaction
// cookie set here has to be readable by the OAuth callback that MonoES
// redirects back to, or every login fails with expired_transaction.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Log in</h1>
      {error && <p role="alert">Login failed: {error}</p>}
      <a href={`${API_URL}/api/auth/login`}>Continue with MonoES</a>
    </main>
  );
}
