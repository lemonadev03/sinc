/**
 * Sync worker: long-lived Railway service that runs the additive sync engine
 * every 10 minutes (plus once at boot). Talks to Postgres directly — no HTTP
 * hop. The web service's /api/cron/sync endpoint stays available for manual
 * triggers; the engine's atomic claim makes concurrent runs safe.
 */
import cron from "node-cron";
import { syncAllEnabled } from "../lib/sync/engine";
import { log } from "../lib/log";

const SCHEDULE = "*/10 * * * *";

let running = false;

async function tick(): Promise<void> {
  if (running) {
    log.warn("previous tick still running — skipping (engine claim also guards)");
    return;
  }
  running = true;
  try {
    const { attempted } = await syncAllEnabled();
    log.info("cron tick complete", { attempted });
  } catch (err) {
    log.error("cron tick crashed", { err: (err as Error).message });
  } finally {
    running = false;
  }
}

log.info("sync worker started", { schedule: SCHEDULE });
void tick();
cron.schedule(SCHEDULE, () => void tick());

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection in worker", { err: String(reason) });
});
