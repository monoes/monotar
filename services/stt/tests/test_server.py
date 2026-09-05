import grpc
import pytest
from concurrent import futures

from stt_service.generated import stt_pb2, stt_pb2_grpc
from stt_service.server import SttServicer
from stt_service.vad import VoiceActivityDetector
from stt_service.transcriber import Transcriber


class AlwaysSpeechThenSilenceVad:
    """First call says speech; every call after says silence (simulates one utterance)."""

    def __init__(self):
        self._calls = 0

    def is_speech(self, pcm16_frame: bytes, sample_rate: int) -> bool:
        self._calls += 1
        return self._calls == 1


class FakeSegment:
    def __init__(self, text: str):
        self.text = text


class FakeWhisperModel:
    def transcribe(self, audio, **kwargs):
        return [FakeSegment("mock transcript")], None


@pytest.fixture
def server_address():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
    servicer = SttServicer(
        vad=AlwaysSpeechThenSilenceVad(),
        transcriber=Transcriber(model=FakeWhisperModel()),
    )
    stt_pb2_grpc.add_SttServiceServicer_to_server(servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    yield f"127.0.0.1:{port}"
    server.stop(grace=None)


def test_stream_transcribe_emits_full_turn_events(server_address):
    with grpc.insecure_channel(server_address) as channel:
        stub = stt_pb2_grpc.SttServiceStub(channel)

        def audio_frames():
            for _ in range(3):
                yield stt_pb2.AudioFrame(pcm16_data=b"\x00\x00" * 800, sample_rate=16000)

        events = list(stub.StreamTranscribe(audio_frames()))
        event_types = [e.type for e in events]
        assert event_types == ["speech_started", "final_transcript", "speech_ended"]
        assert events[1].text == "mock transcript"
