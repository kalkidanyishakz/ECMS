/**
 * Long-running outbox worker.
 *
 * Run:  npm run worker            (poll every WORKER_POLL_MS, default 5000)
 *       npm run worker -- --once  (drain one batch and exit)
 *
 * tsx resolves the `@/*` tsconfig path alias.
 */
import { getWorkerId, processOutboxBatch } from '@/lib/worker';

const DEFAULT_POLL_MS = 5000;
const parsedPollMs = Number(process.env.WORKER_POLL_MS);
const pollMs = Number.isFinite(parsedPollMs) && parsedPollMs > 0 ? parsedPollMs : DEFAULT_POLL_MS;
const once = process.argv.includes('--once');
const workerId = getWorkerId();

let stopping = false;
let wake: (() => void) | undefined;

function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = undefined;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`[worker ${workerId}] received ${signal}, shutting down`);
  wake?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function runBatch(): Promise<void> {
  const result = await processOutboxBatch({ workerId });
  if (result.claimed > 0 || result.processed > 0 || result.failed > 0 || result.deadLettered > 0) {
    console.log(
      `[worker ${workerId}] claimed=${result.claimed} processed=${result.processed} ` +
        `failed=${result.failed} deadLettered=${result.deadLettered}`
    );
  }
}

async function main(): Promise<void> {
  console.log(`[worker ${workerId}] started (poll ${pollMs}ms${once ? ', once' : ''})`);

  if (once) {
    await runBatch();
    return;
  }

  while (!stopping) {
    try {
      await runBatch();
    } catch (error) {
      console.error(`[worker ${workerId}] batch failed`, error);
    }
    if (stopping) break;
    await interruptibleSleep(pollMs);
  }

  console.log(`[worker ${workerId}] stopped`);
}

main().catch((error) => {
  console.error(`[worker ${workerId}] fatal`, error);
  process.exitCode = 1;
});
