import numpy as np
from stt_service.vad import VoiceActivityDetector


class FakeSileroModel:
    """Stands in for the real torch.hub Silero VAD model in unit tests."""

    def __call__(self, tensor, sample_rate):
        # Real Silero returns a probability tensor; our fake returns a plain
        # float based on whether the frame has any non-zero energy, so tests
        # can exercise both branches without loading the real model.
        import torch

        has_energy = torch.any(tensor.abs() > 0.01).item()
        return torch.tensor([0.9 if has_energy else 0.01])


def test_silence_is_not_speech():
    vad = VoiceActivityDetector(model=FakeSileroModel())
    silence = np.zeros(1600, dtype=np.int16).tobytes()
    assert vad.is_speech(silence, sample_rate=16000) is False


def test_tone_is_speech():
    vad = VoiceActivityDetector(model=FakeSileroModel())
    tone = (np.ones(1600, dtype=np.int16) * 5000).tobytes()
    assert vad.is_speech(tone, sample_rate=16000) is True
