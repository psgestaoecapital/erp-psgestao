// Edge Function: insight-auditor v3
// M.A.6 - Product Insight Auditor
// 11/05/2026 - Sessao 8 (otimizada para baseline batch)
// 13/05/2026 - v3: detect media_type por extensao do screenshot_url (JPG/PNG).
//                  PR #113 trocou Playwright para JPEG q=75 mas IA continuava
//                  enviando media_type=image/png, causando 400 da Claude API
//                  e zerando scores desde 11/05.
//
// MUDANCAS v2:
// - Pula telas ja analisadas nas ultimas 6h
// - Modo "baseline": prioriza nunca analisadas

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const WATCHER_SECRET = Deno.env.get("WATCHER_SECRET") || "";

// v3: detecta media_type pela extensao da URL (fallback jpeg pos PR #113).
function detectMediaType(url: string): "image/jpeg" | "image/png" | "image/webp" {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  // .jpg / .jpeg / qualquer outro default (Playwright pos PR #113 gera jpeg)
  return "image/jpeg";
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

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY nao configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const rotaEspecifica = body.rota || null;
  const limit = body.limit || 3;
  const modo = body.modo || "baseline"; // baseline = so nao analisadas

  // Query: telas com screenshot mas SEM analise recente
  let queryBuilder;

  if (rotaEspecifica) {
    queryBuilder = supabase
      .from("system_screens")
      .select("id, rota, area, titulo, screenshot_url, screenshot_atualizado_em")
      .eq("rota", rotaEspecifica)
      .not("screenshot_url", "is", null);
  } else if (modo === "baseline") {
    // Pegar IDs ja analisados nas ultimas 6h
    const { data: jaAnalisados } = await supabase
      .from("system_screens_insights")
      .select("screen_id, analisado_em")
      .gte("analisado_em", new Date(Date.now() - 6 * 3600 * 1000).toISOString());

    const idsExcluir = (jaAnalisados || []).map((r: any) => r.screen_id);

    queryBuilder = supabase
      .from("system_screens")
      .select("id, rota, area, titulo, screenshot_url, screenshot_atualizado_em")
      .not("screenshot_url", "is", null);

    if (idsExcluir.length > 0) {
      queryBuilder = queryBuilder.not("id", "in", `(${idsExcluir.map((i: string) => `"${i}"`).join(",")})`);
    }

    queryBuilder = queryBuilder.limit(limit);
  } else {
    queryBuilder = supabase
      .from("system_screens")
      .select("id, rota, area, titulo, screenshot_url, screenshot_atualizado_em")
      .not("screenshot_url", "is", null)
      .limit(limit);
  }

  const { data: screens, error: screensError } = await queryBuilder;
  if (screensError) {
    return new Response(JSON.stringify({ error: screensError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!screens || screens.length === 0) {
    return new Response(
      JSON.stringify({ message: "Nenhuma tela elegivel para analise", count: 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const resultados = [];

  for (const screen of screens) {
    try {
      const { data: detalhe } = await supabase.rpc("fn_admin_insight_get", {
        p_rota: screen.rota,
      });

      const featuresEsperadas = detalhe?.features_esperadas || [];

      const imageResponse = await fetch(screen.screenshot_url, {
        signal: AbortSignal.timeout(15000),
      });

      if (!imageResponse.ok) {
        resultados.push({ rota: screen.rota, status: "erro", erro: `Imagem download falhou: ${imageResponse.status}` });
        continue;
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = btoa(
        new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      // v3: media_type derivado da URL (jpg apos PR #113, png em legados)
      const mediaType = detectMediaType(screen.screenshot_url);

      const prompt = `Voce e um Engenheiro de Produto Senior analisando uma tela do SaaS PS Gestao ERP.

TELA ANALISADA:
- Rota: ${screen.rota}
- Area: ${screen.area}
- Titulo: ${screen.titulo}

FEATURES ESPERADAS NESTA TELA (do Manual Vivo):
${featuresEsperadas.length > 0 ? featuresEsperadas.map((f: any, i: number) =>
  `${i+1}. ${f.feature_id} - ${f.titulo} (status: ${f.status_atual} ${f.percentual_pronto}%)
     ${f.objetivo_final ? `Objetivo: ${f.objetivo_final}` : ''}
     ${f.elementos_ui_esperados ? `UI esperada: ${JSON.stringify(f.elementos_ui_esperados)}` : ''}`
).join("\n") : "NENHUMA feature mapeada para esta rota ainda. Avalie pela area + titulo + conteudo visual."}

TAREFA: Analise o screenshot e responda em JSON valido (apenas o JSON, sem markdown):

{
  "score_evolucao_pct": <0-100>,
  "score_visual": <0-100>,
  "score_funcional": <0-100>,
  "score_consistencia": <0-100>,
  "elementos_visuais_detectados": [],
  "features_visiveis": [],
  "features_faltando": [],
  "bugs_visuais_detectados": [],
  "inconsistencias_ui_banco": [],
  "bate_com_banco": <true|false>,
  "recomendacoes": [],
  "prioridade_atacar": <"critica"|"alta"|"media"|"baixa"|"nenhuma">,
  "proximo_passo_sugerido": ""
}

REGRAS:
- Score 0 = 404, erro, ou tela inexistente
- Score < 30 = placeholder/mockup sem dados
- Score 30-60 = parcialmente implementada
- Score 60-85 = funcional com pequenos ajustes
- Score 85-100 = pronta ou quase pronta`;

      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: prompt },
            ],
          }],
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        resultados.push({ rota: screen.rota, status: "erro_claude_api", erro: `${claudeResponse.status}: ${errorText.slice(0, 200)}` });
        continue;
      }

      const claudeData = await claudeResponse.json();
      const responseText = claudeData.content?.[0]?.text || "";

      let analysis: any = {};
      try {
        const cleanText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        analysis = JSON.parse(cleanText);
      } catch (err) {
        resultados.push({ rota: screen.rota, status: "parse_erro", raw: responseText.slice(0, 500) });
        continue;
      }

      const inputTokens = claudeData.usage?.input_tokens || 0;
      const outputTokens = claudeData.usage?.output_tokens || 0;
      const custoUsd = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);

      const { error: insertError } = await supabase
        .from("system_screens_insights")
        .insert({
          screen_id: screen.id,
          rota: screen.rota,
          score_evolucao_pct: analysis.score_evolucao_pct ?? 0,
          score_visual: analysis.score_visual ?? null,
          score_funcional: analysis.score_funcional ?? null,
          score_consistencia: analysis.score_consistencia ?? null,
          elementos_visuais_detectados: analysis.elementos_visuais_detectados ?? [],
          features_visiveis: analysis.features_visiveis ?? [],
          features_faltando: analysis.features_faltando ?? [],
          bugs_visuais_detectados: analysis.bugs_visuais_detectados ?? [],
          inconsistencias_ui_banco: analysis.inconsistencias_ui_banco ?? [],
          bate_com_banco: analysis.bate_com_banco ?? null,
          recomendacoes: analysis.recomendacoes ?? [],
          prioridade_atacar: analysis.prioridade_atacar ?? "media",
          proximo_passo_sugerido: analysis.proximo_passo_sugerido ?? null,
          claude_analysis_raw: analysis,
          claude_model_used: "claude-sonnet-4-20250514",
          claude_tokens_input: inputTokens,
          claude_tokens_output: outputTokens,
          claude_custo_usd: custoUsd,
          screenshot_url_analisado: screen.screenshot_url,
          screenshot_capturado_em: screen.screenshot_atualizado_em,
          analisador: "insight-auditor-edge-fn-v3",
        });

      if (insertError) {
        resultados.push({ rota: screen.rota, status: "insert_erro", erro: insertError.message });
      } else {
        resultados.push({
          rota: screen.rota,
          status: "sucesso",
          score: analysis.score_evolucao_pct,
          prioridade: analysis.prioridade_atacar,
        });
      }
    } catch (err) {
      resultados.push({ rota: screen.rota, status: "exception", erro: String(err).slice(0, 300) });
    }
  }

  return new Response(
    JSON.stringify({
      executed_at: new Date().toISOString(),
      total: resultados.length,
      sucesso: resultados.filter((r) => r.status === "sucesso").length,
      erros: resultados.filter((r) => r.status !== "sucesso").length,
      resultados,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } }
  );
});
