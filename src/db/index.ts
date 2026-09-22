import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Lazy initialisation: Next.js evaluates top-level module code at build time,
// so creating the pool eagerly would crash `next build` before DATABASE_URL is
// configured. A plain function (not a Proxy wrapper) keeps the client object
// intact for anything that inspects it.

let pool: Pool | null = null;
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!database) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Run `vercel env pull` or point it at a local Postgres.");
    }
    // Neon (and any hosted Postgres) needs TLS; a local dev server does not.
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

    // Neon hands out `sslmode=require`. Today node-postgres treats that as
    // verify-full, but pg v9 will switch it to libpq semantics, which do NOT
    // verify the certificate chain — a silent downgrade on a future upgrade.
    // State the strict mode explicitly so the behaviour cannot drift, and keep
    // rejectUnauthorized alongside it as the belt-and-braces guarantee.
    const url = isLocal
      ? connectionString
      : connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=verify-full");

    pool = new Pool({
      connectionString: url,
      ssl: isLocal ? undefined : { rejectUnauthorized: true },
      max: 10,
    });
    database = drizzle(pool, { schema });
  }
  return database;
}

export { schema };
