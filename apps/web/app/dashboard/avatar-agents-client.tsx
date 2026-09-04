"use client";

import { useEffect, useState } from "react";
import type { AvatarAgent } from "@monotar/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function AvatarAgentsClient() {
  const [agents, setAgents] = useState<AvatarAgent[]>([]);
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadAgents() {
    const response = await fetch(`${API_URL}/api/avatar-agents`, { credentials: "include" });
    if (response.ok) {
      setAgents(await response.json());
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch(`${API_URL}/api/avatar-agents`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, systemPrompt, llmConfig: {}, voiceConfig: {} }),
    });
    if (!response.ok) {
      setError(`Failed to create agent (${response.status})`);
      return;
    }
    setName("");
    setSystemPrompt("");
    await loadAgents();
  }

  return (
    <section>
      <h2>Avatar Agents</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {agents.map((agent) => (
          <li key={agent.id}>{agent.name}</li>
        ))}
      </ul>
      <form onSubmit={handleCreate}>
        <input
          aria-label="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agent name"
          required
        />
        <input
          aria-label="system prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt"
          required
        />
        <button type="submit">Create</button>
      </form>
    </section>
  );
}
