// POST /api/screen-watcher/playwright
// Body: { rota: string }
// Header: x-watcher-secret (valida WATCHER_SECRET env var)
//
// Captura uma screenshot PNG de uma rota autenticada do SaaS via
// Playwright headless Chromium (sparticuz para Vercel) e:
//  1. Faz upload pra bucket 'system-screenshots'
//  2. UPDATE system_screens.screenshot_url + screenshot_atualizado_em
//  3. INSERT system_screens_history (audit trail por captura)
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

  const rota = (body.rota || '').trim();
  if (!rota || !rota.startsWith('/')) {
    return NextResponse.json({ error: 'Body.rota deve comecar com /' }, { status: 400 });
  }

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

  // 4. Buscar screen_id pela rota
  const { data: screen, error: errScreen } = await supabase
    .from('system_screens')
    .select('id, rota')
    .eq('rota', rota)
    .maybeSingle();

  if (errScreen) {
    return NextResponse.json({ error: 'Erro buscando screen: ' + errScreen.message }, { status: 500 });
  }
  if (!screen) {
    return NextResponse.json({ error: `Rota nao catalogada: ${rota}` }, { status: 404 });
  }

  const screenId: string = screen.id;
  let browser: Browser | null = null;
  let captureStatus: 'ok' | 'erro' = 'ok';
  let errorMsg: string | null = null;
  let screenshotUrl: string | null = null;
  let errorsCount = 0;

  try {
    // 5. Lancar Chromium headless (Vercel-friendly via sparticuz)
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

    const page: Page = await context.newPage();

    // Coletar erros do console
    page.on('pageerror', () => {
      errorsCount++;
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') errorsCount++;
    });

    // 6. Login no SaaS
    await page.goto(`${SAAS_BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Localiza form de login na home (ou em /cliente)
    // Heuristica simples: esperar email input
    const emailInput = await page.locator('input[type="email"]').first();
    await emailInput.fill(PLAYWRIGHT_USER_EMAIL, { timeout: 8000 });
    const pwdInput = await page.locator('input[type="password"]').first();
    await pwdInput.fill(PLAYWRIGHT_USER_PASSWORD, { timeout: 4000 });
    await page.locator('button[type="submit"]').first().click({ timeout: 4000 });

    // Aguarda chegar no dashboard (10s max)
    await page.waitForURL(/\/(dashboard|admin)/, { timeout: 12000 }).catch(() => {
      /* segue mesmo se nao detectar; pode ja estar logado */
    });

    // 7. Navegar para rota alvo
    await page.goto(`${SAAS_BASE_URL}${rota}`, { waitUntil: 'networkidle', timeout: 25000 });
    // pequeno delay pra animacoes/skeletons
    await page.waitForTimeout(800);

    // 8. Screenshot
    const buffer = await page.screenshot({
      type: 'png',
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });

    // 9. Upload pra bucket
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${sanitizePathComponent(rota)}/${ts}.png`;

    const { error: errUp } = await supabase.storage
      .from('system-screenshots')
      .upload(path, buffer, {
        contentType: 'image/png',
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
  } catch (e: unknown) {
    captureStatus = 'erro';
    errorMsg = e instanceof Error ? e.message : String(e);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // 11. INSERT history (sempre, mesmo em erro — audit trail)
  const pageLoadMs = Date.now() - startedAt;
  await supabase.from('system_screens_history').insert({
    screen_id: screenId,
    rota,
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
      { success: false, screen_id: screenId, rota, error: errorMsg, page_load_ms: pageLoadMs },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    screen_id: screenId,
    rota,
    screenshot_url: screenshotUrl,
    page_load_ms: pageLoadMs,
    errors_count: errorsCount,
  });
}
