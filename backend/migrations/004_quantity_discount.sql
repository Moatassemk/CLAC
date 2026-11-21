-- Records that a request earned the seller's volume discount (applied by the
-- backend from products.quantity_discount_enabled, never chosen by the buyer).
ALTER TABLE buy_requests ADD COLUMN IF NOT EXISTS quantity_discount BOOLEAN NOT NULL DEFAULT false;
