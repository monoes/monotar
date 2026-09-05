FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recursive \
    ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY external/LiveTalking /app/LiveTalking
COPY external/Wav2Lip /app/Wav2Lip
COPY external/MuseTalk /app/MuseTalk

WORKDIR /app/LiveTalking
RUN pip install --no-cache-dir -r requirements.txt || true

# CPU-only PyTorch build — no CUDA toolkit is installed in this image at all,
# matching this hardware's constraint (see design doc §2). Installing the CUDA
# build here would simply fail to initialize a GPU context; this image never
# attempts to.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

EXPOSE 8010
CMD ["python", "app.py", "--engine", "wav2lip", "--device", "cpu"]
