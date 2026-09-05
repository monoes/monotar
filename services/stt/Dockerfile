FROM python:3.11-slim

WORKDIR /app
COPY services/stt/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY packages/stt-proto /packages/stt-proto
COPY services/stt/src ./src
COPY services/stt/scripts ./scripts

RUN pip install --no-cache-dir grpcio-tools \
    && ./scripts/gen_proto.sh

ENV PYTHONPATH=/app/src
EXPOSE 50051
CMD ["python", "-m", "stt_service.server"]
