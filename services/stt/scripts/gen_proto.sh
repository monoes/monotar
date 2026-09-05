#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src/stt_service/generated
python -m grpc_tools.protoc \
  --proto_path=../../packages/stt-proto \
  --python_out=src/stt_service/generated \
  --grpc_python_out=src/stt_service/generated \
  ../../packages/stt-proto/stt.proto
sed -i 's/^import stt_pb2 as stt__pb2$/from . import stt_pb2 as stt__pb2/' src/stt_service/generated/stt_pb2_grpc.py
touch src/stt_service/generated/__init__.py
