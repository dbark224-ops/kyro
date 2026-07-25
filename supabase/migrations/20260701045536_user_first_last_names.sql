ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

UPDATE public.users
SET
  first_name = COALESCE(
    NULLIF(first_name, ''),
    NULLIF(split_part(trim(name), ' ', 1), '')
  ),
  last_name = COALESCE(
    NULLIF(last_name, ''),
    NULLIF(
      trim(
        substring(
          trim(name)
          from char_length(split_part(trim(name), ' ', 1)) + 1
        )
      ),
      ''
    )
  )
WHERE name IS NOT NULL
  AND trim(name) <> '';
