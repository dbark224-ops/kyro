import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDatabaseClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a Kyro database client.");
  }

  const queryClient = postgres(connectionString, {
    max: 10,
    prepare: false
  });

  return drizzle(queryClient, { schema });
}

export type KyroDatabase = ReturnType<typeof createDatabaseClient>;

