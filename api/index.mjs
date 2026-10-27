import { createSupabaseHandler } from "../supabase-handler.mjs";

// Vercel owns the HTTP lifecycle; this entry never starts a listener or SQLite.
export default createSupabaseHandler();
