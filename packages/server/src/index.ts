import { createDb } from "@garment-mgmt/db";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { startInventoryPushLoop } from "./jobs/shopify-inventory-push.js";

async function main(): Promise<void> {
  const config = env();
  const { db } = createDb(config.DATABASE_URL);
  const app = await buildApp({ db });

  const testMode = !config.SHOPIFY_ADMIN_TOKEN;
  const pushHandle = startInventoryPushLoop(
    db,
    {
      shopDomain: config.SHOPIFY_SHOP_DOMAIN,
      adminToken: config.SHOPIFY_ADMIN_TOKEN,
      locationId: config.SHOPIFY_LOCATION_ID,
      testMode,
    },
    config.SHOPIFY_PUSH_INTERVAL_MS,
    (r) => {
      if (r.scanned > 0) {
        app.log.info(r, "shopify push tick");
      }
    },
  );
  app.log.info(
    { intervalMs: config.SHOPIFY_PUSH_INTERVAL_MS, testMode },
    "shopify push loop started",
  );

  process.on("SIGTERM", () => {
    pushHandle.stop();
  });

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`server listening on ${config.PORT}`);
  } catch (err) {
    pushHandle.stop();
    app.log.error(err);
    process.exit(1);
  }
}

main();
