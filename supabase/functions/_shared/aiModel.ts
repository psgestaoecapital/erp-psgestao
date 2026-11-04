// aiModel.ts (edge/Deno) — espelho de src/lib/aiModel.ts. MESMOS nomes de env, MESMO
// default vivo. Se divergir do lado Next, viram duas fontes de novo — o problema que
// esta mudança conserta. Ver a doutrina completa no arquivo Next.
//
//   1. modeloPara(finalidade): ANTHROPIC_MODEL_<FINALIDADE> → ANTHROPIC_MODEL_DEFAULT
//      → MODELO_DEFAULT_VIVO (claude-sonnet-5). Env por finalidade = troca sem deploy,
//      com default vivo no código.
//   2. registrarFalhaIA(...): grava toda falha de chamada Claude em erp_ia_falha
//      (404/modelo inválido/rate-limit/timeout). Nunca lança.

import { createClient } from "jsr:@supabase/supabase-js@2";

export const MODELO_DEFAULT_VIVO = "claude-sonnet-5";

export function modeloPara(finalidade: string): string {
  const chave = "ANTHROPIC_MODEL_" + String(finalidade).toUpperCase();
  return Deno.env.get(chave) || Deno.env.get("ANTHROPIC_MODEL_DEFAULT") || MODELO_DEFAULT_VIVO;
}

export interface FalhaIA {
  endpoint: string;
  finalidade: string;
  modelo: string;
  status?: number | null;
  erro: string;
  companyId?: string | null;
}

export async function registrarFalhaIA(f: FalhaIA): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const sb = createClient(url, key);
    await sb.rpc("fn_ia_falha_registrar", {
      p_runtime: "edge",
      p_endpoint: f.endpoint,
      p_finalidade: f.finalidade,
      p_modelo: f.modelo,
      p_status: f.status ?? null,
      p_erro: (f.erro || "").slice(0, 500),
      p_company_id: f.companyId ?? null,
    });
  } catch {
    /* o alarme jamais pode quebrar a função que o chamou */
  }
}

/**
 * P0 CUSTO (CEO 01/11): porteiro ÚNICO de orçamento de IA (espelho de src/lib/aiModel.ts).
 * Consulta anthropic_budget_control (singleton id=1) ANTES de qualquer chamada paga.
 * Bloqueia em `pausado` (freeze global), `gold_pausado` (sub-teto Gold) ou limite POSITIVO
 * de custo (dia/mês) já atingido. FAIL-CLOSED: se não puder ler o controle, trata como bloqueado.
 */
export interface IABudgetStatus { bloqueado: boolean; motivo: string }

export async function iaBudgetStatus(opts?: { gold?: boolean }): Promise<IABudgetStatus> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return { bloqueado: true, motivo: "Controle de orçamento de IA indisponível; IA bloqueada por segurança de custo." };
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from("anthropic_budget_control")
      .select("pausado,motivo_pausa,gold_pausado,gold_motivo_pausa,limite_max_custo_usd_dia,limite_max_custo_usd_mes,custo_usd_hoje,custo_usd_mes_atual")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return { bloqueado: true, motivo: "Controle de orçamento de IA indisponível; IA bloqueada por segurança de custo." };
    if (data.pausado) return { bloqueado: true, motivo: data.motivo_pausa || "Gasto de IA pausado pelo controle de orçamento." };
    if (opts?.gold && data.gold_pausado) return { bloqueado: true, motivo: data.gold_motivo_pausa || "Sub-teto Gold de IA atingido." };
    const limDia = Number(data.limite_max_custo_usd_dia);
    const limMes = Number(data.limite_max_custo_usd_mes);
    if (limDia > 0 && Number(data.custo_usd_hoje) >= limDia) return { bloqueado: true, motivo: "Limite diário de custo de IA atingido." };
    if (limMes > 0 && Number(data.custo_usd_mes_atual) >= limMes) return { bloqueado: true, motivo: "Limite mensal de custo de IA atingido." };
    return { bloqueado: false, motivo: "" };
  } catch {
    return { bloqueado: true, motivo: "Falha ao consultar o controle de orçamento de IA; IA bloqueada por segurança de custo." };
  }
}

/** Erro padrão quando a IA está bloqueada por orçamento. A função traduz para 503 + mensagem honesta. */
export class IABloqueadaError extends Error {
  readonly bloqueadaIA = true;
  constructor(public motivo: string) { super("IA_BLOQUEADA: " + motivo); }
}

/** Lança IABloqueadaError se a IA estiver bloqueada. Use no topo de todo ponto que chama Anthropic/Gemini. */
export async function assertIAPermitida(opts?: { gold?: boolean }): Promise<void> {
  const s = await iaBudgetStatus(opts);
  if (s.bloqueado) throw new IABloqueadaError(s.motivo);
}
