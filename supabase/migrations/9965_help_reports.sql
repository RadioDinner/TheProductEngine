-- 9965 — "I need help!" reports (feature 39).
--
-- The user's ask: a help button on nearly every page that files a report
-- carrying every diagnostic we can capture, "this way I can pro-actively get
-- fixes in place." The point is NOT a support inbox — item 27's Ask a
-- question already emails the operator. The point is that a stuck member
-- usually cannot describe what went wrong, so the report has to describe it
-- for them: which page, signed in as whom, on what browser, at what size,
-- at what moment.
--
-- Reports both email the operator immediately AND queue here (user decision),
-- because the email is how you find out and this table is how you work
-- through them and see patterns — three reports from the same page in an hour
-- is a bug report even when no single one of them is.
--
-- Re-runnable.

create table if not exists help_reports (
  id bigint generated always as identity primary key,

  -- Everything below is captured automatically. `note` is the only part the
  -- member types, and it is optional on purpose: someone who cannot work out
  -- what to say must still be able to raise a hand.
  note text,

  -- Who, as far as we can tell. Null phone = not signed in, which is itself
  -- worth knowing (a signed-out person hitting help may be stuck ON signing
  -- in). member_id is the six-digit id; has_email records whether we hold an
  -- address for them WITHOUT copying the address itself.
  phone text,
  member_id text,
  has_email boolean not null default false,

  -- Where. path is the page they were on; referrer is where they came from,
  -- which is often the more useful half — "help was pressed on /account/post,
  -- arriving from /login" tells a different story than the path alone.
  path text not null,
  referrer text,

  -- What they were using. Enough to reproduce: the browser string, the
  -- viewport (a layout bug is usually a width), and their clock offset, which
  -- catches "it says the wrong time" reports without asking.
  user_agent text,
  viewport text,
  timezone text,
  -- The most recent client-side error the page saw, if any. When this is
  -- populated the report usually explains itself.
  last_error text,

  -- Operator workflow. Deliberately just two states: a report is either
  -- waiting to be looked at or it has been dealt with.
  resolved_at timestamptz,
  resolved_note text,

  created_at timestamptz not null default now()
);

-- The working query is "what is still open, newest first".
create index if not exists help_reports_open_idx
  on help_reports (created_at desc)
  where resolved_at is null;

-- And the pattern query: everything from one page, or one member.
create index if not exists help_reports_path_idx on help_reports (path);
create index if not exists help_reports_phone_idx on help_reports (phone)
  where phone is not null;
