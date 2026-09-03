// POST /api/screen-watcher/playwright
// Body: { rota: string, empresa_id?: string }
// Header: x-watcher-secret (valida WATCHER_SECRET env var)
//
// PR #148 (24/05/2026): RD-38 Camada 1 + Bug 3 Playwright
// - Injeta ps_empresa_sel no localStorage (Bug 3 useCompanyIds)
// - Captura page.url() final + redirect_detectado (Camada 1 RD-38)
// - Aceita empresa_id opcional no body (extensibilidade)

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium-min';
import { chromium as playwright } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { executarVisualTruthRules, type VisualTruthResult } from '@/lib/visual-truth/executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

// PR #148: aceitar empresa_id opcional
type Body = { rota?: string; empresa_id?: string };

// PR #148: empresa default segura - Ps Gestao LTDA
// Razao: bot Playwright eh vinculado SO a esta empresa em user_companies.
// Outras empresas requerem extensao futura (passar empresa_id no body).
const EMPRESA_PADRAO_BOT = 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725';

function sanitizePathComponent(s: string): string {
  return s
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toLowerCase() || 'root';
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  const expected = process.env.WATCHER_SECRET;
  const got = req.headers.get('x-watcher-secret');
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rotaCompleta = (body.rota || '').trim();
  if (!rotaCompleta || !rotaCompleta.startsWith('/')) {
    return NextResponse.json({ error: 'Body.rota deve comecar com /' }, { status: 400 });
  }
  const rotaBase = rotaCompleta.split('?')[0].split('#')[0];

  // PR #148: empresa do body > default
  const empresaId = (body.empresa_id || '').trim() || EMPRESA_PADRAO_BOT;

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SAAS_BASE_URL = process.env.SAAS_BASE_URL || 'https://erp-psgestao.vercel.app';
  const PLAYWRIGHT_USER_EMAIL = process.env.PLAYWRIGHT_USER_EMAIL;
  const PLAYWRIGHT_USER_PASSWORD = process.env.PLAYWRIGHT_USER_PASSWORD;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_URL ou SERVICE_ROLE_KEY nao configuradas' },
      { status: 500 },
    );
  }
  if (!PLAYWRIGHT_USER_EMAIL || !PLAYWRIGHT_USER_PASSWORD) {
    return NextResponse.json(
      { error: 'PLAYWRIGHT_USER_EMAIL ou PLAYWRIGHT_USER_PASSWORD nao configuradas' },
      { status: 500 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const PROJECT_REF = SUPABASE_URL.replace('https://', '').split('.')[0];

  const { data: screenRow } = await supabase
    .from('system_screens')
    .select('id')
    .eq('rota', rotaBase)
    .maybeSingle();

  const screenId = screenRow?.id ?? sanitizePathComponent(rotaBase);

  let browser: Browser | null = null;
  let screenshotUrl: string | null = null;
  // 'rota_nao_alcancada' = a URL final divergiu da pedida (redirect por módulo ausente etc.):
  //   NÃO fotografa, pois foto de tela errada vira score falso — pior que foto nenhuma.
  // 'nao_carregou' = a página não assentou (loading infinito): também não fotografa.
  let captureStatus: 'sucesso' | 'erro' | 'rota_nao_alcancada' | 'nao_carregou' = 'sucesso';
  let rotaAlcancada = false;
  let errorMsg: string | null = null;
  let errorsCount = 0;
  let visualTruth: VisualTruthResult | null = null;
  // PR #148: RD-38 Camada 1 - capturar URL final visitada
  let urlFinalVisitada: string | null = null;
  let redirectDetectado = false;
  let authState: 'autenticado' | 'redirected_login' | 'redirected_root' | 'erro_session' | 'desconhecido' = 'desconhecido';
  // FIX 2 · guarda anti-login: se caiu no login, re-autentica e tenta 1x antes de desistir.
  let loginRetentado = false;

  try {
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    browser = await playwright.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    const botClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const storageKey = `sb-${PROJECT_REF}-auth-token`;

    // FIX 2 · autentica o bot e devolve o payload de sessão pronto pra localStorage.
    // Reutilizável: usado no init e de novo no re-login da guarda anti-login.
    // Pilar 2: token nunca é logado — só injetado no localStorage do contexto.
    async function obterSessionPayload(): Promise<string> {
      const { data: signInData, error: signInError } = await botClient.auth.signInWithPassword({
        email: PLAYWRIGHT_USER_EMAIL!,
        password: PLAYWRIGHT_USER_PASSWORD!,
      });
      if (signInError || !signInData?.session) {
        throw new Error(`Falha login bot: ${signInError?.message || 'sem session'}`);
      }
      const s = signInData.session;
      return JSON.stringify({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_in: s.expires_in,
        expires_at: s.expires_at,
        token_type: s.token_type,
        user: s.user,
        provider_token: null,
        provider_refresh_token: null,
      });
    }

    const sessionPayload = await obterSessionPayload();

    // PR #148: injecao de DOIS itens - session JWT + ps_empresa_sel
    // Razao: useCompanyIds() le ps_empresa_sel de localStorage; sem isso
    // pagina cadastros/clientes mostra "Selecione empresa" mesmo logado.
    await context.addInitScript(
      ({ sessionKey, sessionValue, empresaKey, empresaValue }) => {
        try {
          window.localStorage.setItem(sessionKey, sessionValue);
          window.localStorage.setItem(empresaKey, empresaValue);
        } catch {
          /* localStorage indisponivel em about:blank - sera definido na primeira navegacao */
        }
      },
      {
        sessionKey: storageKey,
        sessionValue: sessionPayload,
        empresaKey: 'ps_empresa_sel',
        empresaValue: empresaId,
      },
    );

    const page: Page = await context.newPage();

    page.on('pageerror', () => {
      errorsCount++;
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errorsCount++;
    });

    const urlAlvo = `${SAAS_BASE_URL}${rotaCompleta}`;

    // FIX 2 · guarda anti-login robusta: URL /login OU root OU campo de senha no DOM.
    // Só a URL não basta — algumas telas renderizam o form de login sem trocar a URL.
    async function ehTelaLogin(): Promise<boolean> {
      const u = page.url();
      if (u.includes('/login')) return true;
      if (u === `${SAAS_BASE_URL}/`) return true;
      const temSenha = await page.$('input[type="password"]');
      return temSenha !== null;
    }

    // FIX 2 · re-autentica e reinjeta a sessão no localStorage vivo da página.
    async function reautenticar(): Promise<void> {
      const novoPayload = await obterSessionPayload();
      await page.evaluate(
        ({ key, value, empresaKey, empresaValue }) => {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem(empresaKey, empresaValue);
        },
        { key: storageKey, value: novoPayload, empresaKey: 'ps_empresa_sel', empresaValue: empresaId },
      );
    }

    // FIX screen-watcher · espera a página ASSENTAR antes de fotografar. Muitos scores
    // baixos eram foto tirada no meio do load (loading infinito, "PSPS" duplicado). Espera
    // sumir o texto de carregamento E aparecer conteúdo real, com teto de ~7s.
    async function aguardarConteudo(): Promise<boolean> {
      for (let i = 0; i < 14; i++) {
        const ok = await page.evaluate(() => {
          const t = (document.body?.innerText || '');
          const txtLen = t.replace(/\s+/g, '').length;
          // app-shell TRAVADO (os casos do CEO): menu/permissões/empresas não resolveram.
          // NÃO barra por um "Carregando" de widget isolado numa página cheia.
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

    // FIX 2 · se caiu no login, re-autentica e tenta 1x antes de desistir.
    if (await ehTelaLogin()) {
      loginRetentado = true;
      await reautenticar();
      await page.goto(urlAlvo, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(800);
    }

    // PR #148: RD-38 Camada 1 - capturar URL final e classificar auth state
    urlFinalVisitada = page.url();
    const urlPedidaSemHash = urlAlvo.split('#')[0];
    const urlFinalSemHash = urlFinalVisitada.split('#')[0];
    redirectDetectado = urlPedidaSemHash !== urlFinalSemHash;

    // FIX 2 · se ainda é login depois do retry → NÃO analisar (não gasta Claude com print de login).
    if (await ehTelaLogin()) {
      const naRoot = urlFinalVisitada === `${SAAS_BASE_URL}/`;
      authState = naRoot && !urlFinalVisitada.includes('/login') ? 'redirected_root' : 'redirected_login';
      throw new Error(
        `Bot caiu na tela de login ao acessar ${rotaCompleta} (URL final: ${urlFinalVisitada}, retry=${loginRetentado})`,
      );
    }

    const sessionStillPresent = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return Boolean(parsed?.access_token);
      } catch {
        return false;
      }
    }, storageKey);
    if (!sessionStillPresent) {
      authState = 'erro_session';
      throw new Error(`Bot session sumiu do localStorage durante captura (URL: ${page.url()})`);
    }

    authState = 'autenticado';

    // FIX (prioridade do CEO): CONFERE A URL FINAL ANTES DE FOTOGRAFAR. Se a tela final
    // divergiu da pedida, a rota NÃO foi alcançada (redirect por módulo ausente etc.).
    // Não fotografa, e ZERA a foto antiga (que também era da tela errada) — assim o painel
    // diz "não analisada" em vez de mentir com um score. Foto de tela errada é pior que nenhuma.
    const finalPath = (() => {
      try { return (new URL(urlFinalVisitada!).pathname.replace(/\/+$/, '')) || '/'; } catch { return ''; }
    })();
    const pedidoPath = rotaBase.replace(/\/+$/, '') || '/';
    rotaAlcancada = finalPath === pedidoPath || finalPath.startsWith(pedidoPath + '/');

    if (!rotaAlcancada) {
      captureStatus = 'rota_nao_alcancada';
      errorMsg =
        `Rota não alcançada: pedido ${pedidoPath}, tela final ${finalPath}` +
        (redirectDetectado ? ' (redirect — provável módulo ausente na empresa do robô)' : '');
      // não fotografa; limpa a foto antiga (tela errada) para não virar score falso
      await supabase
        .from('system_screens')
        .update({ screenshot_url: null, screenshot_atualizado_em: new Date().toISOString() })
        .eq('id', screenId);
    } else if (!(await aguardarConteudo())) {
      captureStatus = 'nao_carregou';
      errorMsg = `Página não assentou (loading) em ${rotaBase} — não fotografada para não medir foto no meio do load`;
      // loading costuma ser transitório: mantém a última foto boa (não sobrescreve nem zera)
    } else {
      const buffer = await page.screenshot({
        type: 'jpeg',
        quality: 75,
        fullPage: false,
        clip: { x: 0, y: 0, width: 1280, height: 800 },
      });

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `${sanitizePathComponent(rotaBase)}/${ts}.jpg`;

      const { error: errUp } = await supabase.storage
        .from('system-screenshots')
        .upload(path, buffer, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (errUp) {
        throw new Error('Upload falhou: ' + errUp.message);
      }

      const { data: pub } = supabase.storage.from('system-screenshots').getPublicUrl(path);
      screenshotUrl = pub?.publicUrl ?? null;

      if (screenshotUrl) {
        await supabase
          .from('system_screens')
          .update({
            screenshot_url: screenshotUrl,
            screenshot_atualizado_em: new Date().toISOString(),
          })
          .eq('id', screenId);
      }

      try {
        visualTruth = await executarVisualTruthRules(page, screenId, rotaBase, supabase);
        if (visualTruth.regras_executadas + visualTruth.regras_puladas > 0) {
          console.log(
            `[visual-truth] ${rotaBase}: ${visualTruth.regras_executadas} executadas, ` +
              `${visualTruth.alertas_inseridos} alertas, ${visualTruth.regras_puladas} puladas`,
          );
        }
      } catch (vtErr) {
        console.error('[visual-truth] erro nao fatal:', vtErr);
      }
    }
  } catch (e: unknown) {
    captureStatus = 'erro';
    errorMsg = e instanceof Error ? e.message : String(e);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const pageLoadMs = Date.now() - startedAt;
  await supabase.from('system_screens_history').insert({
    screen_id: screenId,
    rota: rotaCompleta,
    screenshot_url: screenshotUrl,
    errors_count: errorsCount,
    errors_snapshot: errorMsg,
    page_load_ms: pageLoadMs,
    capture_method: 'playwright',
    capture_status: captureStatus,
    captured_at: new Date().toISOString(),
  });

  if (captureStatus === 'erro') {
    return NextResponse.json(
      {
        success: false,
        capture_status: captureStatus,
        rota_alcancada: false,
        screen_id: screenId,
        rota: rotaCompleta,
        error: errorMsg,
        page_load_ms: pageLoadMs,
        // PR #148: Camada 1 RD-38
        url_final_visitada: urlFinalVisitada,
        redirect_detectado: redirectDetectado,
        auth_state: authState,
        login_retentado: loginRetentado,
      },
      { status: 500 },
    );
  }

  // Rota não alcançada (redirect por módulo ausente) ou não assentou (loading): NÃO é erro
  // de servidor, mas NÃO é captura válida — cobertura real conta isto como "não alcançada".
  if (captureStatus === 'rota_nao_alcancada' || captureStatus === 'nao_carregou') {
    return NextResponse.json({
      success: false,
      capture_status: captureStatus,
      rota_alcancada: false,
      screen_id: screenId,
      rota: rotaCompleta,
      rota_base: rotaBase,
      motivo: errorMsg,
      page_load_ms: pageLoadMs,
      url_final_visitada: urlFinalVisitada,
      redirect_detectado: redirectDetectado,
      auth_state: authState,
      login_retentado: loginRetentado,
      empresa_id_usada: empresaId,
    });
  }

  return NextResponse.json({
    success: true,
    capture_status: captureStatus,
    rota_alcancada: true,
    screen_id: screenId,
    rota: rotaCompleta,
    rota_base: rotaBase,
    screenshot_url: screenshotUrl,
    page_load_ms: pageLoadMs,
    errors_count: errorsCount,
    visual_truth: visualTruth,
    // PR #148: Camada 1 RD-38
    url_final_visitada: urlFinalVisitada,
    redirect_detectado: redirectDetectado,
    auth_state: authState,
    login_retentado: loginRetentado,
    empresa_id_usada: empresaId,
  });
}
