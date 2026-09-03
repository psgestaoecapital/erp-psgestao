// POST /api/screen-watcher/playwright
// Body: { rota: string, empresa_id?: string }  (compat)  OU  { rotas: string[], empresa_id?: string } (lote)
// Header: x-watcher-secret (valida WATCHER_SECRET)
//
// PR #148 (24/05/2026): RD-38 Camada 1 + Bug 3 Playwright.
// FIX gargalo (03/09/2026): REUSA UM BROWSER POR LOTE. Antes subia 1 Chromium POR ROTA; no
//   serverless isso estourava (Decompression failed / browser closed) e ~metade das rotas
//   alcançadas morria na captura física. Agora: launch do browser + login do bot UMA vez, e o
//   lote roda no MESMO browser (um context novo por rota, para isolar sessão/estado). Uma rota
//   que falha não derruba o lote — cada uma tem seu try/catch e o browser segue de pé.

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium-min';
import { chromium as playwright } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { executarVisualTruthRules, type VisualTruthResult } from '@/lib/visual-truth/executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

type Body = { rota?: string; rotas?: string[]; empresa_id?: string };

// PR #148: empresa default segura - Ps Gestao LTDA (bot vinculado SÓ a ela em user_companies).
const EMPRESA_PADRAO_BOT = 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725';

function sanitizePathComponent(s: string): string {
  return s
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toLowerCase() || 'root';
}

interface Resultado {
  rota: string;
  rota_base: string;
  screen_id: string;
  success: boolean;
  capture_status: 'sucesso' | 'erro' | 'rota_nao_alcancada' | 'nao_carregou';
  rota_alcancada: boolean;
  screenshot_url: string | null;
  error?: string | null;
  motivo?: string | null;
  page_load_ms: number;
  errors_count: number;
  visual_truth: VisualTruthResult | null;
  url_final_visitada: string | null;
  redirect_detectado: boolean;
  auth_state: string;
  login_retentado: boolean;
  empresa_id_usada: string;
}

interface Ctx {
  supabase: SupabaseClient;
  SAAS_BASE_URL: string;
  storageKey: string;
  empresaId: string;
  sessionPayload: string;
  obterSessionPayload: () => Promise<string>;
}

