// Edge Function: auditoria-gold-jornada
// AUDITORIA GOLD FASE 2 · Camada 2 (stub HTTP)
// Criado 25/05/2026 (CEO autorizou decisão Opção B em 22:55 BRT)
//
// LIMITAÇÃO ARQUITETURAL ACEITA E DOCUMENTADA:
// Supabase Edge Functions rodam Deno serverless sem browser headless.
// Esta versão faz fetch HTTP simples em cada destino_esperado_rota dos
// botões cadastrados em gold_screen_buttons. Detecta ~80% dos 404
// estruturais que existem hoje em produção (Stephany não precisa mais
// ser testadora).
//
// O QUE NÃO FAZ (vira FASE 3 com browser cloud externo):
// - Cliques reais nos botões
// - Captura de JavaScript errors
// - Validação visual de renderização SPA
// - Análise Claude API com screenshot
//
// O QUE FAZ:
// - Lê gold_screen_buttons WHERE rota=? AND ativo=TRUE
// - Para cada botão: GET no APP_URL + destino_esperado_rota
// - Mapeia HTTP status → veredito_camada2
// - Persiste em gold_camada2_validacoes (botao_id, destino_real_url,
//   http_status_destino, tempo_resposta_ms, veredito, motivo)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("SAAS_BASE_URL") || "https://erp-psgestao.vercel.app";
const WATCHER_SECRET = Deno.env.get("WATCHER_SECRET") || "";
const FETCH_TIMEOUT_MS = 15_000;
const STUB_MOTIVO = "Stub HTTP · FASE 3 trará Playwright real com cliques";

type BotaoRow = {
  id: string;
  rota: string;
  botao_label: string;
  botao_selector_css: string;
  destino_esperado_rota: string | null;
  destino_esperado_descricao: string | null;
  prioridade: string;
  tipo: string;
};

type Resultado = {
  botao_id: string;
  destino_real_url: string | null;
  destino_match_esperado: boolean;
  http_status_destino: number | null;
  tem_elementos_esperados: boolean | null;
  tempo_resposta_ms: number;
  veredito_camada2: "verde" | "amarelo" | "vermelho" | "pendente";
  motivo_veredito: string;
};

function classificarStatus(
  status: number | null,
  destinoEsperado: string | null,
  destinoReal: string | null,
): { veredito: Resultado["veredito_camada2"]; motivo: string; match: boolean } {
  if (status === null) {
    return { veredito: "vermelho", motivo: "timeout ou erro de rede", match: false };
  }
  if (status === 404) {
    return { veredito: "vermelho", motivo: `destino retorna 404 (${destinoEsperado})`, match: false };
  }
  if (status >= 500) {
    return { veredito: "vermelho", motivo: `erro servidor HTTP ${status}`, match: false };
  }
  if (status >= 400) {
    return { veredito: "amarelo", motivo: `HTTP ${status} (cliente)`, match: false };
  }
  const match = destinoEsperado
    ? (destinoReal?.startsWith(destinoEsperado) ?? false)
    : true;
  if (!match) {
    return {
      veredito: "amarelo",
      motivo: `destino real (${destinoReal}) nao casa com esperado (${destinoEsperado})`,
      match: false,
    };
  }
  return { veredito: "verde", motivo: `HTTP ${status} OK · ${STUB_MOTIVO}`, match: true };
}

async function testarBotao(botao: BotaoRow): Promise<Resultado> {
  const t0 = Date.now();
  const destinoEsperado = botao.destino_esperado_rota;
  const base: Resultado = {
    botao_id: botao.id,
    destino_real_url: null,
    destino_match_esperado: false,
    http_status_destino: null,
    tem_elementos_esperados: null,
    tempo_resposta_ms: 0,
    veredito_camada2: "pendente",
    motivo_veredito: "",
  };

  if (!destinoEsperado) {
    base.veredito_camada2 = "amarelo";
    base.motivo_veredito = "botao sem destino_esperado_rota cadastrado · stub HTTP nao consegue inferir";
    base.tempo_resposta_ms = Date.now() - t0;
    return base;
  }

  const url = `${APP_URL}${destinoEsperado}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "PS-Auditoria-Gold/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const finalUrl = new URL(resp.url).pathname;
    base.destino_real_url = finalUrl;
    base.http_status_destino = resp.status;

    const decision = classificarStatus(resp.status, destinoEsperado, finalUrl);
    base.veredito_camada2 = decision.veredito;
    base.motivo_veredito = decision.motivo;
    base.destino_match_esperado = decision.match;
  } catch (err) {
    base.veredito_camada2 = "vermelho";
    base.motivo_veredito = `erro fetch: ${String(err).slice(0, 200)}`;
  }

  base.tempo_resposta_ms = Date.now() - t0;
  return base;
}

Deno.serve(async (req: Request) => {
  if (WATCHER_SECRET) {
    const auth = req.headers.get("x-watcher-secret");
    if (auth !== WATCHER_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: { rota?: string; screen_id?: string } = {};
  try { body = await req.json(); } catch { /* body vazio */ }

  const rota = body.rota;
  const screenId = body.screen_id ?? null;

  if (!rota) {
    return new Response(JSON.stringify({ error: "rota obrigatoria no body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: botoes, error: errBotoes } = await supabase
    .from("gold_screen_buttons")
    .select("id, rota, botao_label, botao_selector_css, destino_esperado_rota, destino_esperado_descricao, prioridade, tipo")
    .eq("rota", rota)
    .eq("ativo", true)
    .order("prioridade");

  if (errBotoes) {
    return new Response(JSON.stringify({ error: errBotoes.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!botoes || botoes.length === 0) {
    return new Response(JSON.stringify({
      aviso: "Nenhum botao cadastrado pra essa rota em gold_screen_buttons",
      rota,
      screen_id: screenId,
      botoes_testados: 0,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const resultados: Resultado[] = [];
  for (const botao of botoes as BotaoRow[]) {
    const r = await testarBotao(botao);
    resultados.push(r);

    const { error: errIns } = await supabase
      .from("gold_camada2_validacoes")
      .insert({
        botao_id: r.botao_id,
        destino_real_url: r.destino_real_url,
        destino_match_esperado: r.destino_match_esperado,
        http_status_destino: r.http_status_destino,
        tem_elementos_esperados: r.tem_elementos_esperados,
        tempo_resposta_ms: r.tempo_resposta_ms,
        claude_model_used: null,
        claude_custo_usd: 0,
        veredito_camada2: r.veredito_camada2,
        motivo_veredito: r.motivo_veredito,
      });

    if (errIns) {
      console.error("Erro insert gold_camada2_validacoes:", errIns.message);
    }
  }

  const distribuicao = {
    verde: resultados.filter((r) => r.veredito_camada2 === "verde").length,
    amarelo: resultados.filter((r) => r.veredito_camada2 === "amarelo").length,
    vermelho: resultados.filter((r) => r.veredito_camada2 === "vermelho").length,
    pendente: resultados.filter((r) => r.veredito_camada2 === "pendente").length,
  };

  return new Response(JSON.stringify({
    rota,
    screen_id: screenId,
    botoes_testados: botoes.length,
    distribuicao,
    resultados,
    nota: STUB_MOTIVO,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
