// =====================================================================
// Edge Function: auditoria-gold-jornada (Fase 3 · Onda G1)
// Playwright real autenticado + Claude vision + veredito por botao
//
// Body: { rota: string, screen_id: string }
// Header: x-watcher-secret = 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
//
// Lê do Vault: AUDITOR_GOLD_EMAIL, AUDITOR_GOLD_PASSWORD, ANTHROPIC_API_KEY
// Lê do env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SAAS_BASE_URL
//
// Contexto: erp_contexto_projeto d3b91a21 (pacto) + 578bee32 (pre-req)
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import chromium from "npm:@sparticuz/chromium-min@131";
import { chromium as playwright } from "npm:playwright-core@1.49";
import Anthropic from "npm:@anthropic-ai/sdk@0.30";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SAAS_BASE_URL = Deno.env.get("SAAS_BASE_URL") || "https://erp-psgestao.vercel.app";
const WATCHER_SECRET = "ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t";
const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

// PS LTDA fixa por enquanto (RD-35 · pode estender depois para multi-empresa)
const EMPRESA_PADRAO_BOT = "b26c19c0-bf6d-495b-b8d1-9fa8d6896725";

// Project ref para storage key Supabase localStorage
const PROJECT_REF = "horsymhsinqcimflrtjo";

interface BotaoCadastrado {
  id: string;
  rota: string;
  botao_label: string;
  botao_selector_css: string;
  destino_esperado_rota: string | null;
  destino_esperado_descricao: string | null;
  prioridade: string | null;
  tipo: string | null;
}

interface ResultadoBotao {
  botao_id: string;
  veredito: 'OURO' | 'PRATA' | 'BRONZE' | 'BLOQUEADO';
  custo_usd: number;
  motivo: string;
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("x-watcher-secret");
  if (authHeader !== WATCHER_SECRET) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  let body: { rota?: string; screen_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  if (!body.rota || !body.screen_id) {
    return jsonResp({ error: "rota e screen_id obrigatorios" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: secrets, error: secretsErr } = await supabase.rpc("fn_gold_get_secrets");

  if (secretsErr) {
    return jsonResp({ error: "rpc secrets erro", detalhe: secretsErr.message }, 500);
  }

  const secretMap = new Map((secrets || []).map((s: { name: string; decrypted_secret: string }) => [s.name, s.decrypted_secret]));
  const AUDITOR_EMAIL = secretMap.get("AUDITOR_GOLD_EMAIL");
  const AUDITOR_PASSWORD = secretMap.get("AUDITOR_GOLD_PASSWORD");
  const ANTHROPIC_KEY = secretMap.get("ANTHROPIC_API_KEY");

  if (!AUDITOR_EMAIL || !AUDITOR_PASSWORD || !ANTHROPIC_KEY) {
    return jsonResp({ error: "secrets vault faltando", encontrados: Array.from(secretMap.keys()) }, 500);
  }

  const { data: botoes, error: botoesErr } = await supabase
    .from("gold_screen_buttons")
    .select("*")
    .eq("rota", body.rota)
    .eq("ativo", true)
    .order("prioridade");

  if (botoesErr) return jsonResp({ error: botoesErr.message }, 500);
  if (!botoes?.length) return jsonResp({ erro: "sem botoes cadastrados", rota: body.rota }, 200);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  let browser;
  const resultados: ResultadoBotao[] = [];
  let custoTotal = 0;
  let authStatus: string = "desconhecido";

  try {
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email: AUDITOR_EMAIL,
      password: AUDITOR_PASSWORD,
    });

    if (signInErr || !signIn?.session) {
      throw new Error(`Falha login bot: ${signInErr?.message || 'sem session'}`);
    }

    const session = signIn.session;
    const sessionPayload = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type,
      user: session.user,
      provider_token: null,
      provider_refresh_token: null,
    });

    const storageKey = `sb-${PROJECT_REF}-auth-token`;

