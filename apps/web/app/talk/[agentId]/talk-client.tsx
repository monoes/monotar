"use client";

import { useRef, useState } from "react";
import type { ServerMessage, RealtimeState } from "@monotar/contracts";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

export function TalkClient({ agentId }: { agentId: string }) {
  const [state, setState] = useState<RealtimeState>("CREATED");
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  async function startTalking() {
    const ws = new WebSocket(`${WS_URL}/api/realtime/${agentId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "state") setState(message.state);
      if (message.type === "transcript") setTranscript(message.text);
      if (message.type === "assistant_text") setAssistantText(message.text);
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (event) => {
      const buffer = await event.data.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      ws.send(JSON.stringify({ type: "audio_chunk", data: base64 }));
    };

    recorder.start(3000);
  }

  function sendInterrupt() {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }

  return (
    <div>
      <div data-testid="avatar-placeholder">Avatar state: {state}</div>
      <button onClick={startTalking}>Start Talking</button>
      <button onClick={sendInterrupt}>Interrupt</button>
      <p>Transcript: {transcript}</p>
      <p>Assistant: {assistantText}</p>
    </div>
  );
}
