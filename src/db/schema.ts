import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// Para sütunları kuruş, miktar sütunları binde birim ("milli") tam sayıdır. Bkz. src/domain/units.ts.
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const qty = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const DEPARTMENT_CODES = ["yonetim", "satis", "planlama", "atolye", "depo", "satinalma", "bt"] as const;
export const LEVELS = ["mudur", "uzman", "operator"] as const;
export const MATERIAL_CATEGORIES = ["panel", "masif", "kenar_bandi", "hirdavat", "boya", "kumas", "ambalaj"] as const;
export const MATERIAL_UNITS = ["plaka", "m2", "m", "m3", "adet", "L", "kg"] as const;
export const MOVEMENT_TYPES = ["receipt", "issue", "reserve", "unreserve", "consume", "count_adjust"] as const;
export const COUNT_STATUSES = ["open", "approved", "cancelled"] as const;

/** Veritabanının kendisi hakkında anahtar-değer kayıtları: şema sürümü, örnek verinin yüklenip yüklenmediği. */
export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const departments = pgTable(
  "departments",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
  },
  (t) => [check("departments_code_check", sql`${t.code} in (${inList(DEPARTMENT_CODES)})`)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    departmentCode: text("department_code")
      .notNull()
      .references(() => departments.code),
    level: text("level").notNull(),
    title: text("title").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("users_level_check", sql`${t.level} in (${inList(LEVELS)})`),
    check("users_email_lower_check", sql`${t.email} = lower(${t.email})`),
  ],
);

export const materials = pgTable(
  "materials",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    onHandMilli: qty("on_hand_milli"),
    reservedMilli: qty("reserved_milli"),
    safetyStockMilli: qty("safety_stock_milli"),
    reorderPointMilli: qty("reorder_point_milli"),
    avgCostKurus: money("avg_cost_kurus"),
    leadTimeDays: integer("lead_time_days").notNull().default(7),
    shelf: text("shelf").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("materials_category_check", sql`${t.category} in (${inList(MATERIAL_CATEGORIES)})`),
    check("materials_unit_check", sql`${t.unit} in (${inList(MATERIAL_UNITS)})`),
    check("materials_on_hand_check", sql`${t.onHandMilli} >= 0`),
    check("materials_reserved_check", sql`${t.reservedMilli} >= 0 and ${t.reservedMilli} <= ${t.onHandMilli}`),
    check(
      "materials_levels_check",
      sql`${t.safetyStockMilli} >= 0 and ${t.reorderPointMilli} >= 0 and ${t.avgCostKurus} >= 0`,
    ),
  ],
);

/** Stok defteri. Eldeki ve ayrılmış miktar yalnızca buraya yazılan hareketlerle değişir. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    /** Yazılış sırası. Aynı ana düşen hareketleri sıralamak için. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    type: text("type").notNull(),
    deltaOnHandMilli: bigint("delta_on_hand_milli", { mode: "number" }).notNull(),
    deltaReservedMilli: bigint("delta_reserved_milli", { mode: "number" }).notNull(),
    unitCostKurus: bigint("unit_cost_kurus", { mode: "number" }),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note").notNull().default(""),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("stock_movements_type_check", sql`${t.type} in (${inList(MOVEMENT_TYPES)})`),
    index("stock_movements_material_idx").on(t.materialId, t.createdAt),
  ],
);

export const stockCounts = pgTable(
  "stock_counts",
  {
    id: id(),
    code: text("code").notNull().unique(),
    status: text("status").notNull().default("open"),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: createdAt(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [check("stock_counts_status_check", sql`${t.status} in (${inList(COUNT_STATUSES)})`)],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: id(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    /** Fiş açıldığı andaki eldeki miktar. */
    systemMilli: bigint("system_milli", { mode: "number" }).notNull(),
    /** null: henüz sayılmadı. */
    countedMilli: bigint("counted_milli", { mode: "number" }),
  },
  (t) => [
    unique("stock_count_lines_unique").on(t.countId, t.materialId),
    check("stock_count_lines_counted_check", sql`${t.countedMilli} is null or ${t.countedMilli} >= 0`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
