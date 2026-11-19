import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, purchaseOrderLines, purchaseOrders, settings, users } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { addWorkdays, istanbulDayStart } from "@/domain/production/calendar";
import { approvePurchaseOrder, canApprove, pendingTier, submitPurchaseOrder } from "@/domain/purchasing/approval";
import { createPurchaseOrder, orderNet } from "@/domain/purchasing/orders";
import { listPurchaseOrders } from "@/domain/purchasing/queries";
import { approvalThresholds, requiredTier, SETTING_KEYS } from "@/domain/settings";
import { addMaterial, addSupplier, addSupplierItem, addUser, ctxFor, NOW } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let uzman: Ctx; // satın alma uzmanı (oluşturan)
let mudur: Ctx; // satın alma müdürü
let yonetim: Ctx;
let supplierId: string;
let materialId: string;

beforeEach(async () => {
  db = await createTestDb();
  uzman = ctxFor(db, await addUser(db, "satinalma", "uzman", { name: "Ece Uzman" }));
  mudur = ctxFor(db, await addUser(db, "satinalma", "mudur", { name: "Ayla Güneş" }));
  yonetim = ctxFor(db, await addUser(db, "yonetim", "mudur", { name: "Nermin Aksoy" }));
  const supplier = await addSupplier(db, { code: "TED-0001", leadTimeDays: 5 });
  const material = await addMaterial(db, { code: "MLZ-0005", unit: "adet" });
  supplierId = supplier.id;
  materialId = material.id;
  await addSupplierItem(db, { supplierId, materialId, unitPriceMinor: 100 });
});

/** Tek kalemli taslak: 1 adet × net kuruş = net tutar. */
async function draft(netKurus: number, by: Ctx = uzman) {
  const po = await createPurchaseOrder(by, { supplierId, lines: [{ materialId, qtyMilli: 1000 }] });
  await db.update(purchaseOrderLines).set({ unitPriceMinor: netKurus }).where(eq(purchaseOrderLines.orderId, po.id));
  return po;
}

async function history(entityId: string, action?: string): Promise<string[]> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  return rows.filter((r) => !action || r.action === action).map((r) => r.summary);
}

const expected = () => addWorkdays(istanbulDayStart(NOW), 5);
async function row(id: string) {
  const [r] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  return r!;
}

test("tam ₺50.000,00 doğrudan gönderilir; ₺50.000,01 onay bekler (gönderim yolundan)", async () => {
  const a = await draft(5_000_000);
  expect(await submitPurchaseOrder(uzman, a.id)).toMatchObject({ sent: true, order: { status: "sent", requiredTier: 0 } });
  const b = await draft(5_000_001);
  expect(await submitPurchaseOrder(uzman, b.id)).toMatchObject({ sent: false, order: { status: "pending_approval", requiredTier: 1 } });
  const c = await draft(25_000_000);
  expect((await submitPurchaseOrder(uzman, c.id)).order.requiredTier).toBe(1);
  const d = await draft(25_000_001);
  expect((await submitPurchaseOrder(uzman, d.id)).order.requiredTier).toBe(2);
});

test("kademe 0: submit doğrudan gönderir, expectedAt = tedarikçi teslim süresi kadar iş günü sonrası", async () => {
  const po = await draft(1_240_000);
  const { order } = await submitPurchaseOrder(uzman, po.id);
  expect(order).toMatchObject({ status: "sent", submittedAt: NOW, sentAt: NOW });
  expect(order.expectedAt).toEqual(expected());
  const day = expected().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });
  expect(await history(po.id, "send")).toEqual([`${po.code} gönderildi: ₺12.400,00 KDV hariç, beklenen teslim ${day}`]);
});

test("kademe 1: uzman gönderir → onay bekliyor; satın alma müdürü onaylar → gönderildi", async () => {
  const po = await draft(9_250_020);
  await submitPurchaseOrder(uzman, po.id);
  expect(await history(po.id, "submit")).toEqual([
    `${po.code} onaya gönderildi: ₺92.500,20 KDV hariç, 50.000 TL eşiği aşıldı → Satın Alma müdürü onayı`,
  ]);
  const pending = await row(po.id);
  expect(pendingTier(pending as never)).toBe("manager");
  expect(canApprove(mudur.user, pending as never)).toBe(true);
  const { order, sent } = await approvePurchaseOrder(mudur, po.id);
  expect(sent).toBe(true);
  expect(order).toMatchObject({ status: "sent", managerApprovedBy: mudur.user.id, managerApprovedAt: NOW, sentAt: NOW });
  expect(order.expectedAt).toEqual(expected());
  const [line] = await history(po.id, "approve");
  expect(line).toMatch(new RegExp(`^${po.code} müdür onayı verdi \\(Ayla Güneş\\); gönderildi, beklenen teslim \\d\\d\\.\\d\\d\\.2026$`));
});

