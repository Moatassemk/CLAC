import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// dotenv never overrides a variable that is already set, and some shells/hosts
// export PORT=0 (or an empty PORT) meaning "unset". In that case fall back to
// the port declared in .env so `npm run dev` still starts where it is configured.
if (!Number(process.env.PORT)) {
  try {
    const envFile = path.resolve(process.cwd(), '.env');
    const filePort = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)).PORT : undefined;
    if (Number(filePort) > 0) process.env.PORT = String(filePort);
  } catch {
    // Unreadable .env: keep the default port below.
  }
}

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT) || 5000,
  db: {
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'tunisia_circular',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  jwt: {
    secret: process.env.JWT_SECRET || (isProduction ? '' : 'local-development-secret-only'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  cookieName: 'clac_session',
  corsOrigins: (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
};

export function assertProductionConfig() {
  if (!isProduction) return;
  if (!env.jwt.secret || env.jwt.secret.length < 32) {
    throw new Error('Set JWT_SECRET to a random value of at least 32 characters in production.');
  }
  if (!process.env.DATABASE_URL && (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === 'postgres')) {
    throw new Error('Set a unique DB_PASSWORD in production.');
  }
  if (!env.corsOrigins.length) {
    throw new Error('Set CORS_ORIGINS to the production web origin(s).');
  }
}

/** Shared CORS origin check (Express + Socket.IO). */
export function isOriginAllowed(origin) {
  if (!origin) return true;
  if (env.corsOrigins.includes(origin)) return true;
  if (!isProduction && env.corsOrigins.includes('*')) return true;
  return !isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
