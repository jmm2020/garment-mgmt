CREATE TYPE "public"."user_role" AS ENUM('admin', 'production_staff', 'inventory_staff', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."vendor_type" AS ENUM('mill', 'trim_supplier', 'dye_house', 'cut_make', 'notion', 'label', 'other');--> statement-breakpoint
CREATE TYPE "public"."material_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."material_type" AS ENUM('fabric_shell', 'fabric_lining', 'fabric_insulation', 'zipper', 'snap', 'button', 'thread', 'label', 'tape', 'webbing', 'elastic', 'other');--> statement-breakpoint
CREATE TYPE "public"."unit_of_measure" AS ENUM('yard', 'meter', 'each', 'gram', 'kilogram');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('draft', 'sent', 'confirmed', 'partial', 'received', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('receipt', 'consumption', 'adjustment', 'transfer', 'scrap', 'remnant_return');--> statement-breakpoint
CREATE TYPE "public"."quality_status" AS ENUM('pending_qc', 'passed', 'quarantined', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('in_design', 'sampling', 'approved', 'in_production', 'retired');--> statement-breakpoint
CREATE TYPE "public"."bom_status" AS ENUM('draft', 'approved', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."cut_ticket_status" AS ENUM('draft', 'allocated', 'in_cutting', 'cut', 'distributed', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."remnant_status" AS ENUM('available', 'reissued', 'scrap');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" bigint,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"vendor_type" "vendor_type" NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"address" jsonb,
	"certifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"country" char(2),
	"status" "vendor_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_variants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "material_variants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"material_id" bigint NOT NULL,
	"variant_sku" text NOT NULL,
	"colorway" text,
	"size_spec" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "materials" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "materials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"material_type" "material_type" NOT NULL,
	"unit_of_measure" "unit_of_measure" NOT NULL,
	"composition" jsonb,
	"preferred_vendor_id" bigint,
	"reorder_point" numeric(12, 3),
	"target_stock" numeric(12, 3),
	"notes" text,
	"status" "material_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"po_id" bigint NOT NULL,
	"material_variant_id" bigint NOT NULL,
	"quantity_ordered" numeric(12, 3) NOT NULL,
	"unit_cost" numeric(12, 4) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_lines_qty_positive" CHECK ("purchase_order_lines"."quantity_ordered" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"po_number" text NOT NULL,
	"vendor_id" bigint NOT NULL,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"ordered_at" timestamp with time zone,
	"expected_at" date,
	"total_estimated" numeric(14, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lot_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lot_id" bigint NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"reference_type" text,
	"reference_id" bigint,
	"actor_user_id" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_lots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "material_lots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"material_variant_id" bigint NOT NULL,
	"lot_code" text NOT NULL,
	"dye_lot" text,
	"roll_number" text,
	"country_of_origin" char(2),
	"quantity_received" numeric(12, 3) NOT NULL,
	"quantity_remaining" numeric(12, 3) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by_user_id" bigint,
	"po_line_id" bigint,
	"cert_data" jsonb,
	"quality_status" "quality_status" DEFAULT 'pending_qc' NOT NULL,
	"defects_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_lots_qty_remaining_nonneg" CHECK ("material_lots"."quantity_remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_variants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_variants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" bigint NOT NULL,
	"size" text NOT NULL,
	"colorway" text NOT NULL,
	"fg_sku" text NOT NULL,
	"upc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_fg_sku_unique" UNIQUE("fg_sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"style_code" text NOT NULL,
	"name" text NOT NULL,
	"season" text,
	"status" "product_status" DEFAULT 'in_design' NOT NULL,
	"base_sam_minutes" numeric(8, 3),
	"target_cogs_cents" integer,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_style_code_unique" UNIQUE("style_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_components" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bom_components_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bom_id" bigint NOT NULL,
	"material_variant_id" bigint NOT NULL,
	"quantity_per_unit" numeric(12, 4) NOT NULL,
	"unit_of_measure" "unit_of_measure" NOT NULL,
	"position" text,
	"is_visible_panel" boolean DEFAULT false NOT NULL,
	"size_curve" jsonb,
	"waste_factor_pct" numeric(5, 2) DEFAULT '8.00' NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "boms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"status" "bom_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" bigint,
	"approved_at" timestamp with time zone,
	"effective_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "markers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "markers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"product_id" bigint NOT NULL,
	"size_range" text,
	"width_inches" numeric(5, 2) NOT NULL,
	"length_inches" numeric(6, 2) NOT NULL,
	"efficiency_pct" numeric(5, 2) NOT NULL,
	"fabric_required_per_unit" numeric(8, 4),
	"file_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cut_ticket_lots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cut_ticket_lots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cut_ticket_id" bigint NOT NULL,
	"material_lot_id" bigint NOT NULL,
	"bom_component_id" bigint NOT NULL,
	"planned_quantity" numeric(12, 3) NOT NULL,
	"actual_quantity_cut" numeric(12, 3),
	"actual_quantity_returned" numeric(12, 3) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cut_tickets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cut_tickets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ticket_number" text NOT NULL,
	"product_id" bigint NOT NULL,
	"bom_id" bigint NOT NULL,
	"marker_id" bigint,
	"status" "cut_ticket_status" DEFAULT 'draft' NOT NULL,
	"planned_quantity_by_size" jsonb NOT NULL,
	"target_completion_at" date,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by_user_id" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cut_tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remnants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "remnants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_lot_id" bigint NOT NULL,
	"cut_ticket_lot_id" bigint NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"dimensions" jsonb,
	"location_bin" text,
	"status" "remnant_status" DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_variants" ADD CONSTRAINT "material_variants_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "materials" ADD CONSTRAINT "materials_preferred_vendor_id_vendors_id_fk" FOREIGN KEY ("preferred_vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_variant_id_material_variants_id_fk" FOREIGN KEY ("material_variant_id") REFERENCES "public"."material_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_lot_id_material_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."material_lots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_material_variant_id_material_variants_id_fk" FOREIGN KEY ("material_variant_id") REFERENCES "public"."material_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_material_variant_id_material_variants_id_fk" FOREIGN KEY ("material_variant_id") REFERENCES "public"."material_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boms" ADD CONSTRAINT "boms_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "markers" ADD CONSTRAINT "markers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_ticket_lots" ADD CONSTRAINT "cut_ticket_lots_cut_ticket_id_cut_tickets_id_fk" FOREIGN KEY ("cut_ticket_id") REFERENCES "public"."cut_tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_ticket_lots" ADD CONSTRAINT "cut_ticket_lots_material_lot_id_material_lots_id_fk" FOREIGN KEY ("material_lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_ticket_lots" ADD CONSTRAINT "cut_ticket_lots_bom_component_id_bom_components_id_fk" FOREIGN KEY ("bom_component_id") REFERENCES "public"."bom_components"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_tickets" ADD CONSTRAINT "cut_tickets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_tickets" ADD CONSTRAINT "cut_tickets_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_tickets" ADD CONSTRAINT "cut_tickets_marker_id_markers_id_fk" FOREIGN KEY ("marker_id") REFERENCES "public"."markers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cut_tickets" ADD CONSTRAINT "cut_tickets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remnants" ADD CONSTRAINT "remnants_parent_lot_id_material_lots_id_fk" FOREIGN KEY ("parent_lot_id") REFERENCES "public"."material_lots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remnants" ADD CONSTRAINT "remnants_cut_ticket_lot_id_cut_ticket_lots_id_fk" FOREIGN KEY ("cut_ticket_lot_id") REFERENCES "public"."cut_ticket_lots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_variants_sku_idx" ON "material_variants" USING btree ("variant_sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_variants_mat_color_idx" ON "material_variants" USING btree ("material_id","colorway");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_lines_po_idx" ON "purchase_order_lines" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_status_expected_idx" ON "purchase_orders" USING btree ("status","expected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_movements_lot_created_idx" ON "lot_movements" USING btree ("lot_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_movements_ref_idx" ON "lot_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_lots_variant_lot_unique" ON "material_lots" USING btree ("material_variant_id","lot_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_lots_variant_received_idx" ON "material_lots" USING btree ("material_variant_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_lots_dye_lot_idx" ON "material_lots" USING btree ("dye_lot") WHERE "material_lots"."dye_lot" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_lots_quality_idx" ON "material_lots" USING btree ("quality_status") WHERE "material_lots"."quality_status" <> 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_unique_idx" ON "product_variants" USING btree ("product_id","size","colorway");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "boms_product_version_unique" ON "boms" USING btree ("product_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "boms_active_unique_idx" ON "boms" USING btree ("product_id") WHERE "boms"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cut_ticket_lots_ticket_idx" ON "cut_ticket_lots" USING btree ("cut_ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cut_ticket_lots_lot_idx" ON "cut_ticket_lots" USING btree ("material_lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cut_tickets_status_target_idx" ON "cut_tickets" USING btree ("status","target_completion_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remnants_parent_lot_idx" ON "remnants" USING btree ("parent_lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remnants_available_idx" ON "remnants" USING btree ("status") WHERE "remnants"."status" = 'available';