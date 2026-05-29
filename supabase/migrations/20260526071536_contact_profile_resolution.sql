ALTER TABLE "contacts" ADD COLUMN "profile_resolution_status" text DEFAULT 'clear' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "profile_resolution_reason" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "profile_conflict_contact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "merged_into_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "profile_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "profile_resolved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_profile_resolved_by_user_id_users_id_fk" FOREIGN KEY ("profile_resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_workspace_profile_resolution_idx" ON "contacts" USING btree ("workspace_id","profile_resolution_status");--> statement-breakpoint
CREATE INDEX "contacts_workspace_merged_into_idx" ON "contacts" USING btree ("workspace_id","merged_into_contact_id") WHERE "contacts"."merged_into_contact_id" is not null;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_contact_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_email := public.normalize_contact_email(NEW.email);

  IF TG_OP = 'INSERT' THEN
    NEW.normalized_phone := COALESCE(NULLIF(NEW.normalized_phone, ''), public.normalize_contact_phone(NEW.phone));
  ELSIF NEW.phone IS DISTINCT FROM OLD.phone THEN
    IF NEW.normalized_phone IS DISTINCT FROM OLD.normalized_phone THEN
      NEW.normalized_phone := NULLIF(NEW.normalized_phone, '');
    ELSE
      NEW.normalized_phone := public.normalize_contact_phone(NEW.phone);
    END IF;
  END IF;

  NEW.normalized_company := public.normalize_company_name(NEW.company);
  RETURN NEW;
END;
$$;
