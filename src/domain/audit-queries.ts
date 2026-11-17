// Kayıt çekmecelerindeki "Geçmiş" bölümünün ve İşlemler ekranının sorguları. Yalnızca okur.
import { and, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, customers, departments, materials, products, salesOrderLines, salesOrders, stockCounts, users, workOrders } from "@/db/schema";
import { type DepartmentCode, isUuid, type SessionUser } from "./context";
import { can } from "./permissions";
import { istanbulDayStart } from "./production/calendar";
import { matchesSearch } from "./text";

export type HistoryEntry = { id: string; at: Date; userName: string; departmentName: string; action: string; summary: string };

/** Geçmişi istenen kayıt. `actions` verilirse o kaydın yalnızca bu işlemleri alınır. */
export type HistoryRef = { entity: string; entityId: string; actions?: string[] };

export const HISTORY_LIMIT = 50;

/**
 * Verilen kayıtların işlem geçmişi, yeniden eskiye, en çok `limit` satır. Aynı anda (aynı transaction'da) yazılan
 * satırlar yazılış sırasının tersiyle gelir.
 */
export async function listHistory(db: Db, refs: HistoryRef[], limit: number = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  if (refs.length === 0) return [];
  const match = refs.map((r) =>
    and(
      eq(auditLog.entity, r.entity),
      eq(auditLog.entityId, r.entityId),
      r.actions && r.actions.length > 0 ? inArray(auditLog.action, r.actions) : undefined,
    ),
  );
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      userName: users.name,
      departmentName: departments.name,
      action: auditLog.action,
      summary: auditLog.summary,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.userId))
    .innerJoin(departments, eq(departments.code, users.departmentCode))
    .where(or(...match))
    // Denetim satırı hiç güncellenmez; fiziksel konum (ctid) yazılış sırasıdır.
    .orderBy(desc(auditLog.createdAt), sql`${auditLog}.ctid desc`)
    .limit(limit);
  return rows;
}

/** Siparişin geçmişi: siparişin kendi kayıtları ve satırlarına açılmış iş emirlerinin kayıtları. */
export async function listOrderHistory(db: Db, orderId: string, limit: number = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  if (!isUuid(orderId)) return [];
  const linked = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .where(eq(salesOrderLines.orderId, orderId));
  return listHistory(
    db,
    [{ entity: "sales_order", entityId: orderId }, ...linked.map((w) => ({ entity: "work_order", entityId: w.id }))],
    limit,
  );
}

