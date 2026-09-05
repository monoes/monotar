import numpy as np
from stt_service.transcriber import Transcriber


class FakeSegment:
    def __init__(self, text: str):
        self.text = text


class FakeWhisperModel:
    """Stands in for faster_whisper.WhisperModel in unit tests."""

    def transcribe(self, audio, **kwargs):
        segments = [FakeSegment(" hello"), FakeSegment(" world")]
        info = None
        return segments, info


def test_transcribe_joins_segment_texts():
    transcriber = Transcriber(model=FakeWhisperModel())
    silence = np.zeros(1600, dtype=np.int16).tobytes()
    result = transcriber.transcribe(silence, sample_rate=16000)
    assert result == "hello world"
