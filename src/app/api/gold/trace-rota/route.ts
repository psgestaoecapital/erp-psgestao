// POST /api/gold/trace-rota  ·  Header: x-watcher-secret
// Body: { rota: string, empresa_id?: string, segundos?: number }
//
// Diagnóstico do HOTFIX Configuração Fiscal (18/09): abre a rota logado como o robô, com o
// ps_empresa_sel pedido, e por N segundos conta TODAS as requisições (por URL normalizada, com e
// sem /api e _next), erros de console e navegações (framenavigated). Devolve o top-10 de URLs mais
// repetidas — para achar a enxurrada que derruba o navegador (ERR_INSUFFICIENT_RESOURCES) sem
// depender de um browser autenticado local. Rota de LEITURA/telemetria; não altera dado nenhum.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium-min';
import { chromium as playwright } from 'playwright-core';
import type { Browser } from 'playwright-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 300s como o /api/gold/auditar-rota (mesmo padrão chromium): o cold-launch do chromium-min
// (baixa+extrai o pack ~50MB do GitHub) sozinho passa de 60s. Com 60 a função era morta pela
// Vercel no meio → HTML "500: This page couldn't load" (não o nosso JSON). Foi essa a causa do
// 500 no preview, não o alvo.
export const maxDuration = 300;

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

type Body = { rota?: string; empresa_id?: string; segundos?: number };

// normaliza a URL p/ agrupar: tira o host e a query, mas mantém o path (e um marcador de query).
function normalizar(u: string): string {
  try {
    const url = new URL(u);
    const q = url.search ? ' ?…' : '';
    return `${url.pathname}${q}`;
  } catch { return u.slice(0, 120); }
}

export async function POST(req: Request) {
  const expected = process.env.WATCHER_SECRET;
  if (!expected || req.headers.get('x-watcher-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rota = (body.rota || '').trim();
  if (!rota.startsWith('/')) return NextResponse.json({ error: 'rota deve comecar com /' }, { status: 400 });
  const empresaId = (body.empresa_id || 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725').trim(); // default PS LTDA
  // LGPD (gate fa303195): o robô só abre a tela como [BOT] (b0700000-…) ou PS LTDA (b26c19c0-…).
  // Empresa de cliente exigiria bucket privado — recusa aqui (mesma trava do screen-watcher).
  if (empresaId !== 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725' && !empresaId.startsWith('b0700000-')) {
    return NextResponse.json({ error: 'foto de empresa cliente exige bucket privado', empresa_id: empresaId }, { status: 403 });
  }
  const segundos = Math.min(Math.max(Number(body.segundos) || 20, 5), 40);

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const SAAS_BASE_URL = process.env.SAAS_BASE_URL || 'https://erp-psgestao.vercel.app';
  const BOT_EMAIL = process.env.PLAYWRIGHT_USER_EMAIL!;
  const BOT_PASSWORD = process.env.PLAYWRIGHT_USER_PASSWORD!;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOT_EMAIL || !BOT_PASSWORD) {
    return NextResponse.json({ error: 'env faltando' }, { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const PROJECT_REF = SUPABASE_URL.replace('https://', '').split('.')[0];

  let browser: Browser | null = null;
  const contagem = new Map<string, number>();
  const consoleErros: string[] = [];
  const navegacoes: string[] = [];
  let totalReq = 0;

  try {
    const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({ email: BOT_EMAIL, password: BOT_PASSWORD });
    if (signErr || !signIn?.session) throw new Error(`login bot: ${signErr?.message || 'sem session'}`);
    const s = signIn.session;
    const sessionPayload = JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
      expires_at: s.expires_at, token_type: s.token_type, user: s.user, provider_token: null, provider_refresh_token: null,
    });
    const storageKey = `sb-${PROJECT_REF}-auth-token`;

    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    browser = await playwright.launch({ args: chromium.args, executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    await context.addInitScript(
      ({ sk, sv, ek, ev }: { sk: string; sv: string; ek: string; ev: string }) => {
        try { window.localStorage.setItem(sk, sv); window.localStorage.setItem(ek, ev); } catch { /* */ }
      },
      { sk: storageKey, sv: sessionPayload, ek: 'ps_empresa_sel', ev: empresaId },
    );

    const page = await context.newPage();
    page.on('request', (r) => { totalReq++; const k = normalizar(r.url()); contagem.set(k, (contagem.get(k) || 0) + 1); });
    page.on('console', (m) => { if (m.type() === 'error') { const t = m.text().slice(0, 200); if (consoleErros.length < 40) consoleErros.push(t); } });
    page.on('framenavigated', (fr) => { if (fr === page.mainFrame() && navegacoes.length < 40) navegacoes.push(normalizar(fr.url())); });

    try {
      await page.goto(`${SAAS_BASE_URL}${rota}`, { waitUntil: 'commit', timeout: 20000 });
    } catch { /* pode estourar; seguimos coletando */ }
    await page.waitForTimeout(segundos * 1000).catch(() => {});
    await page.close().catch(() => {});
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'falha geral', detalhe: msg, total_requisicoes: totalReq }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const top10 = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([url, n]) => ({ url, n }));
  return NextResponse.json({
    rota, empresa_id: empresaId, janela_s: segundos,
    total_requisicoes: totalReq,
    top10_urls: top10,
    console_erros: consoleErros.slice(0, 15),
    navegacoes: navegacoes.slice(0, 20),
  });
}
