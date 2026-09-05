import numpy as np
import torch


def _load_default_model():
    model, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-vad", model="silero_vad", trust_repo=True
    )
    return model


class VoiceActivityDetector:
    def __init__(self, model=None, threshold: float = 0.5):
        self._model = model if model is not None else _load_default_model()
        self._threshold = threshold

    def is_speech(self, pcm16_frame: bytes, sample_rate: int) -> bool:
        samples = np.frombuffer(pcm16_frame, dtype=np.int16).astype(np.float32) / 32768.0
        tensor = torch.from_numpy(samples)
        probability = self._model(tensor, sample_rate)
        return float(probability[0]) >= self._threshold
