ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "normalized_email" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "normalized_phone" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "normalized_company" text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalize_contact_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(btrim(value)), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalize_contact_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH input AS (
    SELECT regexp_replace(btrim(coalesce(value, '')), '\s*(ext\.?|extension|x|#)\s*[0-9]+\s*$', '', 'i') AS raw
  ),
  parsed AS (
    SELECT raw, regexp_replace(raw, '\D', '', 'g') AS digits FROM input
  )
  SELECT CASE
    WHEN digits = '' THEN NULL
    WHEN left(regexp_replace(raw, '\s+', '', 'g'), 1) = '+' THEN '+' || digits
    WHEN left(digits, 4) = '0011' AND length(digits) > 5 THEN '+' || substr(digits, 5)
    WHEN left(digits, 3) = '011' AND length(digits) > 5 THEN '+' || substr(digits, 4)
    WHEN left(digits, 2) = '00' AND length(digits) > 4 THEN '+' || substr(digits, 3)
    WHEN (digits ~ '^0[2378][0-9]{8}$' OR digits ~ '^04[0-9]{8}$') THEN '+61' || substr(digits, 2)
    WHEN digits ~ '^4[0-9]{8}$' THEN '+61' || digits
    WHEN digits ~ '^0[1-9][0-9]{9}$' THEN '+44' || substr(digits, 2)
    WHEN digits ~ '^[2-9][0-9]{9}$' THEN '+1' || digits
    WHEN length(digits) BETWEEN 8 AND 15 AND left(digits, 1) <> '0' THEN '+' || digits
    ELSE digits
  END
  FROM parsed
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalize_company_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g')), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_contact_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_email := public.normalize_contact_email(NEW.email);
  NEW.normalized_phone := public.normalize_contact_phone(NEW.phone);
  NEW.normalized_company := public.normalize_company_name(NEW.company);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
UPDATE "contacts"
SET
  "normalized_email" = public.normalize_contact_email("email"),
  "normalized_phone" = public.normalize_contact_phone("phone"),
  "normalized_company" = public.normalize_company_name("company");
--> statement-breakpoint
DROP TRIGGER IF EXISTS "contacts_identity_fields_trigger" ON "contacts";
--> statement-breakpoint
CREATE TRIGGER "contacts_identity_fields_trigger"
BEFORE INSERT OR UPDATE OF "email", "phone", "company"
ON "contacts"
FOR EACH ROW
EXECUTE FUNCTION public.set_contact_identity_fields();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_workspace_normalized_email_idx"
ON "contacts" USING btree ("workspace_id", "normalized_email")
WHERE "normalized_email" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_workspace_normalized_phone_idx"
ON "contacts" USING btree ("workspace_id", "normalized_phone")
WHERE "normalized_phone" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_workspace_normalized_company_idx"
ON "contacts" USING btree ("workspace_id", "normalized_company")
WHERE "normalized_company" IS NOT NULL;
