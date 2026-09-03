// Edge Function: sugestao-analisar
// Central de Melhorias · Fase 1. Espelha o padrão do insight-auditor (Claude com imagem), mas
// aponta para a FOTO DO USUÁRIO (bucket privado sugestoes-anexos) + a descrição + as marcações.
// Devolve: resumo em 1 linha, tela/rota, classificação, severidade, próximo passo.
//
// Regras (SPEC §3): análise é SUGESTÃO, nunca decisão — gravada em ia_analise, separada da resposta
// do atendente. Teto diário USD 5 (padrão Gold): acima do teto, NÃO chama a IA e NÃO bloqueia o
// registro. Falha da IA nunca invalida a sugestão.
//
// 03/09/2026 — FIX CORS (bug silencioso da 1ª melhoria real do CEO): a tela chama esta função pelo
// NAVEGADOR (supabase.functions.invoke). Por causa do header Authorization, o browser manda um
// PREFLIGHT OPTIONS antes do POST. A função não tratava OPTIONS: o preflight caía no corpo, não achava
// sugestao_id e voltava 400 SEM headers CORS → o navegador BLOQUEAVA o POST. Resultado: a IA nunca era
// chamada de verdade, e como a função real não rodava, nem o erp_ia_falha registrava (o caso ia_parada
// dentro da própria Central). Correção: tratar OPTIONS e devolver headers CORS em TODA resposta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { modeloPara, registrarFalhaIA } from "../_shared/aiModel.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const TETO_USD_DIA = Number(Deno.env.get("SUGESTAO_IA_TETO_USD") || "5");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// json(): toda resposta leva os headers CORS — senão o navegador bloqueia mesmo um 200.
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function detectMediaType(path: string): "image/jpeg" | "image/png" | "image/webp" {
  const lower = path.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

Deno.serve(async (req: Request) => {
  // preflight CORS do navegador (por causa do header Authorization do invoke)
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const sugestaoId = body.sugestao_id;
  if (!sugestaoId) {
    return json({ ok: false, erro: "sugestao_id_obrigatorio" }, 400);
  }
  if (!ANTHROPIC_API_KEY) {
    // sem chave, não bloqueia: a sugestão segue válida, só sem análise
    return json({ ok: false, erro: "sem_api_key", analisada: false });
  }

  // teto diário (§3): acima do teto, não analisa e não bloqueia
  const { data: gastoHoje } = await supabase.rpc("fn_sugestao_ia_gasto_hoje");
  if (Number(gastoHoje || 0) >= TETO_USD_DIA) {
    return json({ ok: false, erro: "teto_diario_atingido", analisada: false, gasto_hoje: gastoHoje });
  }

  // carrega a sugestão + primeiro anexo
  const { data: sug } = await supabase.from("sugestoes").select("id, descricao, categoria, rota, area").eq("id", sugestaoId).maybeSingle();
  if (!sug) {
    return json({ ok: false, erro: "sugestao_nao_encontrada" }, 404);
  }
  const { data: anexos } = await supabase.from("sugestao_anexo").select("storage_path, marcacoes").eq("sugestao_id", sugestaoId).order("ordem").limit(1);
  const anexo = (anexos || [])[0];

  // monta o content da mensagem: texto sempre; imagem quando houver foto
  const marcacoesTxt = anexo?.marcacoes && Array.isArray(anexo.marcacoes) && anexo.marcacoes.length
    ? anexo.marcacoes.map((m: any) => `- ${m.tipo} em (${Math.round((m.x ?? 0) * 100)}%, ${Math.round((m.y ?? 0) * 100)}%): ${m.texto || "(sem texto)"}`).join("\n")
    : "(sem marcações)";

  const prompt = `Você é um Engenheiro de Produto Sênior do SaaS PS Gestão ERP. Um usuário registrou uma dificuldade${anexo ? " e enviou uma foto da tela com marcações" : ""}.

DESCRIÇÃO DO USUÁRIO: ${sug.descricao || "(sem descrição)"}
CATEGORIA INFORMADA: ${sug.categoria || "(não informada)"}
ROTA/ÁREA DE ORIGEM: ${sug.rota || "(desconhecida)"} / ${sug.area || "(desconhecida)"}
MARCAÇÕES NA FOTO (coordenadas em % da imagem):
${marcacoesTxt}

TAREFA: responda em JSON válido (apenas o JSON, sem markdown):
{
  "resumo": "<uma linha: o que está errado>",
  "tela_identificada": "<nome da tela>",
  "rota_provavel": "<rota /dashboard/... se der para inferir, senão null>",
  "classificacao": "<bug|melhoria|duvida|erro_dado>",
  "severidade": "<critica|alta|media|baixa>",
  "proximo_passo": "<próximo passo técnico sugerido>"
}
É PALPITE para orientar o atendente — não é decisão.`;

  const content: any[] = [];
  if (anexo?.storage_path) {
    try {
      const { data: file } = await supabase.storage.from("sugestoes-anexos").download(anexo.storage_path);
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const b64 = btoa(buf.reduce((d, byte) => d + String.fromCharCode(byte), ""));
        content.push({ type: "image", source: { type: "base64", media_type: detectMediaType(anexo.storage_path), data: b64 } });
      }
    } catch (_) { /* sem imagem: segue só com texto */ }
  }
  content.push({ type: "text", text: prompt });

  let analysis: any = null; let custoUsd = 0;
  const modelo = modeloPara("analise_imagem");
  try {
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo, max_tokens: 1000, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!claudeResponse.ok) {
      const t = await claudeResponse.text();
      await registrarFalhaIA({ endpoint: "sugestao-analisar", finalidade: "analise_imagem", modelo, status: claudeResponse.status, erro: `${claudeResponse.status}: ${t.slice(0, 200)}` });
      return json({ ok: false, erro: "claude_api", detalhe: `${claudeResponse.status}: ${t.slice(0, 200)}`, analisada: false });
    }
    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || "";
    const cleanText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    analysis = JSON.parse(cleanText);
    const it = claudeData.usage?.input_tokens || 0;
    const ot = claudeData.usage?.output_tokens || 0;
    // custo com as taxas do modelo default vivo (claude-sonnet-5): US$2/M entrada, US$10/M saída
    custoUsd = (it * 2 / 1_000_000) + (ot * 10 / 1_000_000);
  } catch (err) {
    // qualquer falha na IA: a sugestão segue válida, só sem análise
    await registrarFalhaIA({ endpoint: "sugestao-analisar", finalidade: "analise_imagem", modelo, status: null, erro: String(err).slice(0, 200) });
    return json({ ok: false, erro: "falha_analise", detalhe: String(err).slice(0, 200), analisada: false });
  }

  await supabase.rpc("fn_sugestao_ia_registrar", { p_id: sugestaoId, p_analise: analysis, p_custo: custoUsd });

  return json({ ok: true, analisada: true, custo_usd: custoUsd, analise: analysis });
});
