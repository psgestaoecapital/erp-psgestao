// Edge Function: sugestao-redigir
// Redação de RASCUNHO de resposta ao cliente para o chamado (#7050 INVIOLÁVEL).
//
// O que faz: lê o chamado (título/descrição) + o título da PR vinculada (o que foi entregue), pede à IA
// um rascunho em português e grava SOMENTE o rascunho: resposta preenchida, resposta_aprovada = false,
// resposta_origem = 'assistente', resposta_redigida_por = NULL. Não cria notificação e não envia e-mail.
// Quem envia ao cliente é fn_sugestao_aprovar_resposta, que só um sócio/PS_ADMIN consegue chamar.
//
// Custo: passa pelo mesmo guarda do aiGuardedCall — controle global (anthropic_budget_control), teto por
// empresa (fn_ia_empresa_pode_gastar) e teto global (fn_budget_pode_executar). Gasto registrado nos dois.
//
// Acesso: header x-redigir-token cujo SHA-256 bate com TOKEN_SHA256 (token de operação, só o hash no código).
// Sem ele, 401. Não usa o segredo do robô de tela (screen-watcher).
//
// Corpo: { ids?: string[], limite?: number (padrão 30, máx 50), dry?: boolean }
//   - ids: chamados específicos. Sem ids: os chamados aguardando_confirmacao, sem resposta, de empresa
//     que NÃO é demo, com PR vinculada.
//   - dry: não chama a IA nem grava; só lista o que faria.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { modeloPara, registrarFalhaIA, iaBudgetStatus } from "../_shared/aiModel.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
// Hash SHA-256 do token de operação (o token em si não fica no código). Sem o token, 401.
const TOKEN_SHA256 = "47aa19d2e5cec565c44af8b2947e2b5150b91bf983f6bcdfe746a83da01e573e";
const FEATURE = "chamado_resposta_ia";
const CUSTO_ESTIMADO_USD = 0.02; // teto de referência por rascunho (saída curta, modelo default)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-redigir-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const TOOL = "registrar_rascunho";
const toolSchema = {
  name: TOOL,
  description: "Registra o rascunho da resposta ao cliente para revisão do sócio.",
  input_schema: {
    type: "object",
    properties: {
      resposta: { type: "string", description: "Texto da resposta ao cliente, em português, claro e cordial, sem jargão interno." },
    },
    required: ["resposta"],
  },
};

