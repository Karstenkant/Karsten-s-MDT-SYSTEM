-- 1. Opret Tabel for Brugere (Personalet)
CREATE TABLE IF NOT EXISTS betjente (
  id UUID PRIMARY KEY DEFAULT auth.uid(),
  email TEXT UNIQUE NOT NULL,
  navn TEXT NOT NULL,
  p_nummer TEXT UNIQUE, -- P-nummer til login-validering
  discord_id TEXT UNIQUE, -- Discord ID til admin-validering
  rolle TEXT DEFAULT 'betjent', -- 'admin' eller 'betjent'
  is_on_duty BOOLEAN DEFAULT false,
  current_unit TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Opret Tabel for Borgere (Dansk Folkeregister)
CREATE TABLE IF NOT EXISTS borgere (
  discord_id TEXT PRIMARY KEY,
  visningsnavn TEXT NOT NULL,
  cpr TEXT UNIQUE NOT NULL,
  foedselsdag DATE,
  billede_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Opret Tabel for Straffelov (Katalog)
CREATE TABLE IF NOT EXISTS straffelov (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paragraf TEXT UNIQUE NOT NULL,
  titel TEXT NOT NULL,
  fine_amount INTEGER DEFAULT 0,
  jail_days INTEGER DEFAULT 0
);

-- 4. Opret Tabel for Sager (MDT Rapporter)
CREATE TABLE IF NOT EXISTS sager (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  navn TEXT NOT NULL,
  foedselsdag DATE,
  cpr TEXT NOT NULL,
  beskrivelse TEXT,
  status TEXT DEFAULT 'aktiv', -- 'aktiv', 'lukket', 'henlagt'
  oprettet_af UUID REFERENCES auth.users(id),
  oprettet_af_navn TEXT,
  oprettet_dato TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  sidst_redigeret_af UUID REFERENCES auth.users(id),
  sidst_redigeret_dato TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  slettet_dato TIMESTAMP WITH TIME ZONE
);

-- 5. Opret Tabel for Bøder (Journal)
CREATE TABLE IF NOT EXISTS boeder (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT,
  user_discord_id TEXT, -- Relation til borgere.discord_id (valgfrit)
  amount INTEGER NOT NULL,
  jail_days INTEGER DEFAULT 0,
  paragraf TEXT,
  reason TEXT,
  officer_id UUID REFERENCES auth.users(id),
  officer_name TEXT,
  afsonet BOOLEAN DEFAULT false,
  kilde TEXT DEFAULT 'web',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  slettet_dato TIMESTAMP WITH TIME ZONE
);

-- 6. Opret Tabel for Logs (Audit Trail)
CREATE TABLE IF NOT EXISTS sags_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sags_id UUID REFERENCES sager(id) ON DELETE CASCADE,
  bruger_id UUID REFERENCES auth.users(id),
  bruger_navn TEXT,
  handling TEXT NOT NULL, -- 'opret', 'rediger', 'slet'
  beskrivelse TEXT,
  dato TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Tabel for afventende brugere (Admin Panel)
CREATE TABLE IF NOT EXISTS pending_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  discord_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 8. Økonomi System (Discord Bot)
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  balance BIGINT DEFAULT 0,
  black_money BIGINT DEFAULT 0,
  tax_paid BIGINT DEFAULT 0,
  deductions_extra INTEGER DEFAULT 0,
  last_collected BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 9. Jobs System
CREATE TABLE IF NOT EXISTS jobs (
  name TEXT PRIMARY KEY,
  salary INTEGER DEFAULT 0
);

-- 10. Statskasse
CREATE TABLE IF NOT EXISTS treasury (
  id INTEGER PRIMARY KEY DEFAULT 1,
  balance BIGINT DEFAULT 0
);

-- Seed statskasse
INSERT INTO treasury (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE sager ENABLE ROW LEVEL SECURITY;
ALTER TABLE betjente ENABLE ROW LEVEL SECURITY;
ALTER TABLE boeder ENABLE ROW LEVEL SECURITY;
ALTER TABLE borgere ENABLE ROW LEVEL SECURITY;
ALTER TABLE sags_logs ENABLE ROW LEVEL SECURITY;

-- Politikker for betjente
CREATE POLICY "Alle betjente kan se profiler" ON betjente FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Betjente kan opdatere egen profil" ON betjente FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins kan administrere betjente" ON betjente FOR ALL USING (
  EXISTS (SELECT 1 FROM betjente WHERE id = auth.uid() AND rolle = 'admin')
);

-- Politikker for sager
CREATE POLICY "Alle betjente kan se sager" ON sager FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Betjente kan indsætte sager" ON sager FOR INSERT WITH CHECK (auth.uid() = oprettet_af);
CREATE POLICY "Ejer eller admin kan redigere" ON sager FOR UPDATE USING (
  auth.uid() = oprettet_af OR 
  EXISTS (SELECT 1 FROM betjente WHERE id = auth.uid() AND rolle = 'admin')
);

-- Politikker for bøder
CREATE POLICY "Alle betjente kan se bøder" ON boeder FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Betjente kan indsætte bøder" ON boeder FOR INSERT WITH CHECK (auth.uid() = officer_id);

-- Politikker for logs
CREATE POLICY "Alle betjente kan se logs" ON sags_logs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Systemet indsætter logs" ON sags_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
