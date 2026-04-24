// src/lib/apiFetch.ts
// Wrapper de fetch que pega o token do Supabase auth e injeta no header Authorization
// Uso: const res = await apiFetch('/api/dashboard/grupos');

import { createClient } from '@supabase/supabase-js';

let _supabase: any = null;
function supa() {
  if (_supabase) return _supabase;
  if (typeof window === 'undefined') return null;
  _supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _supabase;
}

async function getToken(): Promise<string | null> {
  const s = supa();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  return data?.session?.access_token || null;
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const token = await getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
}
