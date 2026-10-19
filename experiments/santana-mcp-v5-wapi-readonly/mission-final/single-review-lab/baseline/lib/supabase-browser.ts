import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SantanaSupabaseGlobal = typeof globalThis & {
  __santanaSupabaseBrowserClient?: SupabaseClient;
  __santanaSupabaseBrowserCredentials?: string;
};

export function createSupabaseBrowserClient(
  supabaseUrl: string,
  supabasePublishableKey: string,
) {
  if (!supabaseUrl || !supabasePublishableKey) return null;

  const globalScope = globalThis as SantanaSupabaseGlobal;
  const credentials = `${supabaseUrl}:${supabasePublishableKey}`;

  if (
    globalScope.__santanaSupabaseBrowserClient &&
    globalScope.__santanaSupabaseBrowserCredentials === credentials
  ) {
    return globalScope.__santanaSupabaseBrowserClient;
  }

  const client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  globalScope.__santanaSupabaseBrowserClient = client;
  globalScope.__santanaSupabaseBrowserCredentials = credentials;

  return client;
}
