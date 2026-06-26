// atak-ingest — ingestao do coletor ATAK Frioeste.
// Auth: custom header x-ingest-secret (verify_jwt=false porque o coletor
// roda em maquina cliente sem JWT; o segredo Vault eh a chave).
// company_id e FIXO no edge (seguranca Pilar 2 — coletor comprometido
// nao grava em outra empresa).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Frioeste — fixo
const COMPANY_ID = '975365cc-9e5a-4251-9022-68c6bfde10d8'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = req.headers.get('x-ingest-secret')
  if (!secret || secret !== Deno.env.get('ATAK_INGEST_SECRET')) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body: { registros?: unknown[] }
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  const registros = Array.isArray(body?.registros) ? body.registros : []
  if (registros.length === 0) return json({ ok: true, gravados: 0 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const rows = registros.map((rUnknown) => {
    const r = rUnknown as Record<string, unknown>
    return {
      company_id: COMPANY_ID,
      cod_filial: String(r.cod_filial),
      chave_fato: String(r.chave_fato),
      seq_cabeca: Number(r.seq_cabeca),
      num_lote: r.num_lote ?? null,
      data_abate: r.data_abate,
      datahora_registro: r.datahora_registro ?? null,
      cod_produto: r.cod_produto ?? null,
      desc_classificacao: r.desc_classificacao ?? null,
      cod_classif: r.cod_classif ?? null,
      cod_precoce: r.cod_precoce ?? null,
      cod_cobertura: r.cod_cobertura ?? null,
      cod_conformacao: r.cod_conformacao ?? null,
      cod_maturidade: r.cod_maturidade ?? null,
      tipificacao_ia: r.tipificacao_ia ?? null,
      peso_carcaca1: r.peso_carcaca1 ?? null,
      peso_carcaca2: r.peso_carcaca2 ?? null,
      peso_carcaca1_resf: r.peso_carcaca1_resf ?? null,
      peso_carcaca2_resf: r.peso_carcaca2_resf ?? null,
      valor_arroba_pec: r.valor_arroba_pec ?? null,
      valor_arroba_nf: r.valor_arroba_nf ?? null,
      valor_arroba_tabela: r.valor_arroba_tabela ?? null,
      valor_arroba_calc: r.valor_arroba_calc ?? null,
      carne_magra: r.carne_magra ?? null,
      perc_carne_magra: r.perc_carne_magra ?? null,
      esp_toucinho: r.esp_toucinho ?? null,
      id_sisbov: r.id_sisbov ?? null,
      rastreabilidade: r.rastreabilidade ?? null,
      cod_camara: r.cod_camara ?? null,
      cod_manejo: r.cod_manejo ?? null,
      raw: r.raw ?? r,
    }
  })

  const { error } = await supabase
    .from('ind_abate_atak')
    .upsert(rows, { onConflict: 'company_id,cod_filial,chave_fato,seq_cabeca' })

  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, gravados: rows.length })

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
