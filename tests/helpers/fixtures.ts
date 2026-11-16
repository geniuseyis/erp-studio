import type { Db } from "@/db/client";
import { departments, materials, users } from "@/db/schema";
import { type Ctx, DEPARTMENT_NAMES, type DepartmentCode, type Level, type SessionUser } from "@/domain/context";
import { hashPassword } from "@/domain/password";

export const TEST_PASSWORD = "Demo2026!";
export const NOW = new Date("2026-11-15T09:00:00+03:00");

let cachedHash: string | null = null;

export async function seedDepartments(db: Db): Promise<void> {
  await db
    .insert(departments)
    .values(Object.entries(DEPARTMENT_NAMES).map(([code, name]) => ({ code, name })))
    .onConflictDoNothing();
}

/** Doğrudan tabloya bir kullanıcı ekler (servislerden bağımsız test kurulumu için). */
export async function addUser(
  db: Db,
  departmentCode: DepartmentCode,
  level: Level,
  over: { name?: string; email?: string; active?: boolean; title?: string } = {},
): Promise<SessionUser> {
  await seedDepartments(db);
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const name = over.name ?? `${departmentCode} ${level}`;
  const email = over.email ?? `${departmentCode}.${level}@baltacioglus.example`;
  const title = over.title ?? "Test";
  const [row] = await db
    .insert(users)
    .values({ name, email, passwordHash: cachedHash, departmentCode, level, title, active: over.active ?? true })
    .returning();
  if (!row) throw new Error("kullanıcı eklenemedi");
  return { id: row.id, name, email, title, departmentCode, level };
}

export function ctxFor(db: Db, user: SessionUser, now: Date = NOW): Ctx {
  return { db, user, now };
}

/** Doğrudan tabloya stoksuz bir malzeme ekler. */
export async function addMaterial(
  db: Db,
  over: Partial<typeof materials.$inferInsert> = {},
): Promise<typeof materials.$inferSelect> {
  materialSeq += 1;
  const [row] = await db
    .insert(materials)
    .values({
      code: `TST-${String(materialSeq).padStart(4, "0")}`,
      name: `Test malzeme ${materialSeq}`,
      category: "hirdavat",
      unit: "adet",
      ...over,
    })
    .returning();
  if (!row) throw new Error("malzeme eklenemedi");
  return row;
}
let materialSeq = 0;
