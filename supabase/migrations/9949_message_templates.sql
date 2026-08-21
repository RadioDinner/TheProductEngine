-- =====================================================================
-- 9949 — editable auto-reply copy.
--
-- "I want an admin tab where I can go in and edit the messages and add or
--  remove variables from auto replies, rather than having a code/prompt
--  session. Plus, I can see the messages"        (user, session 023)
--
-- One row per message the operator has actually REWRITTEN. Everything else
-- falls through to the wording shipped in lib/message-templates.ts, and
-- "reset to the original" is a delete.
--
-- That is deliberate and it is the whole design. A table seeded with every
-- message would freeze today's wording into the database on the day it was
-- created: a later improvement to a default would never reach production,
-- because a copy of the old text would be sitting on top of it. Storing only
-- the differences means the operator owns exactly what they have edited and
-- nothing else.
--
-- `key` is the message's stable name (e.g. 'ad.approved.awaiting-payment') and
-- it is the primary key — there is no id, because the catalogue in the code is
-- the list of what may exist. A row whose key is not in that catalogue is
-- simply never read.
--
-- Re-runnable: every statement is guarded.
-- =====================================================================

create table if not exists message_templates (
  -- The catalogue key from lib/message-templates.ts.
  key text primary key,
  -- The operator's wording, with {variables} in it. Validated before it is
  -- written: unknown variables and missing required phrases are refused at
  -- /admin/replies, never here.
  body text not null,
  updated_at timestamptz not null default now()
);

comment on table message_templates is
  'Session 023: operator overrides for automatic message copy. Only edited messages have a row; everything else uses the default in lib/message-templates.ts. Deleting a row restores the shipped wording.';

comment on column message_templates.body is
  'The wording, with {variable} tokens. Some messages MUST keep certain phrases — carrier words like STOP, and the substrings the outbound log is scanned for to suppress a repeat. /admin/replies enforces that.';

-- Deny-by-default, like every other table: the service role bypasses RLS and
-- is the only thing that touches this. No policy is the point.
alter table message_templates enable row level security;
