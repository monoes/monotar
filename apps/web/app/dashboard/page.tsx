import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { MeResponse } from "@monotar/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchMe(): Promise<MeResponse | null> {
  const cookieHeader = cookies().toString();
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as MeResponse;
}

export default async function DashboardPage() {
  const me = await fetchMe();
  if (!me) {
    redirect("/login");
  }
  return (
    <main>
      <h1>Dashboard</h1>
      <p>Signed in as {me.email}</p>
    </main>
  );
}
