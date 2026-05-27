CREATE TABLE IF NOT EXISTS "shopify_order_line_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shopify_order_line_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"shopify_order_id" text NOT NULL,
	"line_item_id" text NOT NULL,
	"batch_id" bigint NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_order_line_batches" ADD CONSTRAINT "shopify_order_line_batches_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_order_line_batches_order_line_batch_idx" ON "shopify_order_line_batches" USING btree ("shopify_order_id","line_item_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_order_line_batches_order_idx" ON "shopify_order_line_batches" USING btree ("shopify_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_order_line_batches_batch_idx" ON "shopify_order_line_batches" USING btree ("batch_id");
