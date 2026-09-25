function readPort(raw: string | undefined, fallback: number): number {
  const value = raw === undefined || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid port value "${raw}", expected an integer between 1 and 65535`);
  }
  return value;
}

function readAuthorizedParties(raw: string | undefined, fallback: string): string[] {
  const value = raw === undefined || raw.trim() === "" ? fallback : raw;
  return value
    .split(",")
    .map((party) => party.trim())
    .filter((party) => party !== "");
}

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  webUrl: string;
  databaseUrl: string;
  // Clerk (authentication/identity provider). Keys come from the environment
  // (CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY); they are never committed and
  // never reach the browser.
  clerkSecretKey: string | undefined;
  clerkPublishableKey: string | undefined;
  // Origins allowed to present Clerk session tokens to this API (defence
  // against the subdomain cookie-leak attack / CSRF). Local development
  // default: the web app's public origin. Production origins are added through
  // CLERK_AUTHORIZED_PARTIES (comma separated) in the environment.
  clerkAuthorizedParties: string[];
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
    clerkSecretKey: env.CLERK_SECRET_KEY,
    clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY,
    clerkAuthorizedParties: readAuthorizedParties(
      env.CLERK_AUTHORIZED_PARTIES,
      env.WEB_URL ?? "http://localhost:3000",
    ),
  };
}

export const config: AppConfig = loadConfig();