test("kademe 2: müdür onayından sonra hâlâ onay bekliyor; müdürün ikinci onayı FORBIDDEN; Yönetim onaylar → gönderildi", async () => {
  const po = await draft(30_000_000);
  await submitPurchaseOrder(uzman, po.id);
  const first = await approvePurchaseOrder(mudur, po.id);
  expect(first).toMatchObject({ sent: false, order: { status: "pending_approval", managerApprovedBy: mudur.user.id, boardApprovedBy: null } });
  expect(pendingTier((await row(po.id)) as never)).toBe("board");
  expect(canApprove(mudur.user, (await row(po.id)) as never)).toBe(false);
  await expect(approvePurchaseOrder(mudur, po.id)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Bu kademe Yönetim onayı ister" });
  const done = await approvePurchaseOrder(yonetim, po.id);
  expect(done).toMatchObject({ sent: true, order: { status: "sent", boardApprovedBy: yonetim.user.id } });
  expect(await history(po.id, "approve")).toHaveLength(2);
});

test("Yönetim müdür kademesinde onaylarsa iki kademe birlikte dolar", async () => {
  const po = await draft(30_000_000);
  await submitPurchaseOrder(uzman, po.id);
  const { order, sent } = await approvePurchaseOrder(yonetim, po.id);
  expect(sent).toBe(true);
  expect(order).toMatchObject({ managerApprovedBy: yonetim.user.id, boardApprovedBy: yonetim.user.id, status: "sent" });
  const [line] = await history(po.id, "approve");
  expect(line).toContain("Yönetim onayı verdi (Nermin Aksoy), müdür kademesini de karşıladı; gönderildi");
});

test("oluşturan kendi siparişini onaylayamaz; canApprove false", async () => {
  const po = await draft(9_250_020, mudur);
  await submitPurchaseOrder(mudur, po.id);
  expect(canApprove(mudur.user, (await row(po.id)) as never)).toBe(false);
  await expect(approvePurchaseOrder(mudur, po.id)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Kendi siparişinizi onaylayamazsınız" });
  expect((await row(po.id)).status).toBe("pending_approval");
});

test("tek Yönetim kullanıcısının kademe 2 siparişi gönderilemez: 'Bu tutarı onaylayabilecek başka bir kullanıcı yok'", async () => {
  const po = await draft(30_000_000, yonetim);
  await expect(submitPurchaseOrder(yonetim, po.id)).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Bu tutarı onaylayabilecek başka bir kullanıcı yok",
  });
  expect(await row(po.id)).toMatchObject({ status: "draft", submittedAt: null, requiredTier: 0 });
  expect(await history(po.id, "submit")).toEqual([]);
});

