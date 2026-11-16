import { expect, test } from "vitest";
import type { DepartmentCode, Level, SessionUser } from "@/domain/context";
import { DomainError } from "@/domain/errors";
import { assertCan, can } from "@/domain/permissions";

const u = (departmentCode: DepartmentCode, level: Level) => ({ departmentCode, level });

test("operatör kendi modülünde işlemi yürütür ama kayıt açamaz", () => {
  expect(can(u("depo", "operator"), "inventory", "execute")).toBe(true);
  expect(can(u("depo", "operator"), "inventory", "write")).toBe(false);
  expect(can(u("depo", "operator"), "inventory", "approve")).toBe(false);
});

test("uzman kayıt açar ama onaylayamaz; müdür onaylar", () => {
  expect(can(u("depo", "uzman"), "inventory", "write")).toBe(true);
  expect(can(u("depo", "uzman"), "inventory", "approve")).toBe(false);
  expect(can(u("depo", "mudur"), "inventory", "approve")).toBe(true);
});

test("başka departmanın modülünde işlem yapılamaz ama görülür", () => {
  expect(can(u("satis", "mudur"), "inventory", "execute")).toBe(false);
  expect(can(u("satis", "operator"), "inventory", "view")).toBe(true);
  expect(can(u("depo", "mudur"), "purchasing", "write")).toBe(false);
});

test("yönetim her modülde düzeyinden bağımsız her işlemi yapar", () => {
  expect(can(u("yonetim", "uzman"), "purchasing", "approve")).toBe(true);
  expect(can(u("yonetim", "operator"), "inventory", "write")).toBe(true);
  expect(can(u("yonetim", "mudur"), "users", "write")).toBe(true);
});

test("kullanıcı yönetimini yalnızca bilgi işlem ve yönetim görür", () => {
  expect(can(u("satis", "mudur"), "users", "view")).toBe(false);
  expect(can(u("bt", "uzman"), "users", "view")).toBe(true);
  expect(can(u("bt", "uzman"), "users", "write")).toBe(true);
  expect(can(u("bt", "operator"), "users", "write")).toBe(false);
});

test("raporlar herkese açıktır ve yalnızca görülür", () => {
  expect(can(u("atolye", "operator"), "reports", "view")).toBe(true);
  expect(can(u("yonetim", "mudur"), "reports", "write")).toBe(false);
});

test("her departman kendi modülünün sahibidir", () => {
  expect(can(u("satis", "uzman"), "sales", "write")).toBe(true);
  expect(can(u("planlama", "uzman"), "planning", "write")).toBe(true);
  expect(can(u("atolye", "operator"), "shopfloor", "execute")).toBe(true);
  expect(can(u("satinalma", "mudur"), "purchasing", "approve")).toBe(true);
});

test("assertCan yetkisizde FORBIDDEN fırlatır", () => {
  const user = { ...u("satis", "uzman"), id: "x", name: "x", email: "x", title: "x" } as SessionUser;
  expect(() => assertCan(user, "sales", "write")).not.toThrow();
  try {
    assertCan(user, "inventory", "execute");
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe("FORBIDDEN");
  }
});
