import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { departments, users } from "@/db/schema";
import { describeChanges, type FieldSpec, logAudit } from "./audit";
import { normalizeEmail, toSessionUser } from "./auth";
import {
  type Ctx,
  DEPARTMENT_NAMES,
  type DepartmentCode,
  inTx,
  isUuid,
  LEVEL_NAMES,
  type Level,
  type SessionUser,
} from "./context";
import { DomainError } from "./errors";
import { hashPassword } from "./password";
import { assertCan } from "./permissions";

export const MIN_PASSWORD_LENGTH = 8;

export type NewUser = {
  name: string;
  email: string;
  password: string;
  departmentCode: DepartmentCode;
  level: Level;
  title: string;
};
export type UserPatch = Partial<Pick<NewUser, "name" | "departmentCode" | "level" | "title">>;
export type UserRow = SessionUser & { active: boolean; departmentName: string };

/** Güncelleme özetindeki alanlar. Parola ve parola özeti burada yoktur; özete hiçbir zaman yazılmaz. */
const FIELDS: FieldSpec<Required<UserPatch>> = {
  name: { label: "ad" },
  title: { label: "unvan" },
  departmentCode: { label: "departman", format: (d) => DEPARTMENT_NAMES[d] },
  level: { label: "düzey", format: (l) => LEVEL_NAMES[l] },
};

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw invalid(`Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı`);
}

function checkOrg(departmentCode: string | undefined, level: string | undefined): void {
  if (departmentCode !== undefined && !(departmentCode in DEPARTMENT_NAMES)) throw invalid("Geçersiz departman");
  if (level !== undefined && !(level in LEVEL_NAMES)) throw invalid("Geçersiz yetki düzeyi");
}

async function mustFind(db: Db, id: string): Promise<typeof users.$inferSelect> {
  const [row] = isUuid(id) ? await db.select().from(users).where(eq(users.id, id)) : [];
  if (!row) throw new DomainError("NOT_FOUND", "Kullanıcı bulunamadı");
  return row;
}

export async function createUser(ctx: Ctx, input: NewUser): Promise<SessionUser> {
  assertCan(ctx.user, "users", "write");
  const name = input.name.trim();
  const title = input.title.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw invalid("Ad boş olamaz");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Geçerli bir e-posta girin");
  checkPassword(input.password);
  checkOrg(input.departmentCode, input.level);
  const passwordHash = await hashPassword(input.password);

  return inTx(ctx, async (tx) => {
    const [existing] = await tx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) throw new DomainError("DUPLICATE", "Bu e-posta zaten kayıtlı");
    const [row] = await tx.db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        departmentCode: input.departmentCode,
        level: input.level,
        title,
        createdAt: tx.now,
      })
      .returning();
    if (!row) throw new Error("kullanıcı eklenemedi");
    await logAudit(tx, {
      entity: "user",
      entityId: row.id,
      action: "create",
      summary: `${name} eklendi: ${[title, DEPARTMENT_NAMES[input.departmentCode], LEVEL_NAMES[input.level]].filter(Boolean).join(", ")}`,
    });
    return toSessionUser(row);
  });
}

export async function updateUser(ctx: Ctx, id: string, patch: UserPatch): Promise<void> {
  assertCan(ctx.user, "users", "write");
  checkOrg(patch.departmentCode, patch.level);
  const set: UserPatch = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw invalid("Ad boş olamaz");
    set.name = patch.name.trim();
  }
  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.departmentCode !== undefined) set.departmentCode = patch.departmentCode;
  if (patch.level !== undefined) set.level = patch.level;

  await inTx(ctx, async (tx) => {
    const row = await mustFind(tx.db, id);
    // Kendi yetkisini yükseltmek (ya da son yöneticinin kendini düşürmesi) engellenir; bunu başka bir yetkili yapar.
    const changesOwnRole =
      id === ctx.user.id &&
      ((set.departmentCode !== undefined && set.departmentCode !== row.departmentCode) || (set.level !== undefined && set.level !== row.level));
    if (changesOwnRole) throw invalid("Kendi departmanınızı ya da düzeyinizi değiştiremezsiniz");
    const changes = describeChanges(FIELDS, toSessionUser(row), set);
    if (changes.length === 0) return;
    await tx.db.update(users).set(set).where(eq(users.id, id));
    await logAudit(tx, { entity: "user", entityId: id, action: "update", summary: `${row.name} güncellendi: ${changes.join(", ")}` });
  });
}

export async function setUserActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  assertCan(ctx.user, "users", "write");
  if (id === ctx.user.id && !active) throw invalid("Kendi hesabınızı pasife alamazsınız");
  await inTx(ctx, async (tx) => {
    const row = await mustFind(tx.db, id);
    await tx.db.update(users).set({ active }).where(eq(users.id, id));
    await logAudit(tx, {
      entity: "user",
      entityId: id,
      action: active ? "activate" : "deactivate",
      summary: `${row.name} ${active ? "etkinleştirildi" : "pasife alındı"}`,
    });
  });
}

export async function resetPassword(ctx: Ctx, id: string, newPassword: string): Promise<void> {
  assertCan(ctx.user, "users", "write");
  checkPassword(newPassword);
  const passwordHash = await hashPassword(newPassword);
  await inTx(ctx, async (tx) => {
    const row = await mustFind(tx.db, id);
    await tx.db.update(users).set({ passwordHash }).where(eq(users.id, id));
    await logAudit(tx, {
      entity: "user",
      entityId: id,
      action: "reset_password",
      summary: `${row.name} parolası sıfırlandı`,
    });
  });
}

export async function listUsers(db: Db): Promise<UserRow[]> {
  const rows = await db
    .select({ user: users, departmentName: departments.name })
    .from(users)
    .innerJoin(departments, eq(departments.code, users.departmentCode))
    .orderBy(asc(departments.name), asc(users.name));
  return rows.map((r) => ({ ...toSessionUser(r.user), active: r.user.active, departmentName: r.departmentName }));
}
