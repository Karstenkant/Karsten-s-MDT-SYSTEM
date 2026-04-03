// Supabase Konfiguration
// SDK'en loades via CDN i HTML og eksponerer window.supabase
const SUPABASE_URL = 'https://yesrdgygcsnvxkmhszck.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_avQ8-7D5azOyW5J6-88pzQ_THGHvYkz';

// Opret klienten korrekt fra det globale supabase modul
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
