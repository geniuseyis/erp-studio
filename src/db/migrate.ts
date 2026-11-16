import type { PGliteInterface } from "@electric-sql/pglite";
import { MIGRATIONS, SCHEMA_VERSION } from "./migrations.generated";

export { SCHEMA_VERSION };

type Pg = Pick<PGliteInterface, "exec" | "query" | "transaction">;

/** Henüz uygulanmamış şema dosyalarını sırayla, her birini tek transaction içinde uygular. */
export async function applyMigrations(pg: Pg): Promise<void> {
  await pg.exec(
    "create table if not exists _migrations (tag text primary key, applied_at timestamptz not null default now())",
  );
  const applied = await pg.query<{ tag: string }>("select tag from _migrations");
  const done = new Set(applied.rows.map((r) => r.tag));
  for (const m of MIGRATIONS) {
    if (done.has(m.tag)) continue;
    await pg.transaction(async (tx) => {
      for (const statement of m.sql.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.exec(statement);
      }
      await tx.query("insert into _migrations (tag) values ($1)", [m.tag]);
    });
  }
}
