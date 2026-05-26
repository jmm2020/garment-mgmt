// Allowlists for the structured FG SKU dimensions on product_variants.
// Adding a new value here requires:
//   1. A migration (alter column comment) if you want it enforced at the DB level via CHECK
//   2. Verifying no clash with existing SKUs after generation
// See ADR-0005 §3 and docs/prd/production-tracking.md "SKU schema (concrete)".

export const LINES = ["PERF", "HERIT", "BASIC"] as const;
export const MODELS = ["HOOD", "TEE", "JACKET", "PANT", "SHORT"] as const;
export const COLORS = ["BLK", "WHT", "OLV", "RUST", "NAVY", "CHAR", "SAND"] as const;
export const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;
export const GENDERS = ["MENS", "WOMENS", "UNISEX", "YOUTH"] as const;
export const FABRIC_TYPES = [
  "12OZ-COTTON",
  "14OZ-COTTON",
  "RIPSTOP",
  "MERINO-200",
  "MERINO-260",
] as const;

// Season is regex-validated rather than enumerated:
//   SS<YY> | FW<YY> | EVRG
export const SEASON_REGEX = /^(?:(?:SS|FW)\d{2}|EVRG)$/;

export type Line = (typeof LINES)[number];
export type Model = (typeof MODELS)[number];
export type Color = (typeof COLORS)[number];
export type SizeDim = (typeof SIZES)[number];
export type Gender = (typeof GENDERS)[number];
export type FabricType = (typeof FABRIC_TYPES)[number];

/**
 * Compose the canonical FG SKU from its dimensions.
 *
 * This is the same expression the database materializes for the generated `sku` column
 * (added in a follow-up migration once existing variants are backfilled). Keep this in
 * sync with that migration — diverging here means the SKU we display in the CLI/UI
 * disagrees with what's in the row, which silently breaks Shopify reconciliation.
 */
export function composeSku(parts: {
  line: Line;
  model: Model;
  color: Color;
  size: SizeDim;
  gender: Gender;
  season: string;
  fabricType: FabricType;
}): string {
  return [
    parts.line,
    parts.model,
    parts.color,
    parts.size,
    parts.gender,
    parts.season,
    parts.fabricType,
  ].join("-");
}
