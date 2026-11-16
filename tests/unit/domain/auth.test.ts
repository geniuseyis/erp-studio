import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { getSessionUser, login } from "@/domain/auth";
import { addUser, TEST_PASSWORD } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
const EMAIL = "ayla.gunes@baltacioglus.example";

beforeEach(async () => {
  db = await createTestDb();
  await addUser(db, "satinalma", "mudur", { name: "Ayla Güneş", email: EMAIL, title: "Satın Alma Müdürü" });
});

test("doğru e-posta ve parolayla giriş yapılır; parola özeti dönmez", async () => {
  const user = await login(db, EMAIL, TEST_PASSWORD);
  expect(user).toMatchObject({
    name: "Ayla Güneş",
    email: EMAIL,
    title: "Satın Alma Müdürü",
    departmentCode: "satinalma",
    level: "mudur",
  });
  expect(Object.keys(user).sort()).toEqual(["departmentCode", "email", "id", "level", "name", "title"]);
});

test("e-posta büyük harf ve boşlukla yazılsa da giriş olur", async () => {
  const user = await login(db, "  AYLA.GUNES@baltacioglus.example ", TEST_PASSWORD);
  expect(user.email).toBe(EMAIL);
});

test("yanlış parola, olmayan e-posta ve pasif kullanıcı aynı hatayı verir", async () => {
  await addUser(db, "depo", "uzman", { email: "pasif@baltacioglus.example", active: false });
  const attempts: [string, string][] = [
    [EMAIL, "yanlis-parola"],
    ["yok@baltacioglus.example", TEST_PASSWORD],
    ["pasif@baltacioglus.example", TEST_PASSWORD],
  ];
  const messages = new Set<string>();
  for (const [email, password] of attempts) {
    const e = await login(db, email, password).then(
      () => null,
      (err: unknown) => err as { code: string; message: string },
    );
    expect(e?.code).toBe("LOGIN_FAILED");
    messages.add(e?.message ?? "");
  }
  expect(messages.size).toBe(1);
});

test("getSessionUser etkin kullanıcıyı döner; pasif ya da olmayan için null", async () => {
  const user = await login(db, EMAIL, TEST_PASSWORD);
  expect(await getSessionUser(db, user.id)).toEqual(user);
  const pasif = await addUser(db, "depo", "uzman", { email: "pasif@baltacioglus.example", active: false });
  expect(await getSessionUser(db, pasif.id)).toBeNull();
  expect(await getSessionUser(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  expect(await getSessionUser(db, "uuid-degil")).toBeNull();
});
