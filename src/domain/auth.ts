import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { type DepartmentCode, isUuid, type Level, type SessionUser } from "./context";
import { DomainError } from "./errors";
import { verifyPassword } from "./password";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    departmentCode: row.departmentCode as DepartmentCode,
    level: row.level as Level,
  };
}

/** Yanlış parola, olmayan e-posta ve pasif hesap bilerek aynı hatayı verir: hangisinin yanlış olduğu sızmaz. */
export async function login(db: Db, email: string, password: string): Promise<SessionUser> {
  const failed = new DomainError("LOGIN_FAILED", "E-posta ya da parola hatalı");
  const [row] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  if (!row || !row.active) throw failed;
  if (!(await verifyPassword(password, row.passwordHash))) throw failed;
  return toSessionUser(row);
}

/** Saklanan oturumdaki kullanıcı hâlâ var ve etkinse döner; değilse null. */
export async function getSessionUser(db: Db, userId: string): Promise<SessionUser | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row && row.active ? toSessionUser(row) : null;
}
