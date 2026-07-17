-- ============================================================
-- 9985 — emailed-in extra ad pictures (FEATURES.md item 1, session 008)
--
-- Sellers email additional pictures for an ad (photos@ inbound address, ad
-- number in the subject). Submissions land HERE — pending admin review —
-- never directly in ad_photos, so ad_photos keeps meaning "live photos" and
-- no existing reader changes. Approving a submission moves it into
-- ad_photos at the next position; the website listing then shows the whole
-- gallery while SMS/PIC/email digests keep using position 0 only.
--
-- Re-runnable, per repo convention (pasted into the Supabase SQL editor).
-- ============================================================

create table if not exists ad_photo_submissions (
  id bigint generated always as identity primary key,
  ad_id bigint not null references ads (id) on delete cascade,
  src text not null,          -- already re-hosted into the ad-photos bucket
  from_email text not null,   -- who mailed it in (spoofable; review is the gate)
  created_at timestamptz not null default now()
);

create index if not exists ad_photo_submissions_ad_idx on ad_photo_submissions (ad_id);

alter table ad_photo_submissions enable row level security;
