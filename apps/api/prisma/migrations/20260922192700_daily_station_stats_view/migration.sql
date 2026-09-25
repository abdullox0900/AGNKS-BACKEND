-- Materialized view for fast dashboard analytics (TZ-4 §5.2, §9 analytics.refresh job).
-- Live endpoints still query the base tables directly for correctness; this view exists
-- purely as a cheap pre-aggregation for high-volume historical charts once data grows large.
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_station_stats AS
SELECT
  s.id AS station_id,
  date_trunc('day', r.receipt_at AT TIME ZONE 'Asia/Tashkent') AS day,
  COUNT(r.id) FILTER (WHERE r.status != 'rejected') AS receipts_count,
  COALESCE(SUM(r.amount) FILTER (WHERE r.status != 'rejected'), 0) AS receipts_sum,
  COALESCE(SUM(r.bonus) FILTER (WHERE r.status = 'applied'), 0) AS bonus_applied,
  COUNT(DISTINCT r.card_id) AS distinct_clients
FROM stations s
LEFT JOIN receipts r ON r.station_id = s.id
GROUP BY s.id, date_trunc('day', r.receipt_at AT TIME ZONE 'Asia/Tashkent');

CREATE UNIQUE INDEX IF NOT EXISTS daily_station_stats_unique
  ON daily_station_stats (station_id, day);
