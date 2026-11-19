import type { Db } from "@/db/client";
import { bomLines, customers, departments, materials, products, routings, stations, supplierItems, suppliers, users } from "@/db/schema";
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

let productSeq = 0;
/** Doğrudan tabloya stoksuz bir mamul ekler. */
export async function addProduct(
  db: Db,
  over: Partial<typeof products.$inferInsert> = {},
): Promise<typeof products.$inferSelect> {
  productSeq += 1;
  const [row] = await db
    .insert(products)
    .values({
      code: `MAM-${String(productSeq).padStart(4, "0")}`,
      modelKey: `test-model-${productSeq}`,
      name: `Test mamul ${productSeq}`,
      collection: "Test",
      category: "koltuk",
      widthMm: 800,
      depthMm: 800,
      heightMm: 800,
      finish: "beyaz",
      priceKurus: 100_000,
      vatRate: 10,
      ...over,
    })
    .returning();
  if (!row) throw new Error("mamul eklenemedi");
  return row;
}

let stationSeq = 0;
export async function addStation(
  db: Db,
  over: Partial<typeof stations.$inferInsert> = {},
): Promise<typeof stations.$inferSelect> {
  stationSeq += 1;
  const [row] = await db
    .insert(stations)
    .values({
      code: `IST-${String(stationSeq).padStart(2, "0")}`,
      name: `Test istasyon ${stationSeq}`,
      seq: stationSeq,
      dailyCapacityMin: 480,
      ...over,
    })
    .returning();
  if (!row) throw new Error("istasyon eklenemedi");
  return row;
}

let customerSeq = 0;
export async function addCustomer(
  db: Db,
  over: Partial<typeof customers.$inferInsert> = {},
): Promise<typeof customers.$inferSelect> {
  customerSeq += 1;
  const [row] = await db
    .insert(customers)
    .values({
      code: `MUS-${String(customerSeq).padStart(4, "0")}`,
      name: `Test müşteri ${customerSeq}`,
      kind: "bireysel",
      city: "İstanbul",
      district: "Kadıköy",
      phone: "0212 000 00 00",
      ...over,
    })
    .returning();
  if (!row) throw new Error("müşteri eklenemedi");
  return row;
}

/** Doğrudan tabloya bir reçete kalemi ekler. */
export async function addBomLine(
  db: Db,
  i: { productId: string; materialId: string; qtyMilli: number; scrapPermille?: number },
): Promise<void> {
  await db.insert(bomLines).values({ ...i, scrapPermille: i.scrapPermille ?? 0 });
}

/** Doğrudan tabloya bir rota adımı ekler. */
export async function addRouting(
  db: Db,
  i: { productId: string; seq: number; stationId: string; minutesPerUnit: number },
): Promise<void> {
  await db.insert(routings).values(i);
}

let supplierSeq = 0;
/** Doğrudan tabloya bir tedarikçi ekler. */
export async function addSupplier(
  db: Db,
  over: Partial<typeof suppliers.$inferInsert> = {},
): Promise<typeof suppliers.$inferSelect> {
  supplierSeq += 1;
  const [row] = await db
    .insert(suppliers)
    .values({
      code: `TED-${String(supplierSeq).padStart(4, "0")}`,
      name: `Test tedarikçi ${supplierSeq}`,
      city: "Sakarya",
      contact: "Test Yetkili",
      phone: "0264 000 00 00",
      paymentTermDays: 30,
      leadTimeDays: 5,
      ...over,
    })
    .returning();
  if (!row) throw new Error("tedarikçi eklenemedi");
  return row;
}

/** Doğrudan tabloya bir tedarikçi fiyat kalemi ekler. */
export async function addSupplierItem(
  db: Db,
  i: { supplierId: string; materialId: string; unitPriceMinor: number; moqMilli?: number; isPreferred?: boolean },
): Promise<void> {
  await db.insert(supplierItems).values({ ...i, moqMilli: i.moqMilli ?? 0, isPreferred: i.isPreferred ?? false });
}
