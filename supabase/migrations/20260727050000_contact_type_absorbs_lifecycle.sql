-- Contact type absorbs the lifecycle stage.
--
-- `contacts` carried two answers to the same question: `contact_type`
-- (client/supplier/contractor/...) and `lifecycle_stage` (lead/client). In this
-- workspace they disagreed on every single row -- all 35 non-merged contacts
-- were typed "client" while staged "lead" -- so the CRM counted the same person
-- under both filters and neither number meant anything.
--
-- Contact type is now the only field. It gains "lead" and "staff", and loses
-- "builder" (which no row used). The owner chose to trust the lifecycle value,
-- since that is the one the review engine had been maintaining and none of
-- these contacts has a paid or completed job yet.
--
-- The lifecycle_* columns are deliberately left in place and simply stop being
-- read or written. Dropping them is irreversible and buys nothing today; what
-- matters is that nothing depends on them any more.

update contacts
set contact_type = 'lead'
where lifecycle_stage = 'lead'
  and contact_type is distinct from 'lead';

-- No rows use this today, but the value would otherwise survive the type list
-- it came from and render as a lead under the new normalizer's fallback.
update contacts
set contact_type = 'other'
where contact_type = 'builder';
