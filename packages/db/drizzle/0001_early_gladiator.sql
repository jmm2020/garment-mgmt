CREATE TYPE "public"."cut_ticket_kind" AS ENUM('production', 'pvt');--> statement-breakpoint
CREATE TYPE "public"."production_batch_status" AS ENUM('received_from_cutter', 'staged_pre_prod', 'in_production', 'awaiting_qc', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."qc_verdict" AS ENUM('pass', 'fail', 'pass_with_notes');--> statement-breakpoint
CREATE TYPE "public"."pvt_status" AS ENUM('cutting', 'shipped', 'inspecting', 'validated', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "production_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_no" text NOT NULL,
	"cut_ticket_id" bigint NOT NULL,
	"product_variant_id" bigint NOT NULL,
	"status" "production_batch_status" DEFAULT 'received_from_cutter' NOT NULL,
	"qty_planned" numeric(12, 3) NOT NULL,
	"qty_actual" numeric(12, 3),
	"cutter_user_id" bigint NOT NULL,
	"qc_user_id" bigint,
	"qc_verdict" "qc_verdict",
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staged_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"submitted_qc_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"shopify_pushed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_batches_batch_no_unique" UNIQUE("batch_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "production_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_user_id" bigint,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_validation_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "production_validation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_no" text NOT NULL,
	"product_variant_id" bigint NOT NULL,
	"marker_id" bigint NOT NULL,
	"cut_ticket_id" bigint NOT NULL,
	"status" "pvt_status" DEFAULT 'cutting' NOT NULL,
	"cutter_user_id" bigint NOT NULL,
	"validator_user_id" bigint,
	"cut_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shipped_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"validity_months" integer,
	"rejected_reason" text,
	"cancel_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_validation_runs_run_no_unique" UNIQUE("run_no")
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "line" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "size_dim" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "season_dim" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "fabric_type" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pvt_validity_months" integer;--> statement-breakpoint
ALTER TABLE "cut_tickets" ADD COLUMN "kind" "cut_ticket_kind" DEFAULT 'production' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_cut_ticket_id_cut_tickets_id_fk" FOREIGN KEY ("cut_ticket_id") REFERENCES "public"."cut_tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_cutter_user_id_users_id_fk" FOREIGN KEY ("cutter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_qc_user_id_users_id_fk" FOREIGN KEY ("qc_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_events" ADD CONSTRAINT "production_events_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_events" ADD CONSTRAINT "production_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_validation_runs" ADD CONSTRAINT "production_validation_runs_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_validation_runs" ADD CONSTRAINT "production_validation_runs_marker_id_markers_id_fk" FOREIGN KEY ("marker_id") REFERENCES "public"."markers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_validation_runs" ADD CONSTRAINT "production_validation_runs_cut_ticket_id_cut_tickets_id_fk" FOREIGN KEY ("cut_ticket_id") REFERENCES "public"."cut_tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_validation_runs" ADD CONSTRAINT "production_validation_runs_cutter_user_id_users_id_fk" FOREIGN KEY ("cutter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_validation_runs" ADD CONSTRAINT "production_validation_runs_validator_user_id_users_id_fk" FOREIGN KEY ("validator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "production_batches_batch_no_idx" ON "production_batches" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_batches_status_idx" ON "production_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_batches_cut_ticket_idx" ON "production_batches" USING btree ("cut_ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_batches_variant_idx" ON "production_batches" USING btree ("product_variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_batches_pending_shopify_idx" ON "production_batches" USING btree ("completed_at") WHERE status = 'completed' AND shopify_pushed_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_events_batch_idx" ON "production_events" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_events_type_idx" ON "production_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "production_validation_runs_run_no_idx" ON "production_validation_runs" USING btree ("run_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_validation_runs_status_idx" ON "production_validation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_validation_runs_variant_marker_idx" ON "production_validation_runs" USING btree ("product_variant_id","marker_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_validation_runs_cut_ticket_idx" ON "production_validation_runs" USING btree ("cut_ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_dimensions_idx" ON "product_variants" USING btree ("line","model","color","size_dim","gender","season_dim","fabric_type");