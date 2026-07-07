import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** When false, the app runs on local fixtures / the file store. */
export const supabaseConfigured = Boolean(url && serviceKey);

let client: SupabaseClient | null = null;

/** Server-only service-role client — call only when `supabaseConfigured`. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
