import { buildApp } from "./app";

const app = buildApp();
const port = Number(process.env.AVATAR_GATEWAY_PORT ?? 4100);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
