ALTER TABLE "product_variants" ADD COLUMN "shopify_variant_gid" text;--> statement-breakpoint
ALTER TABLE "production_batches" ADD COLUMN "shopify_batch_metafield_at" timestamp with time zone;