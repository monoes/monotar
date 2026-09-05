import grpc
import threading
from concurrent import futures

from stt_service.generated import stt_pb2, stt_pb2_grpc
from stt_service.vad import VoiceActivityDetector
from stt_service.transcriber import Transcriber


class SttServicer(stt_pb2_grpc.SttServiceServicer):
    def __init__(self, vad=None, transcriber=None):
        self._vad = vad if vad is not None else VoiceActivityDetector()
        self._transcriber = transcriber if transcriber is not None else Transcriber()
        # self._vad wraps a stateful torch model (Silero VAD keeps recurrent
        # state between calls) and is shared across every concurrent gRPC
        # stream served by the ThreadPoolExecutor, so concurrent calls into it
        # must be serialized. The transcriber is NOT locked: it wraps a
        # ctranslate2 model, which is documented as thread-safe for concurrent
        # calls from multiple threads on the same instance.
        self._vad_lock = threading.Lock()

    def StreamTranscribe(self, request_iterator, context):
        speaking = False
        buffered_audio = bytearray()

        for frame in request_iterator:
            with self._vad_lock:
                is_speech = self._vad.is_speech(frame.pcm16_data, frame.sample_rate)

            if is_speech and not speaking:
                speaking = True
                buffered_audio = bytearray()
                yield stt_pb2.TranscriptEvent(type="speech_started")

            if speaking:
                buffered_audio.extend(frame.pcm16_data)

            if not is_speech and speaking:
                speaking = False
                text = self._transcriber.transcribe(bytes(buffered_audio), frame.sample_rate)
                yield stt_pb2.TranscriptEvent(type="final_transcript", text=text)
                yield stt_pb2.TranscriptEvent(type="speech_ended")


def serve(port: int = 50051) -> grpc.Server:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    stt_pb2_grpc.add_SttServiceServicer_to_server(SttServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    return server


if __name__ == "__main__":
    grpc_server = serve()
    grpc_server.wait_for_termination()
