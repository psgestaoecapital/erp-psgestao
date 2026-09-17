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
//
// 03/09/2026 — CHAMADO É CONVERSA: além da foto do chamado, agora a IA também analisa a foto de uma
// MENSAGEM (quando o autor manda foto nova). Passe mensagem_id no corpo → a análise é gravada NA
// MENSAGEM (fn_sugestao_msg_ia_registrar), não no chamado. O caminho do chamado só olha os anexos SEM
// mensagem_id (mensagem_id IS NULL) — senão a foto de uma resposta viraria "a foto do chamado".

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

function marcacoesTexto(marcacoes: any): string {
  return Array.isArray(marcacoes) && marcacoes.length
    ? marcacoes.map((m: any) => `- ${m.tipo} em (${Math.round((m.x ?? 0) * 100)}%, ${Math.round((m.y ?? 0) * 100)}%): ${m.texto || "(sem texto)"}`).join("\n")
    : "(sem marcações)";
}

// #14/IA-chamados (FALHA 2): a análise das 15:22 do Rodrigo caiu com "Unexpected end of JSON input"
// — o JSON.parse cru estourava quando o modelo devolvia texto com prosa, cercas ou (com max_tokens
// baixo) truncado, e a foto do erro nunca era lida. Este extrator NUNCA lança: tira as cercas, isola
// o primeiro bloco {...} balanceado e tenta parsear; devolve null se não der (aí o chamador re-tenta
// com mais tokens). Truncamento real é tratado subindo max_tokens + 1 retry, não remendando string.
function extrairJson(txt: string | null | undefined): any | null {
  if (!txt || !txt.trim()) return null;
  const s = txt.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const i = s.indexOf("{");
  if (i < 0) return null;
  let depth = 0, end = -1;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  const cand = end >= 0 ? s.slice(i, end + 1) : s.slice(i);
  try { return JSON.parse(cand); } catch { return null; }
}

