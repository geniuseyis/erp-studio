import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { endSession, restoreSession, sessionState } from "@/shell/session";
import { addUser } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

// Node'da localStorage yok; oturumun saklandığı yeri basit bir sözlükle taklit et.
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} as Storage;

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  memory.clear();
  endSession();
});

test("saklanan oturum geri yüklenir", async () => {
  const user = await addUser(db, "depo", "uzman");
  localStorage.setItem("erp.session", JSON.stringify({ userId: user.id }));
  await restoreSession(db);
  expect(sessionState()).toMatchObject({ status: "in", user: { id: user.id } });
});

test("doğrulama sürerken çıkış yapılırsa eski oturum geri gelmez", async () => {
  const user = await addUser(db, "depo", "uzman");
  localStorage.setItem("erp.session", JSON.stringify({ userId: user.id }));
  const pending = restoreSession(db);
  endSession();
  await pending;
  expect(sessionState()).toMatchObject({ status: "out", user: null });
  expect(localStorage.getItem("erp.session")).toBeNull();
});
