import { loadEnv } from "@monotar/config";
import { buildApp } from "./app";

const env = loadEnv();
const app = buildApp();

app
  .listen({ port: env.apiPort, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
