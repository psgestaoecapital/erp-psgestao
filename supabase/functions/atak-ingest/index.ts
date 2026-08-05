// atak-ingest — ingestao do coletor ATAK Frioeste.
// Auth: custom header x-ingest-secret (verify_jwt=false porque o coletor
// roda em maquina cliente sem JWT; o segredo Vault eh a chave).
// company_id e FIXO no edge (seguranca Pilar 2 — coletor comprometido
// nao grava em outra empresa).
//
// CAO DE GUARDA (PARTE 1.1): TODA chamada autenticada grava 1 heartbeat em
// erp_sync_log (sucesso OU erro), com collector_version + host enviados pelo
// coletor — e assim sabemos QUAL maquina parou. O heartbeat nunca derruba a
// ingestao (falha de log e engolida).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Frioeste — fixo
const COMPANY_ID = '975365cc-9e5a-4251-9022-68c6bfde10d8'

// Tamanho do sub-lote de gravação. O coletor manda lotes de 500; dividimos a
// gravação em pedaços menores para nenhuma instrução de upsert estourar o
// statement_timeout em domínios grandes (FIX 2 — compra_gado 47k, desossa 44k,
// financeiro 80k). O de-dup (FIX 1) reduz ainda mais o volume por instrução.
const SUBLOTE = 250

// FIX 1 (RD-57) — de-duplica por chave de CONFLITO dentro do lote recebido.
// A view do ATAK pode devolver 2+ linhas idênticas no mesmo lote; como a chave
// é o mesmo hash, o `INSERT ... ON CONFLICT DO UPDATE` não pode tocar a mesma
// chave 2x no mesmo comando ("cannot affect row a second time"). Mantemos só a
// última ocorrência (equivalente ao upsert). Vale para TODOS os domínios.
function dedupPorChave<T>(rows: T[], keyFn: (r: T) => string): { limpo: T[]; duplicatas: number } {
  const vistos = new Map<string, T>()
  for (const r of rows) vistos.set(keyFn(r), r)   // última vence
  return { limpo: [...vistos.values()], duplicatas: rows.length - vistos.size }
}

