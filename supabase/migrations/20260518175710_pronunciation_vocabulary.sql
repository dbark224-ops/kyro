-- Voice pronunciation vocabulary for Kyro workspaces.
-- Stores confirmed and suggested terms that help speech-to-text and realtime voice pronounce names, places, acronyms, and business-specific words.

CREATE TABLE public.assistant_pronunciations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phrase text NOT NULL,
  normalized_phrase text NOT NULL,
  pronunciation_hint text,
  category text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'suggested',
  source text NOT NULL DEFAULT 'manual',
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  importance text NOT NULL DEFAULT 'medium',
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  last_seen_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT assistant_pronunciations_phrase_not_blank CHECK (length(btrim(phrase)) > 0),
  CONSTRAINT assistant_pronunciations_normalized_phrase_not_blank CHECK (length(btrim(normalized_phrase)) > 0),
  CONSTRAINT assistant_pronunciations_category_check CHECK (category IN ('person', 'place', 'business', 'product', 'acronym', 'other')),
  CONSTRAINT assistant_pronunciations_status_check CHECK (status IN ('suggested', 'inferred', 'approved', 'ignored')),
  CONSTRAINT assistant_pronunciations_importance_check CHECK (importance IN ('low', 'medium', 'high')),
  CONSTRAINT assistant_pronunciations_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT assistant_pronunciations_aliases_array_check CHECK (jsonb_typeof(aliases) = 'array'),
  CONSTRAINT assistant_pronunciations_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX assistant_pronunciations_workspace_phrase_idx
  ON public.assistant_pronunciations USING btree (workspace_id, normalized_phrase);

CREATE INDEX assistant_pronunciations_workspace_status_idx
  ON public.assistant_pronunciations USING btree (workspace_id, status, updated_at);

CREATE INDEX assistant_pronunciations_workspace_category_idx
  ON public.assistant_pronunciations USING btree (workspace_id, category, status);

CREATE TRIGGER set_assistant_pronunciations_updated_at
  BEFORE UPDATE ON public.assistant_pronunciations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.assistant_pronunciations ENABLE ROW LEVEL SECURITY;

CREATE POLICY assistant_pronunciations_select_member
  ON public.assistant_pronunciations
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY assistant_pronunciations_insert_member
  ON public.assistant_pronunciations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY assistant_pronunciations_update_member
  ON public.assistant_pronunciations
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY assistant_pronunciations_delete_member
  ON public.assistant_pronunciations
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_pronunciations TO authenticated;
GRANT ALL ON public.assistant_pronunciations TO service_role;
