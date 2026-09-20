// POST /api/gold/auditar-rota
// Body: { rota: string, screen_id: string }
// Header: x-watcher-secret (valida WATCHER_SECRET)
//
// Gold G1 v2 (28/05/2026): ciclo completo de auditoria Camada 2 na Vercel.
// Playwright roda aqui (Node runtime) onde JÁ funciona desde PR #148.
// Para cada botão de gold_screen_buttons: clica → DOM → screenshot → Claude → veredito.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium-min';
import { chromium as playwright } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { modeloPara, registrarFalhaIA } from '@/lib/aiModel';
import { empresaPermitidaParaRobo, MSG_ROBO_SO_DEMO } from '@/lib/gold/roboEmpresaPermitida';
import { conferirEmpresaRenderizada } from '@/lib/gold/empresaRenderizada';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

// INCIDENTE LGPD 20/09 (0e8add26): o default NÃO pode ser empresa real. Cada vertical aponta para a sua
// DEMONSTRAÇÃO (is_demo). Sem demo da vertical ⇒ empresaPermitidaParaRobo recusa e a rota fica "NÃO AUDITADA".
const EMPRESA_BOT_OFICINA = 'b0700000-0000-4000-a000-000000000001'; // Demonstração · Oficina
const EMPRESA_BOT_PM = 'b0700000-0000-4000-a000-000000000002';      // Demonstração · Agência (P&M)
const EMPRESA_BOT_REVENDA = 'b0700000-0000-4000-a000-000000000003'; // Demonstração · Revenda
const EMPRESA_BOT_GE = 'b0700000-0000-4000-a000-000000000004';      // Demonstração · Comércio (GE) — default geral

type Body = { rota?: string; screen_id?: string };

interface BotaoRow {
  id: string;
  rota: string;
  botao_label: string;
  botao_selector_css: string;
  destino_esperado_rota: string | null;
  destino_esperado_descricao: string | null;
  prioridade: string | null;
  // B-correção: quando preenchida, um seletor não visível vira 'nao_testavel' (precondição não
  // satisfeita pelo robô — ex.: exige planta selecionada), não 'vermelho'. "não testável ≠ quebrado".
  precondicao: string | null;
}