test("boş taslak gönderilemez; taslak olmayan gönderilemez; pending olmayan onaylanamaz", async () => {
  const po = await draft(100);
  await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  await expect(submitPurchaseOrder(uzman, po.id)).rejects.toMatchObject({ code: "VALIDATION" });
  const sentPo = await draft(100);
  await submitPurchaseOrder(uzman, sentPo.id);
  await expect(submitPurchaseOrder(uzman, sentPo.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(approvePurchaseOrder(mudur, sentPo.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  const draftPo = await draft(100);
  await expect(approvePurchaseOrder(mudur, draftPo.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(approvePurchaseOrder(mudur, "yok")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("eşik settings'te değişince yeni gönderim yeni eşiği, bekleyen sipariş eski kademeyi korur", async () => {
  const a = await draft(6_000_000);
  await submitPurchaseOrder(uzman, a.id);
  expect((await row(a.id)).requiredTier).toBe(1);
  await db.insert(settings).values({ key: SETTING_KEYS.approvalManagerKurus, value: 7_000_000 });
  const b = await draft(6_000_000);
  expect(await submitPurchaseOrder(uzman, b.id)).toMatchObject({ sent: true, order: { requiredTier: 0 } });
  expect((await row(a.id)).requiredTier).toBe(1);
  expect((await approvePurchaseOrder(mudur, a.id)).sent).toBe(true);
});

test("depo müdürü ve satın alma uzmanı onaylayamaz: FORBIDDEN", async () => {
  const po = await draft(9_250_020);
  await submitPurchaseOrder(uzman, po.id);
  const depo = ctxFor(db, await addUser(db, "depo", "mudur"));
  await expect(approvePurchaseOrder(depo, po.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const other = ctxFor(db, await addUser(db, "satinalma", "uzman", { email: "baska@baltacioglus.example" }));
  await expect(approvePurchaseOrder(other, po.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(canApprove(depo.user, (await row(po.id)) as never)).toBe(false);
  const salesUser = ctxFor(db, await addUser(db, "satis", "uzman"));
  await expect(submitPurchaseOrder(salesUser, po.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("çift tıklama: aynı anda iki onay yalnızca birini geçirir", async () => {
  const po = await draft(30_000_000);
  await submitPurchaseOrder(uzman, po.id);
  const results = await Promise.allSettled([approvePurchaseOrder(yonetim, po.id), approvePurchaseOrder(yonetim, po.id)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await history(po.id, "approve")).toHaveLength(1);
});

test("tek müdür kademe 1 siparişi gönderemez: başka onaycı yoksa reddedilir, sipariş taslak kalır", async () => {
  const tek = ctxFor(db, await addUser(db, "satinalma", "mudur", { name: "Tek Müdür", email: "tek@baltacioglus.example" }));
  // Ayla Güneş (müdür) ve Nermin Aksoy (Yönetim) hesabı kapalı; yalnızca Tek Müdür onaycı.
  await db.update(users).set({ active: false }).where(eq(users.id, mudur.user.id));
  await db.update(users).set({ active: false }).where(eq(users.id, yonetim.user.id));
  const po = await draft(9_250_020, tek);
  await expect(submitPurchaseOrder(tek, po.id)).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Bu tutarı onaylayabilecek başka bir kullanıcı yok",
  });
  expect(await row(po.id)).toMatchObject({ status: "draft", submittedAt: null });
});

test("etkin olmayan kullanıcı 'başka onaycı' sayılmaz; hesap açılınca gönderim geçer", async () => {
  await db.update(users).set({ active: false }).where(eq(users.id, mudur.user.id));
  await db.update(users).set({ active: false }).where(eq(users.id, yonetim.user.id));
  const po = await draft(9_250_020);
  await expect(submitPurchaseOrder(uzman, po.id)).rejects.toMatchObject({ code: "VALIDATION" });
  await db.update(users).set({ active: true }).where(eq(users.id, mudur.user.id));
  expect(await submitPurchaseOrder(uzman, po.id)).toMatchObject({ sent: false, order: { status: "pending_approval", requiredTier: 1 } });
});

test("kademe 2 gönderim özeti: iki onay ve Yönetim eşiği yazılır", async () => {
  const po = await draft(30_000_000);
  await submitPurchaseOrder(uzman, po.id);
  expect(await history(po.id, "submit")).toEqual([
    `${po.code} onaya gönderildi: ₺300.000,00 KDV hariç, 250.000 TL eşiği aşıldı → Satın Alma müdürü ve Yönetim onayı`,
  ]);
});

test("Yönetim kademe 1 siparişi onaylarsa yalnızca müdür alanları dolar", async () => {
  const po = await draft(9_250_020);
  await submitPurchaseOrder(uzman, po.id);
  const { order, sent } = await approvePurchaseOrder(yonetim, po.id);
  expect(sent).toBe(true);
  expect(order).toMatchObject({ status: "sent", managerApprovedBy: yonetim.user.id, managerApprovedAt: NOW, boardApprovedBy: null, boardApprovedAt: null });
});

test("kademe ve gösterilen net aynı yuvarlamayı kullanır: kuruşun yarısı yukarı, SQL ile JS aynı", async () => {
  // 1,5 adet × ₺33.333,33 = 4.999.999,5 kuruş → 5.000.000 (eşik dahil, onay yok); bir kuruş fazlası 5.000.001 (müdür onayı).
  const at = await draft(3_333_333);
  await db.update(purchaseOrderLines).set({ qtyMilli: 1500 }).where(eq(purchaseOrderLines.orderId, at.id));
  const over = await draft(3_333_334);
  await db.update(purchaseOrderLines).set({ qtyMilli: 1500 }).where(eq(purchaseOrderLines.orderId, over.id));
  const thresholds = await approvalThresholds(db);

  const rows = await listPurchaseOrders(db, { now: NOW });
  for (const [po, net, tier] of [
    [at, 5_000_000, 0],
    [over, 5_000_001, 1],
  ] as const) {
    const listed = rows.find((r) => r.id === po.id)!;
    expect(listed.netKurus).toBe(net); // sorgudaki SQL net
    expect(await inTxNet(po.id)).toBe(net); // servis (orderNet)
    expect(requiredTier(listed.netKurus, thresholds)).toBe(tier);
  }
  expect((await submitPurchaseOrder(uzman, at.id)).order.requiredTier).toBe(0);
  expect((await submitPurchaseOrder(uzman, over.id)).order.requiredTier).toBe(1);
});

async function inTxNet(orderId: string): Promise<number> {
  return orderNet(uzman, orderId);
}