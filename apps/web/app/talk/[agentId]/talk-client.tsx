"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ServerMessage, RealtimeState } from "@monotar/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

export function TalkClient({ agentId }: { agentId: string }) {
  const [state, setState] = useState<RealtimeState>("CREATED");
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
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
    const controlWs = new WebSocket(`${WS_URL}/api/realtime/${agentId}`);
    controlWsRef.current = controlWs;
    controlWs.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "state") setState(message.state);
      if (message.type === "transcript") setTranscript(message.text);
      if (message.type === "assistant_text") setAssistantText(message.text);
    };

    const tokenResponse = await fetch(`${API_URL}/api/realtime/livekit-token?agentId=${agentId}`, {
      credentials: "include",
    });
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
    controlWsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }

  return (
    <div>
      <div data-testid="avatar-placeholder">Avatar state: {state}</div>
      <video ref={videoRef} autoPlay playsInline data-testid="avatar-video" />
      <button onClick={startTalking}>Start Talking</button>
      <button onClick={sendInterrupt}>Interrupt</button>
      <p>Transcript: {transcript}</p>
      <p>Assistant: {assistantText}</p>
    </div>
  );
}
