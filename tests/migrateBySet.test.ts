import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { expect, it } from 'vitest'
import { migrateBySet } from '../server/db/migrate.ts'

type Entry = { tag: string; idx: number; when: number }
const migrationsFolder = path.resolve('server/db/migrations')

async function folderOf(dir: string, journal: { entries: Entry[] }, entries: Entry[]) {
  await mkdir(path.join(dir, 'meta'), { recursive: true })
  await writeFile(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries)
    await copyFile(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`))
}

async function recorded(client: PGlite): Promise<number> {
  const result = await client.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')
  return result.rows[0]?.n ?? 0
}

it('applies a migration whose timestamp is older than one the database already ran', async () => {
  const journal = JSON.parse(await readFile(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: Entry[]
  }
  /* a database that ran the newest-stamped migration before older-stamped ones
     were merged ahead of it in the journal: it has everything but those */
  const newest = journal.entries.reduce((a, b) => (b.when > a.when ? b : a))
  const newestAt = journal.entries.indexOf(newest)
  const late = journal.entries
    .slice(0, newestAt)
    .filter((e) => e.when < newest.when)
    .slice(-1)
  expect(late.length).toBe(1)
  const ran = journal.entries.slice(0, newestAt + 1).filter((e) => !late.includes(e))

  const dir = await mkdtemp(path.join(tmpdir(), 'doop-migrate-set-'))
  const plain = new PGlite()
  const bySet = new PGlite()
  try {
    await folderOf(path.join(dir, 'ran'), journal, ran)
    for (const client of [plain, bySet]) await migrate(drizzle(client), { migrationsFolder: path.join(dir, 'ran') })

    /* drizzle's migrator compares with the newest recorded stamp and skips it */
    await migrate(drizzle(plain), { migrationsFolder })
    expect(await recorded(plain)).toBeLessThan(journal.entries.length)

    const applied = await migrateBySet(drizzle(bySet), migrationsFolder)
    expect(applied).toContain(String(late[0]!.when))
    expect(await recorded(bySet)).toBe(journal.entries.length)
    expect(await migrateBySet(drizzle(bySet), migrationsFolder)).toEqual([])
  } finally {
    await plain.close()
    await bySet.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60_000)

it('migrates a new database like drizzle does', async () => {
  const client = new PGlite()
  try {
    const applied = await migrateBySet(drizzle(client), migrationsFolder)
    expect(applied.length).toBe(await recorded(client))
    const tables = await client.query("select 1 from information_schema.tables where table_name = 'agent_keys'")
    expect(tables.rows.length).toBe(1)
  } finally {
    await client.close()
  }
}, 60_000)
