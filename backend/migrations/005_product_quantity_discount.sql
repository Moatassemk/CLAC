-- The seller decides, when publishing a listing, whether it offers the volume
-- discount: -10 % above half of its stock, -15 % for the whole quantity.
ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_discount_enabled BOOLEAN NOT NULL DEFAULT false;