function montarPrompt(c: any): string {
  return `Você redige o RASCUNHO de uma resposta do suporte da PS Gestão ao cliente, sobre um chamado já resolvido por uma entrega (PR).
Regras:
- Português do Brasil, tom cordial e direto, 3 a 6 frases.
- Diga o que foi feito e o que o cliente passa a ver/poder fazer. Use só o que está nos dados abaixo; não invente prazos nem detalhes técnicos.
- Não mencione número de PR, nomes de arquivos, tabelas, funções ou sistemas de terceiros.
- Termine pedindo que o cliente confirme se resolveu.

EMPRESA: ${c.empresa || "(não informada)"}
CHAMADO #${c.numero}: ${c.titulo || "(sem título)"}
DESCRIÇÃO DO CLIENTE: ${(c.descricao || "(sem descrição)").slice(0, 1500)}
ENTREGA (título da PR que resolveu): ${c.pr_titulo || "(sem título de entrega registrado — escreva de forma genérica: a equipe concluiu a melhoria)"}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Autorização: token de operação (hash no código) OU nonce de uso único gravado no banco e consumido
  // por RPC (caminho server-side via net.http_post; o nonce nunca trafega em texto no código do cliente).
  const tokenHeader = req.headers.get("x-redigir-token") || "";
  const nonceHeader = req.headers.get("x-redigir-nonce") || "";
  let autorizado = false;
  if (tokenHeader) {
    const hashRecebido = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tokenHeader))))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    autorizado = hashRecebido === TOKEN_SHA256;
  }
  if (!autorizado && nonceHeader) {
    const { data: ok } = await sb.rpc("fn_redigir_nonce_consumir", { p_nonce: nonceHeader });
    autorizado = ok === true;
  }
  if (!autorizado) return json({ ok: false, erro: "nao_autorizado" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const dry = body.dry === true;
  const limite = Math.min(Math.max(Number(body.limite) || 30, 1), 50);

  // Alvos: ids explícitos OU a fila padrão (aguardando confirmação, sem resposta, não-demo, com PR).
  let q = sb.from("sugestoes")
    .select("id, numero, titulo, descricao, pr_numero, company_id, resposta, status")
    .eq("status", "aguardando_confirmacao")
    .or("resposta.is.null,resposta.eq.")
    .not("pr_numero", "is", null)
    .order("numero", { ascending: true })
    .limit(limite);
  if (Array.isArray(body.ids) && body.ids.length) q = sb.from("sugestoes")
    .select("id, numero, titulo, descricao, pr_numero, company_id, resposta, status")
    .in("id", body.ids).limit(limite);
  const { data: alvos, error: errA } = await q;
  if (errA) return json({ ok: false, erro: "consulta_falhou", detalhe: errA.message }, 500);

  const prs = [...new Set((alvos || []).map((a: any) => a.pr_numero).filter((n: any) => n != null))];
  const { data: ents } = prs.length
    ? await sb.from("erp_dev_entrega").select("pr_numero, titulo, ocorrido_em").in("pr_numero", prs).order("ocorrido_em", { ascending: false })
    : { data: [] as any[] };
  const prTitulo = new Map<number, string>();
  for (const e of (ents || []) as any[]) if (e.titulo && !prTitulo.has(e.pr_numero)) prTitulo.set(e.pr_numero, e.titulo);

  const companyIds = [...new Set((alvos || []).map((a: any) => a.company_id).filter(Boolean))];
  const { data: emp } = await sb.from("companies").select("id, nome_fantasia, razao_social, is_demo").in("id", companyIds);
  const empMap = new Map((emp || []).map((e: any) => [e.id, e]));

  const resultado = { total: 0, redigidos: 0, pulados: [] as any[], pausado: null as string | null, custo_usd: 0 };
  const iaOff = await iaBudgetStatus();
  if (iaOff.bloqueado && !dry) { resultado.pausado = iaOff.motivo; return json({ ok: false, ...resultado }, 503); }

  for (const a of (alvos || []) as any[]) {
    const emprs: any = empMap.get(a.company_id) || {};
    if (emprs.is_demo) { resultado.pulados.push({ numero: a.numero, motivo: "empresa_demo" }); continue; }
    if (a.resposta && String(a.resposta).trim()) { resultado.pulados.push({ numero: a.numero, motivo: "ja_tem_resposta" }); continue; }
    if (a.status !== "aguardando_confirmacao") { resultado.pulados.push({ numero: a.numero, motivo: "status_nao_aguardando" }); continue; }
    resultado.total++;
    if (dry) { resultado.pulados.push({ numero: a.numero, motivo: "dry_run" }); continue; }

    // Guarda de custo por empresa e global (mesma ordem do aiGuardedCall).
    const { data: pode } = await sb.rpc("fn_ia_empresa_pode_gastar", { p_company_id: a.company_id, p_feature: FEATURE, p_custo_estimado: CUSTO_ESTIMADO_USD });
    const pc = pode as { habilitado?: boolean; pode?: boolean; motivo?: string } | null;
    if (pc && pc.habilitado === false) { resultado.pulados.push({ numero: a.numero, motivo: "ia_desativada_empresa" }); continue; }
    if (pc && pc.pode === false) { resultado.pausado = pc.motivo || "teto da empresa"; break; }
    const { data: pg } = await sb.rpc("fn_budget_pode_executar", { p_custo_estimado_usd: CUSTO_ESTIMADO_USD });
    const pgl = pg as { pode_executar?: boolean; motivo?: string } | null;
    if (pgl && pgl.pode_executar === false) { resultado.pausado = pgl.motivo || "teto global"; break; }

    let texto = "";
    let custo = 0;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: modeloPara("redacao"),
          max_tokens: 600,
          tools: [toolSchema],
          tool_choice: { type: "tool", name: TOOL },
          messages: [{ role: "user", content: montarPrompt({ ...a, empresa: emprs.nome_fantasia || emprs.razao_social, pr_titulo: prTitulo.get(a.pr_numero) || null }) }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) {
        const t = await r.text();
        await registrarFalhaIA({ endpoint: "sugestao-redigir", finalidade: "redacao", modelo: modeloPara("redacao"), status: r.status, erro: t.slice(0, 200) });
        resultado.pulados.push({ numero: a.numero, motivo: `claude_${r.status}` });
        continue;
      }
      const data = await r.json();
      const blk = (data.content || []).find((b: any) => b?.type === "tool_use" && b?.name === TOOL);
      texto = String(blk?.input?.resposta || "").trim();
      custo = ((data.usage?.input_tokens || 0) * 2 + (data.usage?.output_tokens || 0) * 10) / 1_000_000;
    } catch (err) {
      await registrarFalhaIA({ endpoint: "sugestao-redigir", finalidade: "redacao", modelo: modeloPara("redacao"), status: null, erro: String(err).slice(0, 200) });
      resultado.pulados.push({ numero: a.numero, motivo: "falha_ia" });
      continue;
    }
    if (!texto) { resultado.pulados.push({ numero: a.numero, motivo: "resposta_vazia" }); continue; }

    // Só o RASCUNHO: resposta_aprovada=false, origem 'assistente', sem redator humano, sem notificação.
    const { data: upd, error: errU } = await sb.from("sugestoes")
      .update({ resposta: texto, resposta_aprovada: false, resposta_aprovada_por: null, resposta_aprovada_em: null,
                resposta_redigida_por: null, resposta_origem: "assistente", updated_at: new Date().toISOString() })
      .eq("id", a.id).eq("status", "aguardando_confirmacao").or("resposta.is.null,resposta.eq.")
      .select("id");
    if (errU || !upd || upd.length === 0) { resultado.pulados.push({ numero: a.numero, motivo: "gravacao_falhou" }); continue; }

    await sb.rpc("fn_ia_empresa_registrar_gasto", { p_company_id: a.company_id, p_feature: FEATURE, p_custo_usd: custo, p_chamadas: 1 }).then(() => {}, () => {});
    await sb.rpc("fn_budget_registrar_gasto", { p_custo_usd: custo, p_origem: FEATURE }).then(() => {}, () => {});
    resultado.redigidos++;
    resultado.custo_usd += custo;
  }

  return json({ ok: true, ...resultado });
});
