import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || !/^postgres(ql)?:\/\//.test(value)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  return value;
}

function createDatabase() {
  const client = neon(requireDatabaseUrl());
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createDatabase>;

let database: Database | undefined;

export function getDatabase(): Database {
  database ??= createDatabase();
  return database;
}
