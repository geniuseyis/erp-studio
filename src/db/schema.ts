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
export const PRODUCT_FINISHES = ["beyaz", "ahsap"] as const;
export const CUSTOMER_KINDS = ["bireysel", "kurumsal"] as const;
export const ORDER_STATUSES = ["draft", "confirmed", "in_production", "ready", "shipped", "cancelled"] as const;
export const LINE_STATUSES = ["draft", "waiting_material", "in_production", "ready", "shipped", "cancelled"] as const;
export const WORK_ORDER_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export const PRODUCT_MOVEMENT_TYPES = ["production_in", "reserve", "unreserve", "ship"] as const;

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

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const stations = pgTable(
  "stations",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    seq: integer("seq").notNull(),
    dailyCapacityMin: integer("daily_capacity_min").notNull(),
  },
  (t) => [check("stations_capacity_check", sql`${t.dailyCapacityMin} > 0`)],
);

/** Mamul kataloğu. Fiyatlar KDV hariç kuruş; adetler her zaman 1000'in katı milli. */
export const products = pgTable(
  "products",
  {
    id: id(),
    code: text("code").notNull().unique(),
    modelKey: text("model_key").notNull(),
    name: text("name").notNull(),
    collection: text("collection").notNull(),
    category: text("category").notNull(),
    widthMm: integer("width_mm").notNull(),
    depthMm: integer("depth_mm").notNull(),
    heightMm: integer("height_mm").notNull(),
    finish: text("finish").notNull(),
    priceKurus: money("price_kurus"),
    /** Yüzde olarak: 10 ya da 20. */
    vatRate: integer("vat_rate").notNull(),
    onHandMilli: qty("on_hand_milli"),
    reservedMilli: qty("reserved_milli"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("products_model_finish_unique").on(t.modelKey, t.finish),
    check("products_finish_check", sql`${t.finish} in (${inList(PRODUCT_FINISHES)})`),
    check("products_vat_check", sql`${t.vatRate} in (10, 20)`),
    check("products_price_check", sql`${t.priceKurus} >= 0`),
    check("products_reserved_check", sql`${t.reservedMilli} >= 0 and ${t.reservedMilli} <= ${t.onHandMilli}`),
  ],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    qtyMilli: bigint("qty_milli", { mode: "number" }).notNull(),
    scrapPermille: integer("scrap_permille").notNull().default(0),
  },
  (t) => [
    unique("bom_lines_unique").on(t.productId, t.materialId),
    check("bom_lines_qty_check", sql`${t.qtyMilli} > 0`),
    check("bom_lines_scrap_check", sql`${t.scrapPermille} >= 0 and ${t.scrapPermille} <= 500`),
  ],
);

export const routings = pgTable(
  "routings",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    minutesPerUnit: integer("minutes_per_unit").notNull(),
  },
  (t) => [
    unique("routings_unique").on(t.productId, t.seq),
    check("routings_minutes_check", sql`${t.minutesPerUnit} > 0`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    city: text("city").notNull(),
    district: text("district").notNull(),
    phone: text("phone").notNull(),
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("customers_kind_check", sql`${t.kind} in (${inList(CUSTOMER_KINDS)})`),
    check("customers_term_check", sql`${t.paymentTermDays} >= 0`),
  ],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: id(),
    code: text("code").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: text("status").notNull().default("draft"),
    dueAt: tstz("due_at"),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    confirmedAt: tstz("confirmed_at"),
    shippedAt: tstz("shipped_at"),
    cancelledAt: tstz("cancelled_at"),
  },
  (t) => [check("sales_orders_status_check", sql`${t.status} in (${inList(ORDER_STATUSES)})`)],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qtyMilli: bigint("qty_milli", { mode: "number" }).notNull(),
    unitPriceKurus: money("unit_price_kurus"),
    discountPermille: integer("discount_permille").notNull().default(0),
    vatRate: integer("vat_rate").notNull(),
    status: text("status").notNull().default("draft"),
    reservedMilli: qty("reserved_milli"),
    createdAt: createdAt(),
  },
  (t) => [
    check("sales_order_lines_qty_check", sql`${t.qtyMilli} > 0 and ${t.qtyMilli} % 1000 = 0`),
    check("sales_order_lines_discount_check", sql`${t.discountPermille} >= 0 and ${t.discountPermille} <= 500`),
    check("sales_order_lines_reserved_check", sql`${t.reservedMilli} >= 0 and ${t.reservedMilli} <= ${t.qtyMilli}`),
    check("sales_order_lines_status_check", sql`${t.status} in (${inList(LINE_STATUSES)})`),
  ],
);

export const workOrders = pgTable(
  "work_orders",
  {
    id: id(),
    code: text("code").notNull().unique(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qtyMilli: bigint("qty_milli", { mode: "number" }).notNull(),
    salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
    status: text("status").notNull().default("planned"),
    materialsReserved: boolean("materials_reserved").notNull().default(false),
    plannedStart: tstz("planned_start"),
    startedAt: tstz("started_at"),
    completedAt: tstz("completed_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("work_orders_qty_check", sql`${t.qtyMilli} > 0 and ${t.qtyMilli} % 1000 = 0`),
    check("work_orders_status_check", sql`${t.status} in (${inList(WORK_ORDER_STATUSES)})`),
  ],
);

export const workOrderSteps = pgTable(
  "work_order_steps",
  {
    id: id(),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    minutes: integer("minutes").notNull(),
    plannedDay: tstz("planned_day"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    startedBy: uuid("started_by").references(() => users.id),
    finishedBy: uuid("finished_by").references(() => users.id),
  },
  (t) => [
    unique("work_order_steps_unique").on(t.workOrderId, t.seq),
    check("work_order_steps_finished_check", sql`${t.finishedAt} is null or ${t.startedAt} is not null`),
  ],
);

/** Mamul stok defteri. Eldeki ve ayrılmış mamul yalnızca buraya yazılan hareketlerle değişir. */
export const productMovements = pgTable(
  "product_movements",
  {
    id: id(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type").notNull(),
    deltaOnHandMilli: bigint("delta_on_hand_milli", { mode: "number" }).notNull(),
    deltaReservedMilli: bigint("delta_reserved_milli", { mode: "number" }).notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note").notNull().default(""),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("product_movements_type_check", sql`${t.type} in (${inList(PRODUCT_MOVEMENT_TYPES)})`),
    index("product_movements_product_idx").on(t.productId, t.createdAt),
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