export async function POST(req: Request) {
  const expected = process.env.WATCHER_SECRET;
  const got = req.headers.get('x-watcher-secret');
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rota = (body.rota || '').trim();
  if (!rota.startsWith('/')) {
    return NextResponse.json({ error: 'rota deve comecar com /' }, { status: 400 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const SAAS_BASE_URL = process.env.SAAS_BASE_URL || 'https://erp-psgestao.vercel.app';
  const BOT_EMAIL = process.env.PLAYWRIGHT_USER_EMAIL!;
  const BOT_PASSWORD = process.env.PLAYWRIGHT_USER_PASSWORD!;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOT_EMAIL || !BOT_PASSWORD || !ANTHROPIC_KEY) {
    return NextResponse.json({ error: 'env faltando' }, { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const PROJECT_REF = SUPABASE_URL.replace('https://', '').split('.')[0];

  const { data: botoes, error: botoesErr } = await supabase
    .from('gold_screen_buttons')
    .select('id, rota, botao_label, botao_selector_css, destino_esperado_rota, destino_esperado_descricao, prioridade, precondicao')
    .eq('rota', rota)
    .eq('ativo', true)
    .order('prioridade');

  if (botoesErr) return NextResponse.json({ error: botoesErr.message }, { status: 500 });
  if (!botoes?.length) return NextResponse.json({ erro: 'sem botoes', rota }, { status: 200 });

  let browser: Browser | null = null;
  const resultados: Array<{ botao_id: string; veredito: string; custo_usd: number; motivo: string }> = [];
  let custoTotal = 0;
  let authStatus = 'desconhecido';

  try {
    const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({
      email: BOT_EMAIL, password: BOT_PASSWORD,
    });
    if (signErr || !signIn?.session) throw new Error(`login bot: ${signErr?.message || 'sem session'}`);

    const session = signIn.session;
    const sessionPayload = JSON.stringify({
      access_token: session.access_token, refresh_token: session.refresh_token,
      expires_in: session.expires_in, expires_at: session.expires_at,
      token_type: session.token_type, user: session.user,
      provider_token: null, provider_refresh_token: null,
    });
    const storageKey = `sb-${PROJECT_REF}-auth-token`;

    // Rota de oficina/P&M → empresa-bot própria + seed idempotente antes de auditar (filas populadas).
    // O robô é PS_ADMIN (isento do gating de área/assinatura), então navega direto sem depender do menu.
    const ehOficina = rota.startsWith('/dashboard/oficina');
    const ehPm = rota.startsWith('/dashboard/pm') || rota === '/dashboard/producao';
    const ehRevenda = rota.startsWith('/dashboard/revenda');
    // vertical → demo por is_demo (item 4 do incidente). Default geral = Demonstração Comércio (GE), NUNCA PS LTDA.
    const empresaAudit = ehOficina ? EMPRESA_BOT_OFICINA : ehPm ? EMPRESA_BOT_PM : ehRevenda ? EMPRESA_BOT_REVENDA : EMPRESA_BOT_GE;
    // RD-69 P1/RD-70: o robô SÓ audita empresa de DEMONSTRAÇÃO (is_demo=true). Rota sem demo da vertical
    // (ex.: genérica que caía na PS LTDA) ⇒ 403 e a rota fica "NÃO AUDITADA" no painel. Fail-closed.
    if (!(await empresaPermitidaParaRobo(supabase, empresaAudit))) {
      return NextResponse.json({ error: MSG_ROBO_SO_DEMO, empresa_id: empresaAudit, rota }, { status: 403 });
    }
    if (ehOficina) {
      await supabase.rpc('fn_gold_oficina_seed_reparar', { p_company_id: EMPRESA_BOT_OFICINA });
    } else if (ehPm) {
      await supabase.rpc('fn_gold_pm_seed_reparar', { p_company_id: EMPRESA_BOT_PM });
    }

    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    browser = await playwright.launch({ args: chromium.args, executablePath, headless: true });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true,
    });

    await context.addInitScript(
      ({ sk, sv, ek, ev }: { sk: string; sv: string; ek: string; ev: string }) => {
        try { window.localStorage.setItem(sk, sv); window.localStorage.setItem(ek, ev); } catch { /* */ }
      },
      { sk: storageKey, sv: sessionPayload, ek: 'ps_empresa_sel', ev: empresaAudit },
    );

    authStatus = 'autenticado';

    for (const botao of botoes as BotaoRow[]) {
      const r = await auditarBotao(
        context, botao, rota, SAAS_BASE_URL, supabase, ANTHROPIC_KEY,
      );
      resultados.push(r);
      custoTotal += r.custo_usd;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'falha geral', detalhe: msg, auth_status: authStatus }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return NextResponse.json({
    rota, screen_id: body.screen_id, auth_status: authStatus,
    botoes_auditados: resultados.length, custo_total_usd: custoTotal, resultados,
  });
}

async function auditarBotao(
  context: import('playwright-core').BrowserContext,
  botao: BotaoRow,
  rota: string,
  baseUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  anthropicKey: string,
) {
  const page: Page = await context.newPage();
  const t0 = Date.now();
  let urlAposClique = '';

  try {
    await page.goto(`${baseUrl}${rota}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(600);
    urlAposClique = page.url();

    if (urlAposClique.includes('/login')) {
      await page.close();
      return await gravarErro(supabase, botao, 'redirected_login', 'Bot caiu em /login');
    }

    const elem = page.locator(botao.botao_selector_css).first();
    const visivel = await elem.isVisible({ timeout: 5000 }).catch(() => false);

    if (!visivel) {
      await page.close();
      // B-correção: botão com precondição declarada + seletor ausente = NÃO TESTÁVEL (o robô não
      // satisfez a precondição, ex.: selecionar planta), não QUEBRADO. Sem precondição, segue vermelho.
      if (botao.precondicao && botao.precondicao.trim()) {
        return await gravarErro(supabase, botao, 'precondicao_nao_satisfeita',
          `precondição não satisfeita pelo robô: ${botao.precondicao.trim()}`, 'nao_testavel');
      }
      return await gravarErro(supabase, botao, 'seletor_nao_visivel', `${botao.botao_label} nao visivel`);
    }

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
      elem.click({ timeout: 5000 }),
    ]);
    await page.waitForTimeout(400);
    urlAposClique = page.url();
  } catch (e: unknown) {
    await page.close();
    const msg = e instanceof Error ? e.message : String(e);
    return await gravarErro(supabase, botao, 'erro_clique', msg);
  }

  const tempoMs = Date.now() - t0;

  // INCIDENTE LGPD 20/09: só fotografa se a empresa RENDERIZADA for a pedida e NÃO estiver em modo grupo.
  const render = await conferirEmpresaRenderizada(page);
  if (!render.ok) {
    await page.close();
    return await gravarErro(supabase, botao, 'empresa_renderizada_diverge', render.motivo || 'render diverge', 'nao_testavel');
  }

  const buffer = await page.screenshot({
    type: 'jpeg', quality: 70, fullPage: false,
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `gold-camada2/${botao.id}/${ts}.jpg`;
  await supabase.storage.from('system-screenshots').upload(path, buffer, {
    contentType: 'image/jpeg', upsert: true,
  });
  // LGPD: bucket system-screenshots é PRIVADO — guarda o PATH (nunca URL pública). O Claude usa o buffer
  // em base64 (abaixo), não a URL; o painel Gold assina sob demanda (PS_ADMIN).
  const screenshotUrl = path;

  const domResumo = await page.evaluate(() => {
    const allText = document.body?.innerText || '';
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      links_total: document.querySelectorAll('a').length,
      botoes_total: document.querySelectorAll('button').length,
      tem_tabela: !!document.querySelector('table'),
      tem_grafico: !!document.querySelector('canvas, svg'),
      valores_brl: (allText.match(/R\$\s*[\d.,]+/g) || []).slice(0, 30),
      possui_empty_state: /Nenhum[ao]?\s+\w+\s+encontrad/.test(allText),
      possui_erro: /erro|error|404|não encontrad/i.test(allText.slice(0, 800)),
    };
  });

  const elementosDetectados: string[] = [];
  if (domResumo.h1) elementosDetectados.push(`h1:${domResumo.h1}`);
  if (domResumo.tem_tabela) elementosDetectados.push('tabela');
  if (domResumo.tem_grafico) elementosDetectados.push('grafico');
  if (domResumo.valores_brl.length) elementosDetectados.push(`${domResumo.valores_brl.length}_valores_brl`);

  let analise: { veredito: string; motivo: string; bloqueado?: boolean; spec_fix_preliminar?: unknown } =
    { veredito: 'BLOQUEADO', motivo: 'Claude falhou' };
  let custoUsd = 0;
  const modelo = modeloPara('auditoria_jornada');

  try {
    const screenshotBase64 = buffer.toString('base64');

    const prompt = `Auditor visual ERP PS Gestao. Apos clicar "${botao.botao_label}" na rota ${rota}.
Destino esperado: ${botao.destino_esperado_rota || rota} (${botao.destino_esperado_descricao || 'mesma tela'})
Destino real: ${urlAposClique}
DOM: ${JSON.stringify(domResumo)}

Veredito em UMA categoria:
- OURO: tela perfeita, dados coerentes
- PRATA: funcional com micro-bugs visuais
- BRONZE: carregou mas problema funcional (KPI errado, lista vazia indevida, R$ 0,00 onde devia ter valor)
- BLOQUEADO: 404, erro, ou quebrada

Responda APENAS JSON sem markdown:
{"veredito":"OURO|PRATA|BRONZE|BLOQUEADO","motivo":"...","bloqueado":false,"spec_fix_preliminar":null}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    const claudeData = await claudeRes.json();
    if (!claudeRes.ok || claudeData.error) {
      await registrarFalhaIA({ endpoint: '/api/gold/auditar-rota', finalidade: 'auditoria_jornada', modelo, status: claudeRes.status, erro: claudeData?.error?.message || 'sem corpo' });
    }
    const usage = claudeData.usage;
    // custo com as taxas do modelo default vivo (claude-sonnet-5): US$2/M entrada, US$10/M saída
    if (usage) custoUsd = (usage.input_tokens * 2 + usage.output_tokens * 10) / 1_000_000;
    const textBlock = (claudeData.content || []).find((c: { type: string }) => c.type === 'text');
    if (textBlock?.text) {
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      analise = JSON.parse(cleaned);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    analise = { veredito: 'BLOQUEADO', motivo: `Claude erro: ${msg}` };
  }

  await page.close();

  const veredito2 = analise.veredito === 'OURO' ? 'verde'
    : analise.veredito === 'PRATA' ? 'amarelo' : 'vermelho';

  await supabase.from('gold_camada2_validacoes').insert({
    botao_id: botao.id,
    destino_real_url: urlAposClique,
    destino_match_esperado: botao.destino_esperado_rota ? urlAposClique.includes(botao.destino_esperado_rota) : true,
    http_status_destino: 200,
    tem_elementos_esperados: analise.veredito === 'OURO' || analise.veredito === 'PRATA',
    elementos_detectados: elementosDetectados,
    tempo_resposta_ms: tempoMs,
    screenshot_url: screenshotUrl,
    claude_analysis_jornada: analise,
    claude_model_used: modelo,
    claude_custo_usd: custoUsd,
    veredito_camada2: veredito2,
    motivo_veredito: analise.motivo || 'sem motivo',
    spec_fix_preliminar: analise.spec_fix_preliminar || null,
    dom_resumo: domResumo,
    playwright_real: true,
    auth_status: 'autenticado',
  });

  return { botao_id: botao.id, veredito: analise.veredito, custo_usd: custoUsd, motivo: analise.motivo || '' };
}

async function gravarErro(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  botao: BotaoRow,
  tipo: string,
  msg: string,
  veredito: 'vermelho' | 'nao_testavel' = 'vermelho',
) {
  await supabase.from('gold_camada2_validacoes').insert({
    botao_id: botao.id,
    veredito_camada2: veredito,
    motivo_veredito: `${tipo}: ${msg}`,
    playwright_real: true,
    auth_status: tipo === 'redirected_login' ? 'redirected_login' : 'autenticado',
    http_status_destino: 0,
    tem_elementos_esperados: false,
    elementos_detectados: [],
    claude_custo_usd: 0,
  });
  // veredito de RETORNO da função (para o resumo): não testável não é bloqueado.
  const vRet = veredito === 'nao_testavel' ? 'NAO_TESTAVEL' : 'BLOQUEADO';
  return { botao_id: botao.id, veredito: vRet, custo_usd: 0, motivo: `${tipo}: ${msg}` };
}