// Captura UMA rota no browser já aberto (context novo por rota — isola sessão/estado).
async function capturarRota(browser: Browser, cfg: Ctx, rotaCompleta: string): Promise<Resultado> {
  const startedAt = Date.now();
  const { supabase, SAAS_BASE_URL, storageKey, empresaId, sessionPayload } = cfg;
  const rotaBase = rotaCompleta.split('?')[0].split('#')[0];

  const { data: screenRow } = await supabase.from('system_screens').select('id').eq('rota', rotaBase).maybeSingle();
  const screenId = screenRow?.id ?? sanitizePathComponent(rotaBase);

  let screenshotUrl: string | null = null;
  let captureStatus: Resultado['capture_status'] = 'sucesso';
  let rotaAlcancada = false;
  let errorMsg: string | null = null;
  let errorsCount = 0;
  let visualTruth: VisualTruthResult | null = null;
  let urlFinalVisitada: string | null = null;
  let redirectDetectado = false;
  let authState = 'desconhecido';
  let loginRetentado = false;

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  try {
    await context.addInitScript(
      ({ sessionKey, sessionValue, empresaKey, empresaValue }) => {
        try {
          window.localStorage.setItem(sessionKey, sessionValue);
          window.localStorage.setItem(empresaKey, empresaValue);
        } catch { /* about:blank — definido na 1ª navegação */ }
      },
      { sessionKey: storageKey, sessionValue: sessionPayload, empresaKey: 'ps_empresa_sel', empresaValue: empresaId },
    );

    const page = await context.newPage();
    page.on('pageerror', () => { errorsCount++; });
    page.on('console', (msg) => { if (msg.type() === 'error') errorsCount++; });

    const urlAlvo = `${SAAS_BASE_URL}${rotaCompleta}`;

    async function ehTelaLogin(): Promise<boolean> {
      const u = page.url();
      if (u.includes('/login')) return true;
      if (u === `${SAAS_BASE_URL}/`) return true;
      return (await page.$('input[type="password"]')) !== null;
    }
    async function reautenticar(): Promise<void> {
      const novoPayload = await cfg.obterSessionPayload();
      await page.evaluate(
        ({ key, value, empresaKey, empresaValue }) => {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem(empresaKey, empresaValue);
        },
        { key: storageKey, value: novoPayload, empresaKey: 'ps_empresa_sel', empresaValue: empresaId },
      );
    }
    // espera a página ASSENTAR (só barra app-shell travado ou página quase vazia, não widget isolado).
    async function aguardarConteudo(): Promise<boolean> {
      for (let i = 0; i < 14; i++) {
        const ok = await page.evaluate(() => {
          const t = (document.body?.innerText || '');
          const txtLen = t.replace(/\s+/g, '').length;
          const shellTravado = /verificando permiss|carregando menu|carregando empresas|carregando dados do/i.test(t);
          const quaseVazia = txtLen < 120;
          const spinnerDominante = quaseVazia && /carregando|aguarde/i.test(t);
          return txtLen > 180 && !shellTravado && !spinnerDominante;
        });
        if (ok) return true;
        await page.waitForTimeout(500);
      }
      return false;
    }

    await page.goto(urlAlvo, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    if (await ehTelaLogin()) {
      loginRetentado = true;
      await reautenticar();
      await page.goto(urlAlvo, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(800);
    }

    urlFinalVisitada = page.url();
    redirectDetectado = urlAlvo.split('#')[0] !== urlFinalVisitada.split('#')[0];

    if (await ehTelaLogin()) {
      const naRoot = urlFinalVisitada === `${SAAS_BASE_URL}/`;
      authState = naRoot && !urlFinalVisitada.includes('/login') ? 'redirected_root' : 'redirected_login';
      throw new Error(`Bot caiu na tela de login ao acessar ${rotaCompleta} (URL final: ${urlFinalVisitada}, retry=${loginRetentado})`);
    }
    const sessionOk = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      try { return Boolean(JSON.parse(raw)?.access_token); } catch { return false; }
    }, storageKey);
    if (!sessionOk) { authState = 'erro_session'; throw new Error(`Bot session sumiu do localStorage (URL: ${page.url()})`); }
    authState = 'autenticado';

    // CONFERE a URL final antes de fotografar (não salva tela errada).
    const finalPath = (() => { try { return (new URL(urlFinalVisitada!).pathname.replace(/\/+$/, '')) || '/'; } catch { return ''; } })();
    const pedidoPath = rotaBase.replace(/\/+$/, '') || '/';
    rotaAlcancada = finalPath === pedidoPath || finalPath.startsWith(pedidoPath + '/');

    if (!rotaAlcancada) {
      captureStatus = 'rota_nao_alcancada';
      errorMsg = `Rota não alcançada: pedido ${pedidoPath}, tela final ${finalPath}` +
        (redirectDetectado ? ' (redirect — provável módulo ausente na empresa do robô)' : '');
      await supabase.from('system_screens').update({
        screenshot_url: null, screenshot_atualizado_em: new Date().toISOString(),
        auditavel_robo: false, motivo_nao_auditavel: 'módulo não habilitado para o auditor (redirect para ' + finalPath + ')',
        auditabilidade_em: new Date().toISOString(),
      }).eq('id', screenId);
    } else if (!(await aguardarConteudo())) {
      captureStatus = 'nao_carregou';
      errorMsg = `Página não assentou (loading) em ${rotaBase} — não fotografada para não medir foto no meio do load`;
    } else {
      const buffer = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 800 } });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `${sanitizePathComponent(rotaBase)}/${ts}.jpg`;
      const { error: errUp } = await supabase.storage.from('system-screenshots').upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
      if (errUp) throw new Error('Upload falhou: ' + errUp.message);
      const { data: pub } = supabase.storage.from('system-screenshots').getPublicUrl(path);
      screenshotUrl = pub?.publicUrl ?? null;
      if (screenshotUrl) {
        await supabase.from('system_screens').update({
          screenshot_url: screenshotUrl, screenshot_atualizado_em: new Date().toISOString(),
          auditavel_robo: true, motivo_nao_auditavel: null, auditabilidade_em: new Date().toISOString(),
        }).eq('id', screenId);
      }
      try {
        visualTruth = await executarVisualTruthRules(page, screenId, rotaBase, supabase);
      } catch (vtErr) { console.error('[visual-truth] erro nao fatal:', vtErr); }
    }
  } catch (e: unknown) {
    captureStatus = 'erro';
    errorMsg = e instanceof Error ? e.message : String(e);
  } finally {
    await context.close().catch(() => {});
  }

  const pageLoadMs = Date.now() - startedAt;
  if (screenRow?.id) {
    const { error: histErr } = await supabase.from('system_screens_history').insert({
      screen_id: screenRow.id, rota: rotaCompleta, screenshot_url: screenshotUrl, errors_count: errorsCount,
      errors_snapshot: errorMsg, page_load_ms: pageLoadMs, capture_method: 'playwright', capture_status: captureStatus,
      captured_at: new Date().toISOString(),
    });
    if (histErr) {
      console.error('[screen-watcher] history insert falhou:', histErr.message);
      await supabase.rpc('fn_ia_falha_registrar', {
        p_runtime: 'next', p_endpoint: 'screen-watcher/history', p_finalidade: 'telemetria', p_modelo: 'n/a',
        p_status: null, p_erro: 'insert system_screens_history falhou: ' + histErr.message, p_company_id: null,
      }).then(() => {}, () => {});
    }
  }

  return {
    rota: rotaCompleta, rota_base: rotaBase, screen_id: screenId,
    success: captureStatus === 'sucesso', capture_status: captureStatus, rota_alcancada: captureStatus === 'sucesso',
    screenshot_url: screenshotUrl, error: captureStatus === 'erro' ? errorMsg : undefined, motivo: errorMsg,
    page_load_ms: pageLoadMs, errors_count: errorsCount, visual_truth: visualTruth,
    url_final_visitada: urlFinalVisitada, redirect_detectado: redirectDetectado, auth_state: authState,
    login_retentado: loginRetentado, empresa_id_usada: empresaId,
  };
}

