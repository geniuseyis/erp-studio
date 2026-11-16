import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "@/domain/password";

test("parola özeti doğrulanır, yanlış parola reddedilir", async () => {
  const h = await hashPassword("Demo2026!");
  expect(h.startsWith("pbkdf2$100000$")).toBe(true);
  expect(h).not.toContain("Demo2026!");
  expect(await verifyPassword("Demo2026!", h)).toBe(true);
  expect(await verifyPassword("demo2026!", h)).toBe(false);
  expect(await verifyPassword("", h)).toBe(false);
});

test("aynı parola her seferinde farklı özet üretir (tuz)", async () => {
  expect(await hashPassword("Demo2026!")).not.toBe(await hashPassword("Demo2026!"));
});

test("bozuk özet doğrulamada hata fırlatmaz, false döner", async () => {
  expect(await verifyPassword("x", "bozuk")).toBe(false);
  expect(await verifyPassword("x", "pbkdf2$abc$$")).toBe(false);
});
