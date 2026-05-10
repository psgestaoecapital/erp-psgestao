// GET /api/cron/screen-watcher
// Vercel Cron a cada 6h dispara captura em massa das rotas criticas + altas.
//
// 1. Busca rotas com prioridade_monitoramento IN ('critica', 'alta')
// 2. Para cada rota chama /api/screen-watcher/playwright em paralelo (max 10 concorrentes)
// 3. Promise.allSettled — se 1 falhar, outras continuam
// 4. Agrega resultados e retorna resumo
//
// Auth: Vercel Cron usa header `Authorization: Bearer <CRON_SECRET>` automatico
// Runtime: nodejs (chamada externa via fetch — leve)
// PR M.A.7.5.2

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min total para orquestrador

const MAX_CONCURRENT = 10;

type Result = {
  rota: string;
  success: boolean;
  status?: number;
  error?: string;
  page_load_ms?: number;
  screenshot_url?: string;
};

async function captureOne(rota: string, baseUrl: string, secret: string): Promise<Result> {
  try {
    const res = await fetch(`${baseUrl}/api/screen-watcher/playwright`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-watcher-secret': secret,
      },
      body: JSON.stringify({ rota }),
    });
    const json = await res.json().catch(() => ({}));
    return {
      rota,
      success: res.ok && json.success === true,
      status: res.status,
      error: json.error,
      page_load_ms: json.page_load_ms,
      screenshot_url: json.screenshot_url,
    };
  } catch (e: unknown) {
    return { rota, success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function GET(req: Request) {
  // Vercel Cron envia Authorization: Bearer <CRON_SECRET>
  // Em chamada manual aceita x-watcher-secret tambem
  const cronSecret = process.env.CRON_SECRET;
  const watcherSecret = process.env.WATCHER_SECRET;

  const auth = req.headers.get('authorization');
  const xWatcher = req.headers.get('x-watcher-secret');

  const cronOk = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const watcherOk = !!watcherSecret && xWatcher === watcherSecret;

  if (!cronOk && !watcherOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!watcherSecret) {
    return NextResponse.json(
      { error: 'WATCHER_SECRET nao configurado' },
      { status: 500 },
    );
  }

  // Base URL: Vercel injeta VERCEL_URL nas crons
  const baseUrl =
    process.env.SAAS_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_URL ou SERVICE_ROLE_KEY nao configuradas' },
      { status: 500 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Listar rotas criticas + altas
  const { data: screens, error } = await supabase
    .from('system_screens')
    .select('rota, prioridade_monitoramento')
    .in('prioridade_monitoramento', ['critica', 'alta'])
    .order('prioridade_monitoramento', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Falha ao listar rotas: ' + error.message }, { status: 500 });
  }

  const rotas = (screens || []).map((s) => s.rota);
  if (rotas.length === 0) {
    return NextResponse.json({
      success: true,
      total: 0,
      success_count: 0,
      error_count: 0,
      results: [],
    });
  }

  const startedAt = Date.now();
  const results = await runWithConcurrency(
    rotas,
    (rota) => captureOne(rota, baseUrl, watcherSecret),
    MAX_CONCURRENT,
  );
  const totalMs = Date.now() - startedAt;

  const success_count = results.filter((r) => r.success).length;
  const error_count = results.length - success_count;

  return NextResponse.json({
    success: true,
    total: results.length,
    success_count,
    error_count,
    duration_ms: totalMs,
    results,
  });
}
