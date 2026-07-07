# Supabase setup

The app runs in **fixtures mode** (local JSON + hardcoded ads) until these env
vars exist, then switches to Supabase automatically — no code changes:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key — Settings → API. Server-only secret; never expose>
```

## Applying the schema

1. Create a project at https://database.new
2. Open the project's **SQL Editor**, paste and run `migrations/0001_init.sql`
3. Then paste and run `seed.sql` (optional — the demo sellers, ads, config, and packs)

Or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`,
and run `seed.sql` in the SQL editor.

## Notes

- **RLS is enabled on every table with no policies.** Only the service-role key
  (used by the Next.js server) can touch data. Don't add policies without first
  deciding what, if anything, browsers may query directly.
- **Auth is custom** (phone + SMS code + password, in `lib/`): Supabase provides
  Postgres and Storage only. `users.password_hash` is scrypt, managed by the app.
- The `ad-photos` storage bucket is created public — ad pictures are public on
  the website by design; the member gate covers contact info, not photos.
- `credit_ledger` is append-only. Never update or delete rows; corrections are
  new `adjustment` entries.
