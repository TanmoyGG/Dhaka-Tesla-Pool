function readPort(raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid port value "${raw}", expected an integer between 1 and 65535`);
  }
  return value;
}

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  webUrl: string;
  databaseUrl: string;
  sessionSecret: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    host: env.API_HOST ?? "0.0.0.0",
    port: readPort(env.API_PORT, 3001),
    webUrl: env.WEB_URL ?? "http://localhost:3000",
    databaseUrl:
      env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/dhaka_tesla_pool",
    sessionSecret: env.SESSION_SECRET,
  };
}

export const config: AppConfig = loadConfig();