/** İş emrinin geçmişi: kendi kayıtları ve (siparişe bağlıysa) siparişin onay kaydı. */
export async function listWorkOrderHistory(db: Db, workOrderId: string, limit: number = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  if (!isUuid(workOrderId)) return [];
  const [line] = await db
    .select({ orderId: salesOrderLines.orderId })
    .from(workOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .where(eq(workOrders.id, workOrderId));
  const refs: HistoryRef[] = [{ entity: "work_order", entityId: workOrderId }];
  if (line) refs.push({ entity: "sales_order", entityId: line.orderId, actions: ["confirm"] });
  return listHistory(db, refs, limit);
}

// ── İşlemler ekranı: bütün kayıtların işlem geçmişi ─────────────────────────────────────────────

export type ActivityFilter = { search?: string; entity?: string; departmentCode?: DepartmentCode; userId?: string; from?: Date; to?: Date; limit?: number };

/**
 * Ekranın bir satırı. `recordLabel`: kaydın kodu (müşteri, ürün ve malzemede kod ve ad, kullanıcıda ad); kayıt artık yoksa
 * özetteki kod ya da "silinmiş kayıt"; bilinmeyen türde null. `recordHref`: kaydı açan ekranın adresi; kayıt yoksa null.
 * Bağlantının gösterilip gösterilmeyeceğine (kullanıcı o ekranı görüyor mu) arayüz karar verir.
 */
export type ActivityRow = HistoryEntry & {
  entity: string;
  entityId: string;
  userId: string;
  departmentCode: DepartmentCode;
  recordLabel: string | null;
  recordHref: string | null;
};

export const ACTIVITY_LIMIT = 500;

/** İşlemleri soran kişi: kullanıcı kayıtları yalnızca Kullanıcılar modülünü görebilenlere açılır. */
export type ActivityViewer = Pick<SessionUser, "departmentCode" | "level">;
export const DELETED_RECORD = "silinmiş kayıt";

type Resolved = { label: string; href: string };
type Resolver = (db: Db, ids: string[]) => Promise<Map<string, Resolved>>;

const opens = (path: string, id: string, label: string, param = "ac"): [string, Resolved] => [id, { label, href: `${path}?${param}=${id}` }];

/** Kayıt türü başına tek toplu okuma: verilen kimliklerin etiketi ve ekran adresi. */
const RESOLVERS: Record<string, Resolver> = {
  async sales_order(db, ids) {
    const rows = await db.select({ id: salesOrders.id, code: salesOrders.code }).from(salesOrders).where(inArray(salesOrders.id, ids));
    return new Map(rows.map((r) => opens("/satis/siparisler", r.id, r.code)));
  },
  async customer(db, ids) {
    const rows = await db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(inArray(customers.id, ids));
    return new Map(rows.map((r) => opens("/satis/musteriler", r.id, `${r.code} ${r.name}`)));
  },
  async work_order(db, ids) {
    const rows = await db.select({ id: workOrders.id, code: workOrders.code }).from(workOrders).where(inArray(workOrders.id, ids));
    return new Map(rows.map((r) => opens("/uretim/is-emirleri", r.id, r.code)));
  },
  async product(db, ids) {
    const rows = await db.select({ id: products.id, code: products.code, name: products.name }).from(products).where(inArray(products.id, ids));
    return new Map(rows.map((r) => opens("/uretim/urunler", r.id, `${r.code} ${r.name}`)));
  },
  async material(db, ids) {
    const rows = await db.select({ id: materials.id, code: materials.code, name: materials.name }).from(materials).where(inArray(materials.id, ids));
    return new Map(rows.map((r) => opens("/stok/malzemeler", r.id, `${r.code} ${r.name}`)));
  },
  async stock_count(db, ids) {
    const rows = await db.select({ id: stockCounts.id, code: stockCounts.code }).from(stockCounts).where(inArray(stockCounts.id, ids));
    return new Map(rows.map((r) => opens("/stok/sayim", r.id, r.code, "fis")));
  },
  // Kullanıcının çekmecesi yok: liste o kişinin adıyla aranmış açılır.
  async user(db, ids) {
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
    return new Map(rows.map((r) => [r.id, { label: r.name, href: `/yonetim/kullanicilar?q=${encodeURIComponent(r.name)}` }]));
  },
};

/** Özetin başındaki belge kodu: "SIP-2026-0077: satır silindi …" → "SIP-2026-0077". */
const SUMMARY_CODE = /^([A-Z]{2,4}-(?:\d{4}-)?\d{3,})\b/;

/**
 * Bütün kayıtların işlem geçmişi, yeniden eskiye, en çok `limit` (varsayılan 500) satır. Tür, departman, kişi ve tarih
 * (`from` dahil, `to` hariç) veritabanında süzülür; metin araması (özet, kayıt etiketi, kişi adı) etiketler çözüldükten
 * sonra bellekte yapılır ve sınırdan önce uygulanır. Etiketler kayıt türü başına tek sorguyla okunur. Kullanıcılar modülünü
 * göremeyen `viewer` için `user` kayıtları sorguda dışlanır (sınır ve sayılar dışlamadan sonra hesaplanır).
 */
export async function listActivity(db: Db, viewer: ActivityViewer, f: ActivityFilter = {}): Promise<ActivityRow[]> {
  const limit = f.limit ?? ACTIVITY_LIMIT;
  const search = f.search?.trim() ?? "";
  if (f.userId !== undefined && !isUuid(f.userId)) return [];

  const query = db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      userId: auditLog.userId,
      userName: users.name,
      departmentCode: users.departmentCode,
      departmentName: departments.name,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      action: auditLog.action,
      summary: auditLog.summary,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.userId))
    .innerJoin(departments, eq(departments.code, users.departmentCode))
    .where(
      and(
        can(viewer, "users", "view") ? undefined : ne(auditLog.entity, "user"),
        f.entity ? eq(auditLog.entity, f.entity) : undefined,
        f.departmentCode ? eq(users.departmentCode, f.departmentCode) : undefined,
        f.userId ? eq(auditLog.userId, f.userId) : undefined,
        f.from ? gte(auditLog.createdAt, f.from) : undefined,
        f.to ? lt(auditLog.createdAt, f.to) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), sql`${auditLog}.ctid desc`);
  // Arama bellekte yapıldığı için sınır ondan sonra uygulanır; aksi hâlde eski bir eşleşme bulunamazdı.
  const raw = await (search ? query : query.limit(limit));

  const idsByKind = new Map<string, Set<string>>();
  for (const r of raw) {
    if (!RESOLVERS[r.entity] || !isUuid(r.entityId)) continue;
    const set = idsByKind.get(r.entity) ?? new Set<string>();
    set.add(r.entityId);
    idsByKind.set(r.entity, set);
  }
  const resolved = new Map<string, Map<string, Resolved>>();
  for (const [kind, ids] of idsByKind) {
    const resolver = RESOLVERS[kind];
    if (resolver) resolved.set(kind, await resolver(db, [...ids]));
  }

  const rows: ActivityRow[] = [];
  for (const r of raw) {
    const found = resolved.get(r.entity)?.get(r.entityId);
    const recordLabel = found?.label ?? SUMMARY_CODE.exec(r.summary)?.[1] ?? (RESOLVERS[r.entity] ? DELETED_RECORD : null);
    if (search && !matchesSearch([r.summary, recordLabel ?? "", r.userName], search)) continue;
    rows.push({ ...r, departmentCode: r.departmentCode as DepartmentCode, recordLabel, recordHref: found?.href ?? null });
    if (rows.length >= limit) break;
  }
  return rows;
}

