-- A second number on the contact, for the person who is actually there.
--
-- Customers routinely hand over someone else's number: "my partner Sam is home
-- today, they're on 505 555 0198", or a PA who fields the calls. Contacts held
-- exactly one phone, so that number was read once in the email and then lost.
--
-- Deliberately not a linked person or a second contact record. A PA does not
-- need a CRM profile -- it would show up in the contact list, the type counts
-- and the filters as if they were a customer, which is a worse lie than having
-- nowhere to put the number.
--
-- Who it belongs to is what stops this being dangerous. A bare second number
-- with nothing attached is the kind of thing that gets texted by mistake.
--
-- Two fields rather than one string: a name ("Sam") and a relationship
-- ("Partner"). Structured, so Kyro can address them by name and still know
-- what they are to the customer, instead of parsing "Sam (partner)" back apart
-- every time it wants one half of it.
--
-- normalized_secondary_phone exists for display and dialling consistency with
-- phone/normalized_phone. It is deliberately NOT indexed and deliberately not
-- used for identity matching: matching an inbound caller to a contact by the
-- partner's number would merge two different people's profiles, and would fire
-- the profile-conflict detector against a number that was never claimed to be
-- theirs.

alter table contacts
  add column if not exists secondary_phone text,
  add column if not exists normalized_secondary_phone text,
  add column if not exists secondary_phone_name text,
  add column if not exists secondary_phone_label text;

comment on column contacts.secondary_phone is
  'A second reachable number for this contact, such as a partner or assistant. Never used for identity matching.';

comment on column contacts.secondary_phone_name is
  'Whose number the secondary is, e.g. "Sam". Shown next to it so it is never texted blind.';

comment on column contacts.secondary_phone_label is
  'What that person is to the contact, e.g. "Partner", "Assistant", "On-site contact".';
