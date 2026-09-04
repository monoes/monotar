const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
