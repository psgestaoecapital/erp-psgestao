// DF-e Onda 2.2 · worker nfe-distribuicao-auto
//
// Disparado pelo cron (fn_dfe_distribuicao_auto_dispatch a cada 1h).
// Seleciona empresas com habilitado=true E (ultimo_ciclo_em IS NULL
// OR ultimo_ciclo_em < now() - 55min) — respeita o ~1h SEFAZ entre
// ciclos. Para cada empresa, chama a edge nfe-distribuicao em
// modo=manual via HTTP interno com service_role.
//
// Sequencial · throttle de 5s entre empresas pra dar folga ao Focus.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const THROTTLE_EMPRESAS_MS = 5000

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

interface EmpresaResult {
  company_id: string
  ok: boolean
  novas?: number
  manifestadas?: number
  novo_ultimo_nsu?: number
  erro?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return respond(405, { ok: false, erro: "metodo_nao_permitido" })

  // Seleciona empresas elegiveis (>= 55min desde ultimo ciclo, ou nunca rodou)
  const cutoff = new Date(Date.now() - 55 * 60 * 1000).toISOString()
  const { data: elegiveis, error: selErr } = await sbAdmin
    .from("erp_nfe_distribuicao_controle")
    .select("company_id, ultimo_ciclo_em")
    .eq("habilitado", true)
    .or(`ultimo_ciclo_em.is.null,ultimo_ciclo_em.lt.${cutoff}`)
    .order("ultimo_ciclo_em", { ascending: true, nullsFirst: true })
    .limit(20)

  if (selErr) {
    return respond(500, { ok: false, etapa: "select_elegiveis", erro: selErr.message })
  }
  const fila = elegiveis ?? []
  if (fila.length === 0) {
    return respond(200, { ok: true, empresas_processadas: 0, total_novos: 0, total_manifestados: 0 })
  }

  const resultados: EmpresaResult[] = []
  let totalNovos = 0
  let totalManif = 0

  for (let i = 0; i < fila.length; i++) {
    const company_id = fila[i].company_id as string
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/nfe-distribuicao`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ company_id, modo: "manual", gerar_pagar: false }),
      })
      const json = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        novas?: number
        manifestadas?: number
        novo_ultimo_nsu?: number
        erro?: string
      }
      if (!r.ok || !json.ok) {
        resultados.push({
          company_id, ok: false,
          erro: json.erro ?? `HTTP ${r.status}`,
        })
      } else {
        resultados.push({
          company_id, ok: true,
          novas: json.novas ?? 0,
          manifestadas: json.manifestadas ?? 0,
          novo_ultimo_nsu: json.novo_ultimo_nsu,
        })
        totalNovos += json.novas ?? 0
        totalManif += json.manifestadas ?? 0
      }
    } catch (e) {
      resultados.push({
        company_id, ok: false,
        erro: e instanceof Error ? e.message : String(e),
      })
    }
    if (i < fila.length - 1) await sleep(THROTTLE_EMPRESAS_MS)
  }

  return respond(200, {
    ok: true,
    empresas_processadas: fila.length,
    total_novos: totalNovos,
    total_manifestados: totalManif,
    resultados,
  })
})
