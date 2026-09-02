import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/*schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Generation and checks do not connect. Migration requires a real secret URL.
    url: process.env.DATABASE_URL ?? "postgresql://schema-only:unused@localhost/f_trade",
  },
  strict: true,
  verbose: true,
});
