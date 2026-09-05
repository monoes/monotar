"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ServerMessage, RealtimeState } from "@monotar/contracts";

// Must match login/page.tsx's host — both the token fetch (credentialed) and
// the control WebSocket rely on the session cookie, which is scoped to
// 127.0.0.1 per MONOES_REDIRECT_URI.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:4000";

export function TalkClient({ agentId }: { agentId: string }) {
  const [state, setState] = useState<RealtimeState>("CREATED");
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlWsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    return () => {
      controlWsRef.current?.close();
      roomRef.current?.disconnect();
    };
  }, []);

  async function startTalking() {
    // Guard against a second click (or a retry after a failed attempt) while a
    // previous session is still live: without this, the old WebSocket/Room are
    // simply overwritten in the refs and leak (never closed/disconnected),
    // leaving a stale connection open for the rest of the page's lifetime.
    controlWsRef.current?.close();
    roomRef.current?.disconnect();
    setErrorMessage(null);

    const controlWs = new WebSocket(`${WS_URL}/api/realtime/${agentId}`);
    controlWsRef.current = controlWs;
    controlWs.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "state") setState(message.state);
      if (message.type === "transcript") setTranscript(message.text);
      if (message.type === "assistant_text") setAssistantText(message.text);
      if (message.type === "error") setErrorMessage(message.message);
    };

    const tokenResponse = await fetch(`${API_URL}/api/realtime/livekit-token?agentId=${agentId}`, {
      credentials: "include",
    });
    if (!tokenResponse.ok) {
      setErrorMessage(`Failed to get LiveKit token (status ${tokenResponse.status})`);
      controlWs.close();
      return;
    }
    const { token, url } = await tokenResponse.json();

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
        if (videoRef.current) {
          track.attach(videoRef.current);
        }
      }
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
  }

  function sendInterrupt() {
    if (controlWsRef.current?.readyState === WebSocket.OPEN) {
      controlWsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  return (
    <div>
      <div data-testid="avatar-placeholder">Avatar state: {state}</div>
      <video ref={videoRef} autoPlay playsInline data-testid="avatar-video" />
      <button onClick={startTalking}>Start Talking</button>
      <button onClick={sendInterrupt}>Interrupt</button>
      <p>Transcript: {transcript}</p>
      <p>Assistant: {assistantText}</p>
      {errorMessage && <p data-testid="error-message">Error: {errorMessage}</p>}
    </div>
  );
}
