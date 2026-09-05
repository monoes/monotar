# STT gRPC Contract

Single source of truth for the Node↔Python STT streaming boundary.

- **Python (`services/stt`)**: generates static stubs at build/test time via
  `services/stt/scripts/gen_proto.sh`, which points `grpc_tools.protoc` at this file.
  Generated code is gitignored, not committed.
- **Node (`services/api`)**: loads this file at runtime via `@grpc/proto-loader` —
  no codegen step needed on the TypeScript side.

Do not edit generated stub code directly on either side — edit this `.proto` file and
regenerate.
