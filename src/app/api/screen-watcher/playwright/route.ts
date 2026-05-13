// POST /api/screen-watcher/playwright
// Body: { rota: string }
// Header: x-watcher-secret (valida WATCHER_SECRET env var)
//
// Captura uma screenshot JPEG (qualidade 75) de uma rota autenticada do SaaS
// via Playwright headless Chromium (sparticuz para Vercel) e:
//  1. Faz upload pra bucket 'system-screenshots'
//  2. UPDATE system_screens.screenshot_url + screenshot_atualizado_em
//  3. INSERT system_screens_history (audit trail por captura)
//
// JPEG q=75 vs PNG: reduz tokens_input ~33% no Insight Auditor IA sem
// perda perceptual na analise (UI screenshots). Custo medio por tela
// cai de ~$0.013 para ~$0.009.
//
// Auth: WATCHER_SECRET (header x-watcher-secret)
// Runtime: nodejs (playwright NAO funciona em edge runtime)
// Memoria: 1024 MB · maxDuration: 60s (configurado em vercel.json)
// PR M.A.7.5.2

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium-min';
import { chromium as playwright } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { executarVisualTruthRules, type VisualTruthResult } from '@/lib/visual-truth/executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sparticuz pack — versao casada com playwright-core 1.59.x
const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

type Body = { rota?: string };

