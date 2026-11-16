import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { login } from "@/domain/auth";
import type { SessionUser } from "@/domain/context";
import { createUser, listUsers, resetPassword, setUserActive, updateUser } from "@/domain/users";
import { addUser, ctxFor, TEST_PASSWORD } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let admin: SessionUser;
let seller: SessionUser;

const input = {
  name: "Yeni Kişi",
  email: "Yeni.Kisi@baltacioglus.example ",
  password: "Parola123",
  departmentCode: "satis",
  level: "uzman",
  title: "Satış Uzmanı",
} as const;

beforeEach(async () => {
  db = await createTestDb();
  admin = await addUser(db, "bt", "uzman", { name: "Ece Korkmaz" });
  seller = await addUser(db, "satis", "uzman");
});

test("yetkisiz kullanıcı kullanıcı ekleyemez", async () => {
  await expect(createUser(ctxFor(db, seller), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await listUsers(db)).length).toBe(2);
});

test("bilgi işlem kullanıcı ekler; e-posta küçük harfe çevrilir; işlem geçmişine yazılır", async () => {
  const created = await createUser(ctxFor(db, admin), input);
  expect(created).toMatchObject({ name: "Yeni Kişi", email: "yeni.kisi@baltacioglus.example", departmentCode: "satis" });
  expect((await login(db, "yeni.kisi@baltacioglus.example", "Parola123")).id).toBe(created.id);
  const log = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id));
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ userId: admin.id, entity: "user", action: "create" });
});

test("aynı e-posta ikinci kez eklenemez", async () => {
  await createUser(ctxFor(db, admin), input);
  await expect(createUser(ctxFor(db, admin), { ...input, name: "Başka" })).rejects.toMatchObject({ code: "DUPLICATE" });
});

test.each([
  ["kısa parola", { password: "1234567" }],
  ["boş ad", { name: "  " }],
  ["geçersiz e-posta", { email: "eposta-degil" }],
])("geçersiz giriş reddedilir: %s", async (_label, over) => {
  await expect(createUser(ctxFor(db, admin), { ...input, ...over })).rejects.toMatchObject({ code: "VALIDATION" });
});

test("listUsers departman adıyla ve etkinlik durumuyla döner", async () => {
  const list = await listUsers(db);
  expect(list.find((u) => u.id === admin.id)).toMatchObject({ departmentName: "Bilgi İşlem", active: true });
});

test("kullanıcı güncellenir ve pasife alınır; kişi kendini pasife alamaz", async () => {
  await updateUser(ctxFor(db, admin), seller.id, { departmentCode: "depo", level: "operator", title: "Depo Görevlisi" });
  expect((await listUsers(db)).find((u) => u.id === seller.id)).toMatchObject({
    departmentCode: "depo",
    level: "operator",
    title: "Depo Görevlisi",
  });
  await setUserActive(ctxFor(db, admin), seller.id, false);
  await expect(login(db, seller.email, TEST_PASSWORD)).rejects.toMatchObject({ code: "LOGIN_FAILED" });
  await expect(setUserActive(ctxFor(db, admin), admin.id, false)).rejects.toMatchObject({ code: "VALIDATION" });
});

test("parola sıfırlanınca eski parola geçmez, yenisi geçer", async () => {
  await resetPassword(ctxFor(db, admin), seller.id, "YeniParola9");
  await expect(login(db, seller.email, TEST_PASSWORD)).rejects.toMatchObject({ code: "LOGIN_FAILED" });
  expect((await login(db, seller.email, "YeniParola9")).id).toBe(seller.id);
  await expect(resetPassword(ctxFor(db, admin), seller.id, "kisa")).rejects.toMatchObject({ code: "VALIDATION" });
});

test("olmayan kullanıcıda NOT_FOUND", async () => {
  const none = "00000000-0000-0000-0000-000000000000";
  await expect(updateUser(ctxFor(db, admin), none, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(setUserActive(ctxFor(db, admin), none, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("kişi kendi departmanını ya da düzeyini değiştiremez; adını ve unvanını değiştirebilir", async () => {
  const ctx = ctxFor(db, admin);
  await expect(updateUser(ctx, admin.id, { departmentCode: "yonetim" })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(updateUser(ctx, admin.id, { level: "mudur" })).rejects.toMatchObject({ code: "VALIDATION" });
  // Aynı değerleri yeniden göndermek (formun tamamı gönderilir) yükseltme sayılmaz.
  await updateUser(ctx, admin.id, { name: "Ece K. Korkmaz", title: "Kıdemli Sistem Uzmanı", departmentCode: "bt", level: "uzman" });
  const me = (await listUsers(db)).find((u) => u.id === admin.id);
  expect(me).toMatchObject({ name: "Ece K. Korkmaz", title: "Kıdemli Sistem Uzmanı", departmentCode: "bt", level: "uzman" });
  // Başkasının düzeyi değiştirilebilir.
  await updateUser(ctx, seller.id, { level: "mudur" });
});
