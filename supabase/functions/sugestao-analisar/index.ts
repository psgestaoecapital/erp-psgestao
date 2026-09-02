// Edge Function: sugestao-analisar
// Central de Melhorias · Fase 1. Espelha o padrão do insight-auditor (Claude com imagem), mas
// aponta para a FOTO DO USUÁRIO (bucket privado sugestoes-anexos) + a descrição + as marcações.
// Devolve: resumo em 1 linha, tela/rota, classificação, severidade, próximo passo.
//
// Regras (SPEC §3): análise é SUGESTÃO, nunca decisão — gravada em ia_analise, separada da resposta
// do atendente. Teto diário USD 5 (padrão Gold): acima do teto, NÃO chama a IA e NÃO bloqueia o
// registro. Falha da IA nunca invalida a sugestão.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const TETO_USD_DIA = Number(Deno.env.get("SUGESTAO_IA_TETO_USD") || "5");

function detectMediaType(path: string): "image/jpeg" | "image/png" | "image/webp" {
  const lower = path.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const sugestaoId = body.sugestao_id;
  if (!sugestaoId) {
    return new Response(JSON.stringify({ ok: false, erro: "sugestao_id_obrigatorio" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!ANTHROPIC_API_KEY) {
    // sem chave, não bloqueia: a sugestão segue válida, só sem análise
    return new Response(JSON.stringify({ ok: false, erro: "sem_api_key", analisada: false }), { headers: { "Content-Type": "application/json" } });
  }

  // teto diário (§3): acima do teto, não analisa e não bloqueia
  const { data: gastoHoje } = await supabase.rpc("fn_sugestao_ia_gasto_hoje");
  if (Number(gastoHoje || 0) >= TETO_USD_DIA) {
    return new Response(JSON.stringify({ ok: false, erro: "teto_diario_atingido", analisada: false, gasto_hoje: gastoHoje }), { headers: { "Content-Type": "application/json" } });
  }

  // carrega a sugestão + primeiro anexo
  const { data: sug } = await supabase.from("sugestoes").select("id, descricao, categoria, rota, area").eq("id", sugestaoId).maybeSingle();
  if (!sug) {
    return new Response(JSON.stringify({ ok: false, erro: "sugestao_nao_encontrada" }), { status: 404, headers: { "Content-Type": "application/json" } });
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
  try {
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1000, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!claudeResponse.ok) {
      const t = await claudeResponse.text();
      return new Response(JSON.stringify({ ok: false, erro: "claude_api", detalhe: `${claudeResponse.status}: ${t.slice(0, 200)}`, analisada: false }), { headers: { "Content-Type": "application/json" } });
    }
    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || "";
    const cleanText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    analysis = JSON.parse(cleanText);
    const it = claudeData.usage?.input_tokens || 0;
    const ot = claudeData.usage?.output_tokens || 0;
    custoUsd = (it * 2 / 1_000_000) + (ot * 10 / 1_000_000);  // claude-sonnet-5: $2/M in, $10/M out
  } catch (err) {
    // qualquer falha na IA: a sugestão segue válida, só sem análise
    return new Response(JSON.stringify({ ok: false, erro: "falha_analise", detalhe: String(err).slice(0, 200), analisada: false }), { headers: { "Content-Type": "application/json" } });
  }

  await supabase.rpc("fn_sugestao_ia_registrar", { p_id: sugestaoId, p_analise: analysis, p_custo: custoUsd });

  return new Response(JSON.stringify({ ok: true, analisada: true, custo_usd: custoUsd, analise: analysis }), { headers: { "Content-Type": "application/json" } });
});
