import numpy as np
from faster_whisper import WhisperModel


def _load_default_model():
    return WhisperModel("small", device="cpu", compute_type="int8")


class Transcriber:
    def __init__(self, model=None):
        self._model = model if model is not None else _load_default_model()

    def transcribe(self, pcm16_audio: bytes, sample_rate: int) -> str:
        samples = np.frombuffer(pcm16_audio, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _info = self._model.transcribe(samples, language="en")
        return "".join(segment.text for segment in segments).strip()
