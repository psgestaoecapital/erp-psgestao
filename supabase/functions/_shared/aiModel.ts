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
