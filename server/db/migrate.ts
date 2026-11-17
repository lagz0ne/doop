import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

/**
 * Applies every migration in the journal that the database has not recorded,
 * whatever its place in time.
 *
 * drizzle's own migrator (0.45) compares each journal entry's timestamp with
 * the newest one recorded and applies only the later ones. A database that ran
 * a migration whose timestamp is later than ones merged after it (a branch, a
 * fork, a patch series rebased onto a newer upstream) skips those silently, and
 * the server starts on a schema that lacks their tables and columns.
 *
 * This keeps drizzle's table, row format and journal order (a database it
 * migrated is read as is), but decides by membership: an entry runs when its
 * timestamp is not among the recorded ones, as Rails' schema_migrations,
 * Django's django_migrations and Flyway's outOfOrder do. All pending entries
 * run in one transaction, as drizzle runs them.
 */
export async function migrateBySet(
  db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
  migrationsFolder: string,
): Promise<string[]> {
  const migrations = readMigrationFiles({ migrationsFolder })
  const table = sql`${sql.identifier('drizzle')}.${sql.identifier('__drizzle_migrations')}`
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier('drizzle')}`)
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  )
  const recorded = await db.execute(sql`select created_at from ${table}`)
  const done = new Set(rowsOf<{ created_at: string | number | null }>(recorded).map((row) => Number(row.created_at)))
  const pending = migrations.filter((migration) => !done.has(migration.folderMillis))
  if (!pending.length) return []
  await db.transaction(async (tx) => {
    for (const migration of pending) {
      for (const stmt of migration.sql) await tx.execute(sql.raw(stmt))
      await tx.execute(
        sql`insert into ${table} ("hash", "created_at") values (${migration.hash}, ${migration.folderMillis})`,
      )
    }
  })
  return pending.map((migration) => String(migration.folderMillis))
}

/* node-postgres returns a QueryResult, PGlite a Results: both carry `rows` */
function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? []
}
