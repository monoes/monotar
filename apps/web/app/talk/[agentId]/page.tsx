import { TalkClient } from "./talk-client";

export default async function TalkPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return (
    <main>
      <h1>Talk</h1>
      <TalkClient agentId={agentId} />
    </main>
  );
}
