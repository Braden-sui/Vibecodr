-- SAFETY: ensure columns exist (raise divide-by-zero if missing)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name = 'storage_usage_bytes')
    THEN 1/0
END;

SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name = 'storage_version')
    THEN 1/0
END;

-- Backfill usage from existing capsule assets
UPDATE users
SET storage_usage_bytes = COALESCE((
  SELECT SUM(a.size)
  FROM capsules c
  JOIN assets a ON a.capsule_id = c.id
  WHERE c.owner_id = users.id
), 0);
