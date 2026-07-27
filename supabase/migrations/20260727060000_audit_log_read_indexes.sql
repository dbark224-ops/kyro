-- audit_logs had only its primary key.
--
-- It is written on essentially every action and is already the third-largest
-- table in the database at 7,761 rows, with pg_stat_user_tables reporting
-- idx_scan = 0 -- every read was a sequential scan plus a sort.
--
-- Two read shapes, both on screens people use:
--
--   1. The contact profile and its siblings, three call sites in crm/queries.ts:
--      workspace_id = ? and entity_id in (...) order by created_at desc limit 20-30.
--   2. The activity feed in engine/event-action-audit.ts:
--      workspace_id = ? order by created_at desc limit ?.
--
-- The first index cannot serve the second: with entity_id as its second column
-- it gives no useful ordering once entity_id is unconstrained. Hence both.
-- created_at descending matches the sort so the limit can stop early instead of
-- sorting the whole workspace's history.
--
-- Harmless today at eight thousand rows -- this is a table that only grows, and
-- the cost of adding the index later is paid while the screen is already slow.

create index if not exists audit_logs_workspace_entity_created_idx
  on audit_logs (workspace_id, entity_id, created_at desc);

create index if not exists audit_logs_workspace_created_idx
  on audit_logs (workspace_id, created_at desc);
