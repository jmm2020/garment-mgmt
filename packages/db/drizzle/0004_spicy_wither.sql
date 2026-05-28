CREATE TYPE "public"."production_unit_status" AS ENUM('created', 'qc_passed', 'qc_rejected', 'shipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_units" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "production_units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"unit_serial" text NOT NULL,
	"batch_id" bigint NOT NULL,
	"status" "production_unit_status" DEFAULT 'created' NOT NULL,
	"qc_verdict" "qc_verdict",
	"qc_rejected_reason" text,
	"qc_actor_user_id" bigint,
	"qc_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_units_unit_serial_unique" UNIQUE("unit_serial")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_units" ADD CONSTRAINT "production_units_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_units" ADD CONSTRAINT "production_units_qc_actor_user_id_users_id_fk" FOREIGN KEY ("qc_actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "production_units_unit_serial_idx" ON "production_units" USING btree ("unit_serial");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_units_batch_idx" ON "production_units" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_units_batch_verdict_idx" ON "production_units" USING btree ("batch_id","qc_verdict");