import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';

const app = await buildApp();
await migrate((m) => app.log.info(m));

// periodic housekeeping: drop expired refresh tokens
const cleanup = setInterval(() => {
  pool.query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'").catch((e) => app.log.warn(e));
}, 6 * 3600_000);

await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    clearInterval(cleanup);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
