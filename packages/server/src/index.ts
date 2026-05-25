import { buildApp } from "./app.js";
import { env } from "./env.js";

async function main(): Promise<void> {
  const app = await buildApp();
  const config = env();
  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`server listening on ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