// Grava em sub-lotes sequenciais (FIX 2). Retorna a 1ª mensagem de erro, ou null.
async function upsertEmLotes<T extends Record<string, unknown>>(
  sb: ReturnType<typeof createClient>, table: string, rows: T[], onConflict: string,
): Promise<string | null> {
  for (let i = 0; i < rows.length; i += SUBLOTE) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + SUBLOTE), { onConflict })
    if (error) return error.message
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = req.headers.get('x-ingest-secret')
  if (!secret || secret !== Deno.env.get('ATAK_INGEST_SECRET')) {
    // Sem heartbeat aqui de proposito: chamada nao autenticada nao e o coletor
    // legitimo; nao suja o log de saude da empresa.
    return json({ error: 'unauthorized' }, 401)
  }

  const iniciadoEm = new Date()
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // heartbeat: grava SEMPRE (sucesso ou erro). Nunca lanca — se o log falhar,
  // a ingestao segue e o erro do log fica so no console.
  async function heartbeat(opts: {
    fase: 'sucesso' | 'falha'
    httpStatus: number
    gravados: number
    recebidos: number
    collectorVersion: string | null
    host: string | null
    janelaDias: number | null
    triggerType: string
    dominio?: string | null
    duplicatas?: number
    erro?: string | null
  }) {
    const fim = new Date()
    try {
      // duracao_ms é coluna GENERATED (finalizado_em - iniciado_em); não enviar.
      await supabase.from('erp_sync_log').insert({
        company_id: COMPANY_ID,
        iniciado_em: iniciadoEm.toISOString(),
        finalizado_em: fim.toISOString(),
        fase: opts.fase,
        http_status: opts.httpStatus,
        // 'coletor_atak' (diário) OU 'coletor_atak_backfill' (carga histórica) —
        // separados para não confundir o cão de guarda (R6).
        trigger_type: opts.triggerType,
        http_response: {
          fonte: 'atak',
          dominio: opts.dominio ?? 'abate',
          gravados: opts.gravados,
          recebidos: opts.recebidos,
          // telemetria de qualidade da view (quantas linhas idênticas o ATAK repetiu no lote).
          duplicatas: opts.duplicatas ?? 0,
          janela_dias: opts.janelaDias,
          collector_version: opts.collectorVersion,
          host: opts.host,
        },
        erro: opts.erro ?? null,
      })
    } catch (e) {
      console.error('[atak-ingest] heartbeat falhou (ignorado):', String((e as Error)?.message ?? e))
    }
  }

  let body: {
    registros?: unknown[]
    collector_version?: string
    hostname?: string
    janela_dias?: number
    collector_mode?: string
    dominio?: string
  }
  try {
    body = await req.json()
  } catch {
    // bad json: sem body, cai no trigger diário por padrão.
    await heartbeat({ fase: 'falha', httpStatus: 400, gravados: 0, recebidos: 0, collectorVersion: null, host: null, janelaDias: null, triggerType: 'coletor_atak', erro: 'bad json' })
    return json({ error: 'bad json' }, 400)
  }

  const collectorVersion = typeof body?.collector_version === 'string' ? body.collector_version : null
  const host = typeof body?.hostname === 'string' ? body.hostname : null
  const janelaDias = typeof body?.janela_dias === 'number' ? body.janela_dias : null
  // Modo backfill marca o heartbeat separado (R6). Ausente/qualquer-coisa → diário (não muda o fluxo atual, R1).
  const triggerType = body?.collector_mode === 'backfill' ? 'coletor_atak_backfill' : 'coletor_atak'
  // dominio ausente/'abate' → landing legado ind_abate_atak (sem regressao · RD-53).
  // Qualquer outro (embalagem, estoque, ...) → landing UNIVERSAL ind_atak_fato (F1).
  const dominio = typeof body?.dominio === 'string' && body.dominio.trim() ? body.dominio.trim() : 'abate'

  const registros = Array.isArray(body?.registros) ? body.registros : []
  const recebidos = registros.length
  if (recebidos === 0) {
    // Sync valido sem novidade (janela vazia) — CONTA como sucesso (a maquina
    // esta viva), gravados=0.
    await heartbeat({ fase: 'sucesso', httpStatus: 200, gravados: 0, recebidos: 0, collectorVersion, host, janelaDias, triggerType, dominio })
    return json({ ok: true, gravados: 0 })
  }

  // ── Domínios GENÉRICOS (embalagem, estoque, …) → ind_atak_fato ──────────────
  // Resiliência (F1): guarda o `raw` inteiro; os campos tipados saem das VIEWS
  // (v_ind_embalagem/v_ind_estoque), ajustáveis sem recarregar. O coletor manda
  // { dominio, registros:[{ cod_filial, chave_fato, raw }] }.
  if (dominio !== 'abate') {
    const rows = registros.map((rUnknown) => {
      const r = rUnknown as Record<string, unknown>
      return {
        company_id: COMPANY_ID,
        cod_filial: r.cod_filial != null ? String(r.cod_filial) : null,
        dominio,
        chave_fato: String(r.chave_fato),
        raw: r.raw ?? r,
      }
    })
    // FIX 1 — de-dup por chave de conflito (company_id/dominio são fixos no lote → chave = chave_fato).
    const { limpo, duplicatas } = dedupPorChave(rows, (r) => String(r.chave_fato))
    const erro = await upsertEmLotes(supabase, 'ind_atak_fato', limpo, 'company_id,dominio,chave_fato')
    if (erro) {
      await heartbeat({ fase: 'falha', httpStatus: 500, gravados: 0, recebidos, collectorVersion, host, janelaDias, triggerType, dominio, duplicatas, erro })
      return json({ error: erro }, 500)
    }
    await heartbeat({ fase: 'sucesso', httpStatus: 200, gravados: limpo.length, recebidos, collectorVersion, host, janelaDias, triggerType, dominio, duplicatas })
    return json({ ok: true, gravados: limpo.length, duplicatas, dominio })
  }

  // ── ABATE (legado) → ind_abate_atak ───────────────────────────────────────
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

  // FIX 1 — de-dup pela chave de conflito completa (company_id é fixo no lote).
  const { limpo, duplicatas } = dedupPorChave(rows, (r) => `${r.cod_filial}|${r.chave_fato}|${r.seq_cabeca}`)
  const erro = await upsertEmLotes(supabase, 'ind_abate_atak', limpo, 'company_id,cod_filial,chave_fato,seq_cabeca')
  if (erro) {
    await heartbeat({ fase: 'falha', httpStatus: 500, gravados: 0, recebidos, collectorVersion, host, janelaDias, triggerType, duplicatas, erro })
    return json({ error: erro }, 500)
  }

  await heartbeat({ fase: 'sucesso', httpStatus: 200, gravados: limpo.length, recebidos, collectorVersion, host, janelaDias, triggerType, duplicatas })
  return json({ ok: true, gravados: limpo.length, duplicatas })

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