function sanitizePathComponent(s: string): string {
  // Converte "/dashboard/admin" -> "dashboard_admin" para path no bucket
  return s
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toLowerCase() || 'root';
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  // 1. Auth via secret header
  const expected = process.env.WATCHER_SECRET;
  const got = req.headers.get('x-watcher-secret');
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body
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
  // Bug A fix: rota_base separa lookup em system_screens (sem ?query=)
  // de rotaCompleta usada na navegacao do Playwright (preserva ?area=).
  const rotaBase = rotaCompleta.split('?')[0].split('#')[0];

  // 3. Env vars necessarias
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
      { error: 'PLAYWRIGHT_USER_EMAIL/PASSWORD nao configurados' },
      { status: 500 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 4. Buscar screen_id pela rota base (sem query string)
  const { data: screen, error: errScreen } = await supabase
    .from('system_screens')
    .select('id, rota')
    .eq('rota', rotaBase)
    .maybeSingle();

  if (errScreen) {
    return NextResponse.json({ error: 'Erro buscando screen: ' + errScreen.message }, { status: 500 });
  }
  if (!screen) {
    return NextResponse.json({ error: `Rota nao catalogada: ${rotaBase}` }, { status: 404 });
  }

  const screenId: string = screen.id;
  let browser: Browser | null = null;
  let captureStatus: 'ok' | 'erro' = 'ok';
  let errorMsg: string | null = null;
  let screenshotUrl: string | null = null;
  let errorsCount = 0;
  let visualTruth: VisualTruthResult | null = null;

  try {
    // 5a. Gerar session do bot via Admin API (server-side, antes do browser).
    // Refactor 13/05/2026: substitui o login UI client-side (PR #119/#120)
    // pela injecao direta da session no localStorage via addInitScript.
    // Resolve race condition definitivamente — getUser() do layout.tsx ja
    // encontra session na primeira leitura. Tambem evita rodar o form de
    // login no Playwright a cada captura (mais rapido, mais previsivel).
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signinData, error: signinError } = await adminClient.auth.signInWithPassword({
      email: PLAYWRIGHT_USER_EMAIL,
      password: PLAYWRIGHT_USER_PASSWORD,
    });
    if (signinError || !signinData.session) {
      return NextResponse.json(
        { error: `Bot signin falhou: ${signinError?.message ?? 'sessao vazia'}` },
        { status: 500 },
      );
    }
    const botSession = signinData.session;
    // Project ref derivado do URL: https://<ref>.supabase.co
    const PROJECT_REF = (() => {
      try {
        const host = new URL(SUPABASE_URL).hostname;
        return host.split('.')[0];
      } catch {
        return '';
      }
    })();
    if (!PROJECT_REF) {
      return NextResponse.json(
        { error: 'SUPABASE_URL invalida — nao foi possivel extrair project ref' },
        { status: 500 },
      );
    }

    // 5b. Lancar Chromium headless (Vercel-friendly via sparticuz)
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    browser = await playwright.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 PsGestaoScreenWatcher/1.0',
    });

    // 5c. Injetar session no localStorage do contexto ANTES de qualquer
    // page abrir. supabase-js le essa chave e considera o bot logado;
    // dispensa o fluxo UI completo. Passamos os dois campos serializados
    // como string JSON para evitar problemas de serializacao do Playwright.
    const sessionPayload = JSON.stringify({
      access_token: botSession.access_token,
      refresh_token: botSession.refresh_token,
      expires_in: botSession.expires_in,
      expires_at: botSession.expires_at,
      token_type: botSession.token_type,
      user: botSession.user,
      provider_token: null,
      provider_refresh_token: null,
    });
    const storageKey = `sb-${PROJECT_REF}-auth-token`;
    await context.addInitScript(
      ({ key, value }) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* localStorage indisponivel em about:blank — sera definido na primeira navegacao */
        }
      },
      { key: storageKey, value: sessionPayload },
    );

    const page: Page = await context.newPage();

    // Coletar erros do console
    page.on('pageerror', () => {
      errorsCount++;
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errorsCount++;
    });

    // 6. Navegar direto para rota alvo (usa rotaCompleta preserva ?area=).
    // Sem login UI: addInitScript injetou session no localStorage, layout.tsx
    // chama getUser() e ja encontra usuario na primeira leitura.
    await page.goto(`${SAAS_BASE_URL}${rotaCompleta}`, { waitUntil: 'networkidle', timeout: 30000 });
    // pequeno delay pra animacoes/skeletons
    await page.waitForTimeout(800);

    // Sanity check: a session injetada deve ter sido aceita pelo cliente
    // supabase-js no momento em que layout.tsx montou. Se nao, o layout
    // teria redirecionado para '/'. Verificamos URL final + presenca da
    // chave no localStorage (proves session legivel pelo Supabase JS).
    if (page.url().includes('/login') || page.url() === `${SAAS_BASE_URL}/`) {
      throw new Error(`Bot redirecionado para login ao acessar ${rotaCompleta} (URL: ${page.url()})`);
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
      throw new Error(`Bot session sumiu do localStorage durante captura (URL: ${page.url()})`);
    }

    // 8. Screenshot — JPEG q=75 economiza ~33% tokens IA vs PNG
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 75,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });

    // 9. Upload pra bucket — usa rota base para path (uma pasta por rota,
    // independente da query string usada nessa captura).
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

    // 10. UPDATE system_screens (URL atual + timestamp)
    if (screenshotUrl) {
      await supabase
        .from('system_screens')
        .update({
          screenshot_url: screenshotUrl,
          screenshot_atualizado_em: new Date().toISOString(),
        })
        .eq('id', screenId);
    }

    // 11. Visual Truth — executa regras ativas para a screen capturada.
    // Erros nesse passo NAO derrubam a captura (ja persistida). Caminho A:
    // switch hardcoded em src/lib/visual-truth/executor.ts (zero dynamic SQL).
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
  } catch (e: unknown) {
    captureStatus = 'erro';
    errorMsg = e instanceof Error ? e.message : String(e);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // 11. INSERT history (sempre, mesmo em erro — audit trail)
  // History grava rotaCompleta para preservar contexto (?area=) no audit.
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
      { success: false, screen_id: screenId, rota: rotaCompleta, error: errorMsg, page_load_ms: pageLoadMs },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    screen_id: screenId,
    rota: rotaCompleta,
    rota_base: rotaBase,
    screenshot_url: screenshotUrl,
    page_load_ms: pageLoadMs,
    errors_count: errorsCount,
    visual_truth: visualTruth,
  });
}
