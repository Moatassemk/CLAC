/**
 * The seller's optional volume discount on a listing. When enabled:
 *  - more than half of its stock → -10 %
 *  - the whole stock            → -15 %
 * Buyers cannot opt out: every request that qualifies gets the discount.
 */
export const QUANTITY_DISCOUNT_PERCENTAGE = 10;
export const FULL_QUANTITY_DISCOUNT_PERCENTAGE = 15;
export const QUANTITY_DISCOUNT_SHARE = 0.5;

const KILOS_PER_UNIT = { kg: 1, t: 1000 };
const factor = (unit) => KILOS_PER_UNIT[unit] ?? 1;

/** Quantities are comparable across kg/t, or when both use the same unit. */
const comparable = (unit, other) => unit === other || (KILOS_PER_UNIT[unit] != null && KILOS_PER_UNIT[other] != null);

/** Half of the listing's displayed stock, in the listing's own unit. */
export function quantityDiscountThreshold(product) {
  const available = Number(product?.quantity_available);
  if (!(available > 0)) return null;
  return Number((available * QUANTITY_DISCOUNT_SHARE).toFixed(2));
}

/** A quantity converted to the listing's unit, or null when units cannot be compared. */
function inListingUnit(product, quantity, unit) {
  if (quantity == null || !comparable(unit, product?.unit)) return null;
  return (Number(quantity) * factor(unit)) / factor(product.unit);
}

/** True when an ordered quantity is strictly above the threshold (more than half). */
export function reachesQuantityDiscount(product, quantity, unit = product?.unit) {
  const threshold = quantityDiscountThreshold(product);
  const qty = inListingUnit(product, quantity, unit);
  return threshold != null && qty != null && qty > threshold;
}

/** True when the order takes the whole displayed stock. */
export function isFullQuantity(product, quantity, unit = product?.unit) {
  const qty = inListingUnit(product, quantity, unit);
  const available = Number(product?.quantity_available);
  return qty != null && available > 0 && qty >= available;
}

/**
 * The discount a quantity earns: 0, 10 or 15 %. A listing whose seller did not
 * enable the option never earns any.
 */
export function quantityDiscountPercentage(product, quantity, unit = product?.unit) {
  if (!product?.quantity_discount_enabled) return 0;
  if (isFullQuantity(product, quantity, unit)) return FULL_QUANTITY_DISCOUNT_PERCENTAGE;
  return reachesQuantityDiscount(product, quantity, unit) ? QUANTITY_DISCOUNT_PERCENTAGE : 0;
}

/** The unit price once a discount percentage is applied. */
export function quantityDiscountedPrice(product, percentage = QUANTITY_DISCOUNT_PERCENTAGE) {
  const price = product?.price_per_unit;
  if (price == null) return null;
  return Number((Number(price) * (1 - percentage / 100)).toFixed(3));
}
