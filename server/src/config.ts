function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const jwtSecret = req('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: req('DATABASE_URL'),
  jwtSecret: new TextEncoder().encode(jwtSecret),
  accessTtlSec: 15 * 60,
  refreshTtlDays: 60,
  corsOrigins: (process.env.CORS_ORIGINS ?? 'https://tadbeerdaily.com,https://www.tadbeerdaily.com,https://app.tadbeerdaily.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
