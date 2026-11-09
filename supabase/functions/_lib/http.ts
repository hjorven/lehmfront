// Gemeinsames fuer die Edge Functions von Lehmfront (P20): CORS, Antworten, Anmeldung pruefen.
// Die Spiellogik kommt aus ./logic.ts (reine Module des Spiels, auf einen Commit gepinnt).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Fehler mit deutscher Begruendung, die der Client so anzeigen darf */
export function fail(status: number, why: string): Response {
  return json({ ok: false, why }, status);
}

/** Admin-Client (Service-Role): nur hier drin, nie im Browser */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Wer ruft? Liefert die Nutzer-ID aus dem JWT oder null */
export async function caller(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

/** Rahmen fuer jede Function: OPTIONS, nur POST, JSON lesen, Fehler abfangen */
export function serve(handler: (body: Record<string, unknown>, uid: string) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return fail(405, 'Nur POST');
    const uid = await caller(req);
    if (!uid) return fail(401, 'Nicht angemeldet');
    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      if (text.length > 600000) return fail(413, 'Zu viel auf einmal');
      body = JSON.parse(text || '{}');
    } catch {
      return fail(400, 'Kein gültiges JSON');
    }
    try {
      return await handler(body, uid);
    } catch (e) {
      console.error(e);
      return fail(500, 'Die Leitung ist gestört. Später noch einmal.');
    }
  });
}

/** Zufaelliger Seed (Server, nie im Browser bekannt) */
export function secretSeed(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return (b[0] >>> 1) || 1;
}
