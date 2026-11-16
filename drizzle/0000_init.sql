CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	"scrap_permille" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bom_lines_unique" UNIQUE("product_id","material_id"),
	CONSTRAINT "bom_lines_qty_check" CHECK ("bom_lines"."qty_milli" > 0),
	CONSTRAINT "bom_lines_scrap_check" CHECK ("bom_lines"."scrap_permille" >= 0 and "bom_lines"."scrap_permille" <= 500)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"phone" text NOT NULL,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code"),
	CONSTRAINT "customers_kind_check" CHECK ("customers"."kind" in ('bireysel', 'kurumsal')),
	CONSTRAINT "customers_term_check" CHECK ("customers"."payment_term_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code"),
	CONSTRAINT "departments_code_check" CHECK ("departments"."code" in ('yonetim', 'satis', 'planlama', 'atolye', 'depo', 'satinalma', 'bt'))
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"on_hand_milli" bigint DEFAULT 0 NOT NULL,
	"reserved_milli" bigint DEFAULT 0 NOT NULL,
	"safety_stock_milli" bigint DEFAULT 0 NOT NULL,
	"reorder_point_milli" bigint DEFAULT 0 NOT NULL,
	"avg_cost_kurus" bigint DEFAULT 0 NOT NULL,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"shelf" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_code_unique" UNIQUE("code"),
	CONSTRAINT "materials_category_check" CHECK ("materials"."category" in ('panel', 'masif', 'kenar_bandi', 'hirdavat', 'boya', 'kumas', 'ambalaj')),
	CONSTRAINT "materials_unit_check" CHECK ("materials"."unit" in ('plaka', 'm2', 'm', 'm3', 'adet', 'L', 'kg')),
	CONSTRAINT "materials_on_hand_check" CHECK ("materials"."on_hand_milli" >= 0),
	CONSTRAINT "materials_reserved_check" CHECK ("materials"."reserved_milli" >= 0 and "materials"."reserved_milli" <= "materials"."on_hand_milli"),
	CONSTRAINT "materials_levels_check" CHECK ("materials"."safety_stock_milli" >= 0 and "materials"."reorder_point_milli" >= 0 and "materials"."avg_cost_kurus" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"product_id" uuid NOT NULL,
	"type" text NOT NULL,
	"delta_on_hand_milli" bigint NOT NULL,
	"delta_reserved_milli" bigint NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"note" text DEFAULT '' NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_movements_type_check" CHECK ("product_movements"."type" in ('production_in', 'reserve', 'unreserve', 'ship'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"model_key" text NOT NULL,
	"name" text NOT NULL,
	"collection" text NOT NULL,
	"category" text NOT NULL,
	"width_mm" integer NOT NULL,
	"depth_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"finish" text NOT NULL,
	"price_kurus" bigint DEFAULT 0 NOT NULL,
	"vat_rate" integer NOT NULL,
	"on_hand_milli" bigint DEFAULT 0 NOT NULL,
	"reserved_milli" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code"),
	CONSTRAINT "products_model_finish_unique" UNIQUE("model_key","finish"),
	CONSTRAINT "products_finish_check" CHECK ("products"."finish" in ('beyaz', 'ahsap')),
	CONSTRAINT "products_vat_check" CHECK ("products"."vat_rate" in (10, 20)),
	CONSTRAINT "products_price_check" CHECK ("products"."price_kurus" >= 0),
	CONSTRAINT "products_reserved_check" CHECK ("products"."reserved_milli" >= 0 and "products"."reserved_milli" <= "products"."on_hand_milli")
);
--> statement-breakpoint
CREATE TABLE "routings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"station_id" uuid NOT NULL,
	"minutes_per_unit" integer NOT NULL,
	CONSTRAINT "routings_unique" UNIQUE("product_id","seq"),
	CONSTRAINT "routings_minutes_check" CHECK ("routings"."minutes_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	"unit_price_kurus" bigint DEFAULT 0 NOT NULL,
	"discount_permille" integer DEFAULT 0 NOT NULL,
	"vat_rate" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reserved_milli" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_lines_qty_check" CHECK ("sales_order_lines"."qty_milli" > 0 and "sales_order_lines"."qty_milli" % 1000 = 0),
	CONSTRAINT "sales_order_lines_discount_check" CHECK ("sales_order_lines"."discount_permille" >= 0 and "sales_order_lines"."discount_permille" <= 500),
	CONSTRAINT "sales_order_lines_reserved_check" CHECK ("sales_order_lines"."reserved_milli" >= 0 and "sales_order_lines"."reserved_milli" <= "sales_order_lines"."qty_milli"),
	CONSTRAINT "sales_order_lines_status_check" CHECK ("sales_order_lines"."status" in ('draft', 'waiting_material', 'in_production', 'ready', 'shipped', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "sales_orders_code_unique" UNIQUE("code"),
	CONSTRAINT "sales_orders_status_check" CHECK ("sales_orders"."status" in ('draft', 'confirmed', 'in_production', 'ready', 'shipped', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"seq" integer NOT NULL,
	"daily_capacity_min" integer NOT NULL,
	CONSTRAINT "stations_code_unique" UNIQUE("code"),
	CONSTRAINT "stations_capacity_check" CHECK ("stations"."daily_capacity_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"system_milli" bigint NOT NULL,
	"counted_milli" bigint,
	CONSTRAINT "stock_count_lines_unique" UNIQUE("count_id","material_id"),
	CONSTRAINT "stock_count_lines_counted_check" CHECK ("stock_count_lines"."counted_milli" is null or "stock_count_lines"."counted_milli" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "stock_counts_code_unique" UNIQUE("code"),
	CONSTRAINT "stock_counts_status_check" CHECK ("stock_counts"."status" in ('open', 'approved', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"material_id" uuid NOT NULL,
	"type" text NOT NULL,
	"delta_on_hand_milli" bigint NOT NULL,
	"delta_reserved_milli" bigint NOT NULL,
	"unit_cost_kurus" bigint,
	"ref_type" text,
	"ref_id" text,
	"note" text DEFAULT '' NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."type" in ('receipt', 'issue', 'reserve', 'unreserve', 'consume', 'count_adjust'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"department_code" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_level_check" CHECK ("users"."level" in ('mudur', 'uzman', 'operator')),
	CONSTRAINT "users_email_lower_check" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "work_order_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"station_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"planned_day" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"started_by" uuid,
	"finished_by" uuid,
	CONSTRAINT "work_order_steps_unique" UNIQUE("work_order_id","seq"),
	CONSTRAINT "work_order_steps_finished_check" CHECK ("work_order_steps"."finished_at" is null or "work_order_steps"."started_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_milli" bigint NOT NULL,
	"sales_order_line_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"materials_reserved" boolean DEFAULT false NOT NULL,
	"planned_start" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_code_unique" UNIQUE("code"),
	CONSTRAINT "work_orders_qty_check" CHECK ("work_orders"."qty_milli" > 0 and "work_orders"."qty_milli" % 1000 = 0),
	CONSTRAINT "work_orders_status_check" CHECK ("work_orders"."status" in ('planned', 'in_progress', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_movements" ADD CONSTRAINT "product_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_movements" ADD CONSTRAINT "product_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_finished_by_users_id_fk" FOREIGN KEY ("finished_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "product_movements_product_idx" ON "product_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_material_idx" ON "stock_movements" USING btree ("material_id","created_at");