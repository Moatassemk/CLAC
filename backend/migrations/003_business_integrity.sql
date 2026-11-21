-- =====================================================================
-- Business integrity — database-level backstops for rules also enforced
-- in the services. Idempotent.
-- =====================================================================

-- At most one accepted proposal per buyer request. Two concurrent
-- acceptances now fail with 23505 even if the service lock is bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_responses_one_accepted
  ON request_responses (request_id) WHERE status = 'accepted';

-- An announced price is a real price: 0 TND listings are not sold goods.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_per_unit_check;
ALTER TABLE products ADD CONSTRAINT products_price_per_unit_check
  CHECK (price_per_unit IS NULL OR price_per_unit > 0);

-- Accepting an exchange response may never push the accepted total above
-- the author's max_total_wanted. The trigger locks the exchange row first,
-- so concurrent acceptances serialise instead of both reading the old total.
CREATE OR REPLACE FUNCTION check_exchange_accepted_cap()
RETURNS TRIGGER AS $$
DECLARE
  cap NUMERIC;
  accepted NUMERIC;
BEGIN
  IF NEW.status <> 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT e.max_total_wanted INTO cap FROM exchange_offers e WHERE e.id = NEW.exchange_id FOR UPDATE;
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Other accepted rows (NEW is not visible in the table yet) + the row being accepted.
  SELECT COALESCE(SUM(r.quantity_offered), 0) INTO accepted
  FROM exchange_responses r
  WHERE r.exchange_id = NEW.exchange_id AND r.status = 'accepted' AND r.id <> NEW.id;
  accepted := accepted + NEW.quantity_offered;

  IF accepted > cap THEN
    RAISE EXCEPTION 'Quantité acceptée (%) supérieure à l objectif de l échange (%)', accepted, cap
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exchange_responses_cap ON exchange_responses;
CREATE TRIGGER trg_exchange_responses_cap
  BEFORE INSERT OR UPDATE OF status, quantity_offered ON exchange_responses
  FOR EACH ROW EXECUTE FUNCTION check_exchange_accepted_cap();