export async function POST(req: Request) {
  const expected = process.env.WATCHER_SECRET;
  if (!expected || req.headers.get('x-watcher-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const rotas = (body.rotas && body.rotas.length ? body.rotas : (body.rota ? [body.rota] : []))
    .map((r) => (r || '').trim()).filter((r) => r.startsWith('/'));
  if (rotas.length === 0) {
    return NextResponse.json({ error: 'Informe rota (string) ou rotas (array), começando com /' }, { status: 400 });
  }

  const empresaId = (body.empresa_id || '').trim() || EMPRESA_PADRAO_BOT;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SAAS_BASE_URL = process.env.SAAS_BASE_URL || 'https://erp-psgestao.vercel.app';
  const PLAYWRIGHT_USER_EMAIL = process.env.PLAYWRIGHT_USER_EMAIL;
  const PLAYWRIGHT_USER_PASSWORD = process.env.PLAYWRIGHT_USER_PASSWORD;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return NextResponse.json({ error: 'SUPABASE_URL/SERVICE_ROLE_KEY ausentes' }, { status: 500 });
  if (!PLAYWRIGHT_USER_EMAIL || !PLAYWRIGHT_USER_PASSWORD) return NextResponse.json({ error: 'PLAYWRIGHT_USER_EMAIL/PASSWORD ausentes' }, { status: 500 });

  // `supabase` FICA como service_role para storage/db (bypassa RLS). NÃO chamar signInWithPassword nele:
  // signInWithPassword SETA a sessão no cliente que o chama, trocando o Authorization de service_role
  // para o JWT do usuário — aí todo upload/insert seguinte iria como o bot-usuário e BATERIA na RLS.
  // Foi exatamente o "Upload falhou: new row violates row-level security policy" do preview do #1246.
  // Por isso o login do bot roda num cliente SEPARADO (authClient), deixando `supabase` intocado.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const PROJECT_REF = SUPABASE_URL.replace('https://', '').split('.')[0];
  const storageKey = `sb-${PROJECT_REF}-auth-token`;

  async function obterSessionPayload(): Promise<string> {
    const { data, error } = await authClient.auth.signInWithPassword({ email: PLAYWRIGHT_USER_EMAIL!, password: PLAYWRIGHT_USER_PASSWORD! });
    if (error || !data?.session) throw new Error(`Falha login bot: ${error?.message || 'sem session'}`);
    const s = data.session;
    return JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
      expires_at: s.expires_at, token_type: s.token_type, user: s.user, provider_token: null, provider_refresh_token: null,
    });
  }

  async function abrirBrowser(): Promise<Browser> {
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    return playwright.launch({ args: chromium.args, executablePath, headless: true });
  }
  // O browser compartilhado pode MORRER no meio do lote (o serverless recicla o processo — visto
  // em prova: 1ª rota captura, depois todas caem em "Target page, context or browser has been closed").
  // Quando isso acontece, uma rota não pode levar o lote inteiro junto.
  const BROWSER_MORTO = /has been closed|context or browser|Browser closed|Connection closed|crashed|Protocol error|Target closed/i;

  let browser: Browser | null = null;
  let relaunches = 0; // telemetria: quão frágil o browser está no serverless (decide se a obra maior é necessária)
  const resultados: Resultado[] = [];
  const pushErro = (rota: string, msg: string) => resultados.push({
    rota, rota_base: rota.split('?')[0], screen_id: sanitizePathComponent(rota.split('?')[0]),
    success: false, capture_status: 'erro', rota_alcancada: false, screenshot_url: null,
    error: msg, page_load_ms: 0, errors_count: 0, visual_truth: null,
    url_final_visitada: null, redirect_detectado: false, auth_state: 'desconhecido', login_retentado: false, empresa_id_usada: empresaId,
  });
  try {
    const sessionPayload = await obterSessionPayload();  // login do bot UMA vez para o lote
    browser = await abrirBrowser();                       // browser UMA vez (relançado só se morrer no meio)
    const cfg: Ctx = { supabase, SAAS_BASE_URL, storageKey, empresaId, sessionPayload, obterSessionPayload };
    for (const rota of rotas) {
      try {
        resultados.push(await capturarRota(browser, cfg, rota));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // Browser morto no meio do lote: RELANÇA e refaz ESTA rota. Pior caso (browser morre a cada
        // rota) = 1 launch por rota = comportamento antigo, nunca pior; melhor caso = 1 launch pro lote.
        if (BROWSER_MORTO.test(msg)) {
          relaunches++;
          await browser?.close().catch(() => {});
          try {
            browser = await abrirBrowser();
            resultados.push(await capturarRota(browser, cfg, rota));
            continue;
          } catch (e2: unknown) {
            pushErro(rota, `relaunch falhou: ${e2 instanceof Error ? e2.message : String(e2)}`);
            continue;
          }
        }
        pushErro(rota, msg); // rota que estoura (não por morte do browser) não derruba o lote
      }
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), relaunches, resultados }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Compat: 1 rota → devolve o objeto no topo (como antes) + em resultados. Lote → só resultados.
  if (resultados.length === 1) {
    return NextResponse.json({ ...resultados[0], relaunches, resultados });
  }
  return NextResponse.json({ success: true, total: resultados.length, relaunches, resultados });
}