export type ActivityStats = {
  /** Bugün (İstanbul günü) yazılan işlem. */
  today: number;
  /** Bugün dahil son yedi İstanbul gününde yazılan işlem. */
  last7Days: number;
  /** Bu hafta (pazartesi–pazar, İstanbul) en çok işlem yapan departman; eşitlikte ada göre ilki. Hiç işlem yoksa null. */
  topDepartment: { code: DepartmentCode; name: string; count: number } | null;
};

const DAY_MS = 86_400_000;

/** İşlemler ekranının başlık bandı; hepsi veritabanından sayılır. */
export async function activityStats(db: Db, viewer: ActivityViewer, now: Date): Promise<ActivityStats> {
  const today = istanbulDayStart(now);
  const weekAgo = new Date(today.getTime() - 6 * DAY_MS);
  // İstanbul gününün haftadaki yeri: 0 pazartesi … 6 pazar. Gün başlangıcına 3 saat eklenince UTC tarihi İstanbul tarihidir.
  const weekday = (new Date(today.getTime() + 3 * 3_600_000).getUTCDay() + 6) % 7;
  const weekStart = new Date(today.getTime() - weekday * DAY_MS);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  const visible = can(viewer, "users", "view") ? undefined : ne(auditLog.entity, "user");
  const [counts] = await db
    .select({
      today: sql<number>`(count(*) filter (where ${auditLog.createdAt} >= ${today}))::int`,
      last7Days: sql<number>`count(*)::int`,
    })
    .from(auditLog)
    .where(and(gte(auditLog.createdAt, weekAgo), visible));
  const [top] = await db
    .select({ code: users.departmentCode, name: departments.name, count: sql<number>`count(*)::int` })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.userId))
    .innerJoin(departments, eq(departments.code, users.departmentCode))
    .where(and(gte(auditLog.createdAt, weekStart), lt(auditLog.createdAt, weekEnd), visible))
    .groupBy(users.departmentCode, departments.name)
    .orderBy(desc(sql`count(*)`), departments.name)
    .limit(1);
  return {
    today: counts?.today ?? 0,
    last7Days: counts?.last7Days ?? 0,
    topDepartment: top ? { code: top.code as DepartmentCode, name: top.name, count: top.count } : null,
  };
}
