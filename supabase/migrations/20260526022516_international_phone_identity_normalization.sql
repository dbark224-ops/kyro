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
UPDATE "contacts"
SET "normalized_phone" = public.normalize_contact_phone("phone");