    const execPath = await chromium.executablePath(CHROMIUM_PACK_URL);
    browser = await playwright.launch({
      args: chromium.args,
      executablePath: execPath,
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    await context.addInitScript(
      ({ sessionKey, sessionValue, empresaKey, empresaValue }: { sessionKey: string; sessionValue: string; empresaKey: string; empresaValue: string }) => {
        try {
          window.localStorage.setItem(sessionKey, sessionValue);
          window.localStorage.setItem(empresaKey, empresaValue);
        } catch { /* will set on first navigation */ }
      },
      {
        sessionKey: storageKey,
        sessionValue: sessionPayload,
        empresaKey: "ps_empresa_sel",
        empresaValue: EMPRESA_PADRAO_BOT,
      }
    );

    authStatus = "autenticado";

    for (const botao of botoes as BotaoCadastrado[]) {
      const page = await context.newPage();
      const resultado = await auditarBotao(page, botao, body.rota!, anthropic, supabase);
      resultados.push(resultado);
      custoTotal += resultado.custo_usd;
      await page.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResp({
      error: "falha geral",
      detalhe: msg,
      auth_status: authStatus,
    }, 500);
  } finally {
    if (browser) await browser.close();
  }

  return jsonResp({
    rota: body.rota,
    screen_id: body.screen_id,
    auth_status: authStatus,
    botoes_auditados: resultados.length,
    custo_total_usd: custoTotal,
    resultados,
    instrucao_proxima: "Chame fn_gold_g1_veredito_agregado_rota para resumo agregado",
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function auditarBotao(
  page: any,
  botao: BotaoCadastrado,
  rota: string,
  anthropic: Anthropic,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<ResultadoBotao> {
  const url = `${SAAS_BASE_URL}${rota}`;
  const t0 = Date.now();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
  } catch {
    return await gravarErroBotao(supabase, botao, "timeout_navegacao", "Timeout abrindo rota base");
  }

  const seletor = botao.botao_selector_css;
  let urlAposClique = page.url();

  try {
    const elem = await page.locator(seletor).first();
    const visivel = await elem.isVisible({ timeout: 5000 });

    if (!visivel) {
      return await gravarErroBotao(supabase, botao, "seletor_nao_visivel", `Botão ${botao.botao_label} não está visível na tela`);
    }

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}),
      elem.click({ timeout: 5000 }),
    ]);

    urlAposClique = page.url();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await gravarErroBotao(supabase, botao, "erro_clique", msg);
  }

  const tempoMs = Date.now() - t0;

  const screenshotBuf = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 70 });
  const screenshotBase64 = btoa(String.fromCharCode(...new Uint8Array(screenshotBuf)));

  const screenshotPath = `gold-camada2/${botao.id}/${Date.now()}.jpg`;
  const { data: upload } = await supabase.storage
    .from("system-screenshots")
    .upload(screenshotPath, screenshotBuf, {
      contentType: "image/jpeg",
      upsert: true,
    });

  const screenshotUrl = upload
    ? `${SUPABASE_URL}/storage/v1/object/public/system-screenshots/${screenshotPath}`
    : null;

  const domResumo = await page.evaluate(() => {
    const allText = document.body?.innerText || "";
    return {
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() || null,
      h2_lista: Array.from(document.querySelectorAll("h2")).slice(0, 5).map((h: Element) => h.textContent?.trim()),
      links_total: document.querySelectorAll("a").length,
      botoes_total: document.querySelectorAll("button").length,
      tem_tabela: !!document.querySelector("table"),
      tem_grafico: !!document.querySelector("canvas, svg"),
      valores_brl: (allText.match(/R\$\s*[\d.,]+/g) || []).slice(0, 30),
      possui_empty_state: /Nenhum[ao]?\s+\w+\s+encontrad/.test(allText),
      possui_loading: /carregando|loading/i.test(allText.slice(0, 500)),
      possui_erro: /erro|error|404/i.test(allText.slice(0, 500)),
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let analise: any = { veredito: "BLOQUEADO", motivo: "Claude falhou" };
  let custoUsd = 0;

  try {
    const claudeResp = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 700,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: screenshotBase64,
            },
          },
          {
            type: "text",
            text: buildPrompt(botao, urlAposClique, domResumo),
          },
        ],
      }],
    });

    const tokensIn = claudeResp.usage.input_tokens;
    const tokensOut = claudeResp.usage.output_tokens;
    custoUsd = (tokensIn * 3 + tokensOut * 15) / 1_000_000;

    const textContent = claudeResp.content[0];
    if (textContent.type === "text") {
      const cleaned = textContent.text.replace(/```json|```/g, "").trim();
      analise = JSON.parse(cleaned);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    analise = { veredito: "BLOQUEADO", motivo: `Claude erro: ${msg}` };
  }

  const veredito2 = analise.veredito === "OURO" ? "verde" :
                    analise.veredito === "PRATA" ? "amarelo" : "vermelho";

  await supabase.from("gold_camada2_validacoes").insert({
    botao_id: botao.id,
    destino_real_url: urlAposClique,
    destino_match_esperado: botao.destino_esperado_rota
      ? urlAposClique.includes(botao.destino_esperado_rota)
      : true,
    http_status_destino: 200,
    tem_elementos_esperados: analise.veredito === "OURO" || analise.veredito === "PRATA",
    elementos_detectados: domResumo,
    tempo_resposta_ms: tempoMs,
    screenshot_url: screenshotUrl,
    claude_analysis_jornada: analise,
    claude_model_used: "claude-sonnet-4-20250514",
    claude_custo_usd: custoUsd,
    veredito_camada2: veredito2,
    motivo_veredito: analise.motivo || "sem motivo",
    spec_fix_preliminar: analise.spec_fix_preliminar || null,
    dom_resumo: domResumo,
    playwright_real: true,
    auth_status: "autenticado",
  });

  return {
    botao_id: botao.id,
    veredito: analise.veredito,
    custo_usd: custoUsd,
    motivo: analise.motivo || "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPrompt(botao: BotaoCadastrado, urlReal: string, dom: any): string {
  return `Você é auditor visual do ERP PS Gestão.

Analise esta tela apos clicar no botao "${botao.botao_label}" da rota ${botao.rota}.

Destino esperado: ${botao.destino_esperado_rota || botao.rota} (${botao.destino_esperado_descricao || 'mesma tela'})
Destino real: ${urlReal}

DOM resumido: ${JSON.stringify(dom, null, 2)}

Dê veredito em UMA das categorias:
- OURO: tela carregou perfeitamente, sem bugs, dados reais coerentes
- PRATA: tela funcional mas com micro-bugs visuais (espacamento, label, etc)
- BRONZE: tela carregou mas tem problema funcional (KPI errado, lista vazia indevidamente, valores R$ 0,00 onde devia ter valor, etc)
- BLOQUEADO: tela com 404, erro, ou completamente quebrada

Se BRONZE ou BLOQUEADO, sugira spec_fix_preliminar com:
{
  "arquivo_provavel": "caminho/arquivo.tsx",
  "problema_descrito": "descricao tecnica",
  "diff_conceitual": "o que precisa mudar"
}

Responda APENAS JSON valido sem markdown, neste formato exato:
{"veredito":"OURO|PRATA|BRONZE|BLOQUEADO","motivo":"...","bloqueado":false,"spec_fix_preliminar":null}`;
}

async function gravarErroBotao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  botao: BotaoCadastrado,
  tipo: string,
  msg: string
): Promise<ResultadoBotao> {
  await supabase.from("gold_camada2_validacoes").insert({
    botao_id: botao.id,
    veredito_camada2: "vermelho",
    motivo_veredito: `${tipo}: ${msg}`,
    playwright_real: true,
    auth_status: "autenticado",
    http_status_destino: 0,
    tem_elementos_esperados: false,
    claude_custo_usd: 0,
  });

  return {
    botao_id: botao.id,
    veredito: "BLOQUEADO",
    custo_usd: 0,
    motivo: `${tipo}: ${msg}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
