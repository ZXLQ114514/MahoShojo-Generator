import { mkdir, writeFile } from 'node:fs/promises';

const outputPath = '.open-next/worker-wrapper.js';

await mkdir('.open-next', { recursive: true });
await writeFile(outputPath, `import openNextWorker from './worker.js';

const SUMMARY_URL = 'https://internal/api/arena/public-summary?auto=1';

export default {
  fetch: openNextWorker.fetch,
  scheduled(_controller, env, context) {
    context.waitUntil(
      env.WORKER_SELF_REFERENCE.fetch(new Request(SUMMARY_URL, { method: 'GET' })),
    );
  },
};
`, 'utf8');

console.log(`[cloudflare-worker-wrapper] generated ${outputPath}`);
