CREATE TYPE "public"."machine_status" AS ENUM('available', 'in_use', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."machine_type" AS ENUM('flatlock', 'coverstitch', 'single_needle', 'overlock', 'bartack', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "machines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "machines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"type" "machine_type" NOT NULL,
	"sew_line_id" bigint NOT NULL,
	"status" "machine_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sew_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sew_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"capacity_units_per_day" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sew_lines_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "sew_line_id" bigint;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "machines" ADD CONSTRAINT "machines_sew_line_id_sew_lines_id_fk" FOREIGN KEY ("sew_line_id") REFERENCES "public"."sew_lines"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "machines_code_idx" ON "machines" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_line_idx" ON "machines" USING btree ("sew_line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_line_status_idx" ON "machines" USING btree ("sew_line_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sew_lines_code_idx" ON "sew_lines" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sew_lines_active_idx" ON "sew_lines" USING btree ("active");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_sew_line_id_sew_lines_id_fk" FOREIGN KEY ("sew_line_id") REFERENCES "public"."sew_lines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
