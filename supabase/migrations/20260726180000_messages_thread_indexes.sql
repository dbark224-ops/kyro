-- Index the two ways messages are actually read.
--
-- Every message query in lib/crm/queries.ts filters on workspace_id plus
-- either conversation_id or contact_id, then orders by created_at descending
-- to take the most recent. The table had only its primary key and a
-- (workspace_id, contact_id) index added for the contact-activity aggregate,
-- so the ordered reads -- the inbox thread, the contact history -- sorted every
-- matching row on each request.
--
-- Harmless at seventy rows, where Postgres reads the whole table regardless.
-- It stops being harmless somewhere in the low tens of thousands, and by then
-- it is the inbox that feels slow. Cheap to add now, awkward to notice later.
--
-- created_at DESC matches the query's order, so the index can be walked
-- straight down rather than sorted after the fact.

CREATE INDEX IF NOT EXISTS messages_workspace_conversation_created_idx
  ON public.messages (workspace_id, conversation_id, created_at DESC);

-- Supersedes messages_workspace_contact_activity_idx: same leading columns, so
-- it still serves the contact-activity aggregate, and it additionally covers
-- the ordered contact history read that aggregate's index could not.
CREATE INDEX IF NOT EXISTS messages_workspace_contact_created_idx
  ON public.messages (workspace_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

DROP INDEX IF EXISTS public.messages_workspace_contact_activity_idx;