Deno.serve(async (req: Request) => {
  // preflight CORS do navegador (por causa do header Authorization do invoke)
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const sugestaoId = body.sugestao_id;
  const mensagemId = body.mensagem_id;
  if (!sugestaoId && !mensagemId) {
    return json({ ok: false, erro: "sugestao_id_ou_mensagem_id_obrigatorio" }, 400);
  }
  if (!ANTHROPIC_API_KEY) {
    // sem chave, não bloqueia: a sugestão segue válida, só sem análise
    return json({ ok: false, erro: "sem_api_key", analisada: false });
  }

  // teto diário (§3): acima do teto, não analisa e não bloqueia. Conta chamado + mensagem (uma fonte).
  const { data: gastoHoje } = await supabase.rpc("fn_sugestao_ia_gasto_hoje");
  if (Number(gastoHoje || 0) >= TETO_USD_DIA) {
    return json({ ok: false, erro: "teto_diario_atingido", analisada: false, gasto_hoje: gastoHoje });
  }

  // Resolve o ALVO: uma mensagem (foto nova) ou o chamado (foto original). Monta descrição + anexo.
  let descricao = ""; let categoria: string | null = null; let rota: string | null = null; let area: string | null = null;
  // FALHA 1 (Rodrigo 15:22): a mensagem tinha 2 prints e a função lia só o primeiro (limit 1). Agora
  // lê TODOS os anexos da mensagem/chamado (teto de 5, para não estourar tokens/custo por mensagem).
  const MAX_IMAGENS = 5;
  let anexosLista: { storage_path?: string; marcacoes?: any }[] = [];

  if (mensagemId) {
    const { data: msg } = await supabase.from("sugestao_mensagem").select("id, texto, sugestao_id").eq("id", mensagemId).maybeSingle();
    if (!msg) return json({ ok: false, erro: "mensagem_nao_encontrada" }, 404);
    const { data: sug } = await supabase.from("sugestoes").select("descricao, categoria, rota, area").eq("id", (msg as any).sugestao_id).maybeSingle();
    // a descrição do prompt é a mensagem nova do usuário, com o contexto do chamado
    descricao = `${(sug as any)?.descricao ? `[Chamado] ${(sug as any).descricao}\n` : ""}[Nova mensagem] ${(msg as any).texto || "(sem texto — enviou só a imagem)"}`;
    categoria = (sug as any)?.categoria ?? null; rota = (sug as any)?.rota ?? null; area = (sug as any)?.area ?? null;
    const { data: anexos } = await supabase.from("sugestao_anexo").select("storage_path, marcacoes").eq("mensagem_id", mensagemId).order("ordem").limit(MAX_IMAGENS);
    anexosLista = (anexos || []) as any[];
  } else {
    const { data: sug } = await supabase.from("sugestoes").select("id, descricao, categoria, rota, area").eq("id", sugestaoId).maybeSingle();
    if (!sug) return json({ ok: false, erro: "sugestao_nao_encontrada" }, 404);
    descricao = (sug as any).descricao || ""; categoria = (sug as any).categoria ?? null; rota = (sug as any).rota ?? null; area = (sug as any).area ?? null;
    // só os anexos do CHAMADO (mensagem_id NULL) — a foto de uma resposta não é a foto do chamado
    const { data: anexos } = await supabase.from("sugestao_anexo").select("storage_path, marcacoes").eq("sugestao_id", sugestaoId).is("mensagem_id", null).order("ordem").limit(MAX_IMAGENS);
    anexosLista = (anexos || []) as any[];
  }
  const anexo = anexosLista[0]; // referência p/ o texto de marcações no prompt

  const prompt = `Você é um Engenheiro de Produto Sênior do SaaS PS Gestão ERP. Um usuário registrou uma dificuldade${anexo ? " e enviou uma foto da tela com marcações" : ""}.

DESCRIÇÃO DO USUÁRIO: ${descricao || "(sem descrição)"}
CATEGORIA INFORMADA: ${categoria || "(não informada)"}
ROTA/ÁREA DE ORIGEM: ${rota || "(desconhecida)"} / ${area || "(desconhecida)"}
MARCAÇÕES NA FOTO (coordenadas em % da imagem):
${marcacoesTexto(anexo?.marcacoes)}

TAREFA: responda em JSON válido (apenas o JSON, sem markdown):
{
  "resumo": "<uma linha: o que está errado>",
  "tela_identificada": "<nome da tela>",
  "rota_provavel": "<rota /dashboard/... se der para inferir, senão null>",
  "classificacao": "<bug|melhoria|duvida|erro_dado>",
  "severidade": "<critica|alta|media|baixa>",
  "proximo_passo": "<próximo passo técnico sugerido>",
  "erro_assinatura": "<se houver uma MENSAGEM DE ERRO legível na imagem, devolva-a NORMALIZADA para comparação: o CÓDIGO do erro se existir (ex.: E0370, 42501) OU a frase-chave do erro em minúsculas, SEM ids/timestamps/valores específicos (nomes de tabela/coluna podem ficar). Se NÃO houver erro legível, devolva null. Nunca invente.>"
}
É PALPITE para orientar o atendente — não é decisão. A erro_assinatura serve para saber, mecanicamente, se um erro que reaparece é o MESMO ou MUDOU entre tentativas.`;

  const content: any[] = [];
  for (const ax of anexosLista) {
    if (!ax?.storage_path) continue;
    try {
      const { data: file } = await supabase.storage.from("sugestoes-anexos").download(ax.storage_path);
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const b64 = btoa(buf.reduce((d, byte) => d + String.fromCharCode(byte), ""));
        content.push({ type: "image", source: { type: "base64", media_type: detectMediaType(ax.storage_path), data: b64 } });
      }
    } catch (_) { /* uma imagem que não baixa não derruba a análise das demais */ }
  }
  content.push({ type: "text", text: prompt });

  const modelo = modeloPara("analise_imagem");
  // chama a IA e devolve o JSON já parseado (robusto, nunca lança). max_tokens folgado p/ não truncar
  // com vários prints — foi o truncamento/prosa que fez a análise das 15:22 do Rodrigo se perder.
  async function chamarIA(maxTokens: number): Promise<{ analysis: any; custoUsd: number } | { httpErro: string; status: number }> {
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!claudeResponse.ok) {
      const t = await claudeResponse.text();
      return { httpErro: `${claudeResponse.status}: ${t.slice(0, 200)}`, status: claudeResponse.status };
    }
    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || "";
    const it = claudeData.usage?.input_tokens || 0;
    const ot = claudeData.usage?.output_tokens || 0;
    // custo com as taxas do modelo default vivo (claude-sonnet-5): US$2/M entrada, US$10/M saída
    return { analysis: extrairJson(responseText), custoUsd: (it * 2 / 1_000_000) + (ot * 10 / 1_000_000) };
  }

  let analysis: any = null; let custoUsd = 0;
  try {
    const r = await chamarIA(2000);
    if ("httpErro" in r) {
      await registrarFalhaIA({ endpoint: "sugestao-analisar", finalidade: "analise_imagem", modelo, status: r.status, erro: r.httpErro });
      return json({ ok: false, erro: "claude_api", detalhe: r.httpErro, analisada: false });
    }
    analysis = r.analysis; custoUsd = r.custoUsd;
    // FALHA 2: se o JSON não veio parseável (prosa/truncado/vazio), tenta UMA vez com mais tokens
    // antes de desistir — a análise deixa de se perder em silêncio pela primeira resposta ruim.
    if (!analysis) {
      const r2 = await chamarIA(3000);
      if (!("httpErro" in r2) && r2.analysis) { analysis = r2.analysis; custoUsd += r2.custoUsd; }
    }
    if (!analysis) {
      await registrarFalhaIA({ endpoint: "sugestao-analisar", finalidade: "analise_imagem", modelo, status: null, erro: "resposta_sem_json_parseavel (2 tentativas)" });
      return json({ ok: false, erro: "falha_analise", detalhe: "resposta_sem_json_parseavel", analisada: false });
    }
  } catch (err) {
    // qualquer falha na IA: a sugestão segue válida, só sem análise
    await registrarFalhaIA({ endpoint: "sugestao-analisar", finalidade: "analise_imagem", modelo, status: null, erro: String(err).slice(0, 200) });
    return json({ ok: false, erro: "falha_analise", detalhe: String(err).slice(0, 200), analisada: false });
  }

  // assinatura de erro normalizada (para comparar entre tentativas: mesmo × mudou). null se ilegível.
  const erroAssinatura = typeof analysis?.erro_assinatura === "string" && analysis.erro_assinatura.trim()
    ? analysis.erro_assinatura.trim().slice(0, 300)
    : null;

  // grava no alvo certo: a análise da foto nova fica NA MENSAGEM (com comparação); a do chamado, no chamado.
  if (mensagemId) {
    await supabase.rpc("fn_sugestao_msg_ia_registrar", { p_mensagem_id: mensagemId, p_analise: analysis, p_custo: custoUsd, p_erro_assinatura: erroAssinatura });
  } else {
    await supabase.rpc("fn_sugestao_ia_registrar", { p_id: sugestaoId, p_analise: analysis, p_custo: custoUsd, p_erro_assinatura: erroAssinatura });
  }

  return json({ ok: true, analisada: true, custo_usd: custoUsd, analise: analysis });
});
