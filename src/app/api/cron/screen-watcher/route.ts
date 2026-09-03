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

// Concorrência das capturas Chromium. A 10 em paralelo no serverless a foto estourava recurso
// ('Unable to capture screenshot') e rotas alcançadas+carregadas falhavam só na captura física.
// CONFIGURÁVEL sem deploy (mesmo princípio do modelo de IA): se o limite do serverless mudar,
// ajusta-se SCREEN_WATCHER_CONCURRENCY na env; default vivo = 3.
// Quantos LOTES em paralelo. Cada lote reusa 1 browser (o playwright route agora aceita rotas[]),
// então o número de Chromium simultâneos = MAX_CONCURRENT (não mais 1 por rota). Configurável.
const MAX_CONCURRENT = Math.max(1, Number(process.env.SCREEN_WATCHER_CONCURRENCY || '3'));
// Rotas por lote: o playwright route sobe 1 browser e roda o lote nele (context novo por rota).
// Lote grande = menos launches, mas cada chamada precisa caber no maxDuration. Configurável.
const BATCH_SIZE = Math.max(1, Number(process.env.SCREEN_WATCHER_BATCH_SIZE || '8'));

type Result = {
  rota: string;
  success: boolean;
  status?: number;
  error?: string;
  page_load_ms?: number;
  screenshot_url?: string;
  // cobertura real da auditoria: a rota foi de fato alcançada e fotografada?
  capture_status?: string; // 'sucesso' | 'rota_nao_alcancada' | 'nao_carregou' | 'erro'
  rota_alcancada?: boolean;
  url_final_visitada?: string | null;
};

type BatchOut = { results: Result[]; relaunches: number };

// Captura um LOTE de rotas numa única chamada — o playwright route reusa 1 browser para todas.
// relaunches = quantas vezes o browser morreu no meio do lote e foi relançado (telemetria de fragilidade).
async function captureBatch(rotas: string[], baseUrl: string, secret: string): Promise<BatchOut> {
  try {
    const res = await fetch(`${baseUrl}/api/screen-watcher/playwright`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-watcher-secret': secret },
      body: JSON.stringify({ rotas }),
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    const relaunches = Number(json.relaunches) || 0;
    const arr = Array.isArray(json.resultados) ? (json.resultados as Record<string, unknown>[]) : [];
    if (arr.length === 0) {
      // lote inteiro falhou (browser não subiu etc.): marca todas como erro de infra
      const erro = (json.error as string) || `HTTP ${res.status}`;
      return { relaunches, results: rotas.map((rota) => ({ rota, success: false, capture_status: 'erro', rota_alcancada: false, error: erro })) };
    }
    return {
      relaunches,
      results: arr.map((r) => ({
        rota: String(r.rota ?? ''),
        success: r.success === true,
        capture_status: r.capture_status as string | undefined,
        rota_alcancada: r.rota_alcancada === true,
        error: (r.error as string) || (r.motivo as string) || undefined,
        page_load_ms: r.page_load_ms as number | undefined,
        screenshot_url: r.screenshot_url as string | undefined,
        url_final_visitada: (r.url_final_visitada as string) ?? null,
      })),
    };
  } catch (e: unknown) {
    const erro = e instanceof Error ? e.message : String(e);
    return { relaunches: 0, results: rotas.map((rota) => ({ rota, success: false, capture_status: 'erro', rota_alcancada: false, error: erro })) };
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
  // Divide em LOTES; cada lote reusa 1 browser no playwright route. MAX_CONCURRENT lotes em paralelo.
  const lotes: string[][] = [];
  for (let i = 0; i < rotas.length; i += BATCH_SIZE) lotes.push(rotas.slice(i, i + BATCH_SIZE));
  const porLote = await runWithConcurrency(lotes, (lote) => captureBatch(lote, baseUrl, watcherSecret), MAX_CONCURRENT);
  const results = porLote.flatMap((p) => p.results);
  const relaunches_total = porLote.reduce((acc, p) => acc + p.relaunches, 0);
  const totalMs = Date.now() - startedAt;

  // COBERTURA REAL DA AUDITORIA: alcançadas (foto válida) vs não-alcançadas, por motivo.
  const alcancadas = results.filter((r) => r.rota_alcancada === true).length;
  const nao_alcancada_redirect = results.filter((r) => r.capture_status === 'rota_nao_alcancada').length;
  const nao_carregou = results.filter((r) => r.capture_status === 'nao_carregou').length;
  const erro = results.filter((r) => r.capture_status === 'erro' || (!r.capture_status && !r.success)).length;
  const success_count = alcancadas;
  const error_count = results.length - success_count;

  return NextResponse.json({
    success: true,
    total: results.length,
    // cobertura: quantas rotas foram REALMENTE alcançadas e fotografadas
    cobertura: {
      alcancadas,
      nao_alcancadas: results.length - alcancadas,
      por_motivo: { redirect_modulo_ausente: nao_alcancada_redirect, nao_carregou, erro },
      pct_alcancada: results.length ? Math.round((alcancadas / results.length) * 100) : 0,
      // quantas vezes o browser morreu no meio de um lote e foi relançado — se for alto, o serverless
      // não sustenta nem 1 browser por lote e a obra maior (runtime dedicado) fica justificada no dado.
      relaunches_browser: relaunches_total,
    },
    success_count,
    error_count,
    duration_ms: totalMs,
    results,
  });
}
