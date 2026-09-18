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
//
// 18/09/2026 - v4 (item A): injeta o BLUEPRINT (Documento Mestre Vivo, erp_documento_vertical vigente)
//   da vertical da tela no prompt como baliza, e GRAVA contra qual versao/md5 comparou
//   (blueprint_vertical/versao/md5). §3.0: a vertical pode ser uma CASCA — features faltando sao
//   ESPERADAS e devem ser listadas. Mapa area->vertical: hub_construcao -> hub.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { modeloPara, registrarFalhaIA } from "../_shared/aiModel.ts";

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
  const modelo = modeloPara("auditoria_tela");

  // Item A — BLUEPRINT como baliza. Cada área do produto tem um Documento Mestre Vivo
  // (erp_documento_vertical). O auditor injeta o blueprint VIGENTE da vertical da tela no prompt e
  // GRAVA contra qual versão comparou (senão o veredito vira arqueologia quando o doc mudar — RD/foto
  // velha). Mapa área→vertical (explícito; cresce conforme outras verticais ganham blueprint).
  const AREA_TO_VERTICAL: Record<string, string> = {
    hub_construcao: "hub",
  };
  // carrega todos os blueprints vigentes de uma vez: vertical → { versao, md5, conteudo }.
  // O md5 vem do Postgres (md5(conteudo_md)) — a MESMA prova que o CEO valida (V10 = 99537aa6...).
  const blueprints: Record<string, { versao: number; md5: string; conteudo: string }> = {};
  {
    const { data: docs } = await supabase.rpc("fn_documentos_vigentes_md5");
    for (const d of (docs || []) as any[]) {
      blueprints[d.vertical] = { versao: d.versao, md5: d.md5, conteudo: d.conteudo_md || "" };
    }
  }

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

      // Item A — blueprint da vertical desta tela (baliza). NULL se a área não tem blueprint mapeado.
      const verticalTela = AREA_TO_VERTICAL[screen.area as string] || null;
      const bp = verticalTela ? blueprints[verticalTela] : undefined;
      const blueprintBloco = bp
        ? `\n\nBLUEPRINT DA VERTICAL "${verticalTela}" — DOCUMENTO MESTRE VIVO (versao ${bp.versao}, md5 ${bp.md5}):\nEsta e a BALIZA do que a vertical deve ser. ATENCAO (§3.0): esta vertical ainda e uma CASCA em construcao — e ESPERADO que muita coisa do blueprint ainda NAO esteja na tela. Liste o que o blueprint promete e ainda nao aparece em features_faltando (isso NAO e ruido, e o mapa do que falta). Compare a tela com a INTENCAO do blueprint, nao invente o que nao esta escrito nele.\n--- INICIO DO BLUEPRINT ---\n${bp.conteudo}\n--- FIM DO BLUEPRINT ---`
        : "";

      const prompt = `Voce e um Engenheiro de Produto Senior analisando uma tela do SaaS PS Gestao ERP.

TELA ANALISADA:
- Rota: ${screen.rota}
- Area: ${screen.area}
- Titulo: ${screen.titulo}${blueprintBloco}

FEATURES ESPERADAS NESTA TELA (do Manual Vivo):
${featuresEsperadas.length > 0 ? featuresEsperadas.map((f: any, i: number) =>
  `${i+1}. ${f.feature_id} - ${f.titulo} (status: ${f.status_atual}${f.percentual_pronto != null ? ` ${f.percentual_pronto}%` : ` — nao medido`})
     ${f.objetivo_final ? `Objetivo: ${f.objetivo_final}` : ''}
     ${f.elementos_ui_esperados ? `UI esperada: ${JSON.stringify(f.elementos_ui_esperados)}` : ''}`
).join("\n") : "NENHUMA feature mapeada para esta rota ainda. Avalie pela area + titulo + conteudo visual."}

TAREFA: Analise o screenshot e registre a analise chamando a ferramenta registrar_auditoria.

REGRAS DE SCORE:
- Score 0 = 404, erro, ou tela inexistente
- Score < 30 = placeholder/mockup sem dados
- Score 30-60 = parcialmente implementada
- Score 60-85 = funcional com pequenos ajustes
- Score 85-100 = pronta ou quase pronta`;

      // 18/09/2026 (item A) — FORCED TOOL USE: o auditor caia em parse_erro (raw vazio/prosa) com
      // claude-sonnet-5 e "nao devolvia nada". Forcando a ferramenta, a analise volta estruturada
      // (tool_use.input), deterministica, sem parsing de string. (prefill nao serve: sonnet-5 recusa.)
      const AUDIT_TOOL = "registrar_auditoria";
      const auditToolSchema = {
        name: AUDIT_TOOL,
        description: "Registra a auditoria visual/funcional da tela.",
        input_schema: {
          type: "object",
          properties: {
            score_evolucao_pct: { type: "integer", minimum: 0, maximum: 100 },
            score_visual: { type: "integer", minimum: 0, maximum: 100 },
            score_funcional: { type: "integer", minimum: 0, maximum: 100 },
            score_consistencia: { type: "integer", minimum: 0, maximum: 100 },
            elementos_visuais_detectados: { type: "array", items: { type: "string" } },
            features_visiveis: { type: "array", items: { type: "string" } },
            features_faltando: { type: "array", items: { type: "string" } },
            bugs_visuais_detectados: { type: "array", items: { type: "string" } },
            inconsistencias_ui_banco: { type: "array", items: { type: "string" } },
            bate_com_banco: { type: "boolean" },
            recomendacoes: { type: "array", items: { type: "string" } },
            prioridade_atacar: { type: "string", enum: ["critica", "alta", "media", "baixa", "nenhuma"] },
            proximo_passo_sugerido: { type: "string" },
          },
          required: ["score_evolucao_pct", "prioridade_atacar", "proximo_passo_sugerido"],
        },
      };

      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 2500,
          tools: [auditToolSchema],
          tool_choice: { type: "tool", name: AUDIT_TOOL },
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
        await registrarFalhaIA({ endpoint: "insight-auditor", finalidade: "auditoria_tela", modelo, status: claudeResponse.status, erro: `${claudeResponse.status}: ${errorText.slice(0, 200)}` });
        resultados.push({ rota: screen.rota, status: "erro_claude_api", erro: `${claudeResponse.status}: ${errorText.slice(0, 200)}` });
        continue;
      }

      const claudeData = await claudeResponse.json();
      const blocks = Array.isArray(claudeData.content) ? claudeData.content : [];
      const toolBlock = blocks.find((b: any) => b?.type === "tool_use" && b?.name === AUDIT_TOOL);
      let analysis: any = (toolBlock?.input && typeof toolBlock.input === "object") ? toolBlock.input : null;
      if (!analysis) {
        // fallback: se por acaso vier texto, tenta extrair; senao registra o que veio (nunca em silencio)
        const textBlock = blocks.find((b: any) => b?.type === "text");
        try { analysis = JSON.parse((textBlock?.text || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); } catch { analysis = null; }
        if (!analysis) {
          const raw = (textBlock?.text || JSON.stringify(blocks)).slice(0, 300);
          await registrarFalhaIA({ endpoint: "insight-auditor", finalidade: "auditoria_tela", modelo, status: null, erro: `sem_tool_use :: ${raw}` });
          resultados.push({ rota: screen.rota, status: "parse_erro", raw });
          continue;
        }
      }

      const inputTokens = claudeData.usage?.input_tokens || 0;
      const outputTokens = claudeData.usage?.output_tokens || 0;
      // custo com as taxas do modelo default vivo (claude-sonnet-5): US$2/M entrada, US$10/M saída
      const custoUsd = (inputTokens * 2 / 1_000_000) + (outputTokens * 10 / 1_000_000);

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
          claude_model_used: modelo,
          claude_tokens_input: inputTokens,
          claude_tokens_output: outputTokens,
          claude_custo_usd: custoUsd,
          screenshot_url_analisado: screen.screenshot_url,
          screenshot_capturado_em: screen.screenshot_atualizado_em,
          // Item A — carimba QUAL blueprint (vertical+versao+md5) foi a baliza desta análise.
          blueprint_vertical: verticalTela,
          blueprint_versao: bp?.versao ?? null,
          blueprint_md5: bp?.md5 ?? null,
          analisador: "insight-auditor-edge-fn-v4",
        });

      if (insertError) {
        resultados.push({ rota: screen.rota, status: "insert_erro", erro: insertError.message });
      } else {
        resultados.push({
          rota: screen.rota,
          status: "sucesso",
          score: analysis.score_evolucao_pct,
          prioridade: analysis.prioridade_atacar,
          // Item A — o resultado diz contra QUAL versão do blueprint comparou (ou null se sem baliza).
          blueprint: bp ? `${verticalTela} v${bp.versao} (${bp.md5.slice(0, 8)})` : null,
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
