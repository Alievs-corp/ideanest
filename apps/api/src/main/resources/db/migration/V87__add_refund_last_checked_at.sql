-- #183: the reconciliation asks about the refunds it has asked about least recently, not the oldest.
--
-- `campaign-refunds` settles refunds whose outcome was lost by asking the provider what the payment is.
-- It took the oldest REQUESTED rows, a bounded batch per pass. A row the provider keeps answering
-- "pending" about, or whose status cannot be read, stays REQUESTED and stays oldest: a batch of them
-- is the whole of every pass, and newer refunds are never asked about. V85 put more old rows at the
-- front of that queue.
--
-- `last_checked_at` is stamped each time a pass asks about a row, whatever the answer, and the queue is
-- ordered by it -- never asked first, then the least recently asked -- so every row gets its turn.
-- Nullable, and null on every existing row: none of them has been asked in this order yet.
--
-- Reverse: DROP INDEX refunds_unresolved_queue; ALTER TABLE refunds DROP COLUMN last_checked_at;
--
-- Contract: none. A nullable column the previous release does not map, and an index.

ALTER TABLE refunds ADD COLUMN last_checked_at timestamptz;

CREATE INDEX refunds_unresolved_queue
    ON refunds (last_checked_at ASC NULLS FIRST, requested_at ASC)
    WHERE state = 'REQUESTED' AND review_reason IS NULL;
