// src/app/api/sync/omie/full/route.ts
// PS Gestão ERP — Sync Completo (fornecedores + clientes + produtos em sequência)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 600 // 10 min

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { company_id } = await req.json()
    if (!company_id) {
      return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })
    }

    const inicio = Date.now()
    const origin = req.headers.get('host') || 'localhost'
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const baseUrl = `${proto}://${origin}`

    const resultado: any = {
      company_id,
      fornecedores: null,
      clientes: null,
      produtos: null,
    }

    // Ordem: fornecedores → clientes → produtos
    // (produtos podem ter fornecedor como ref)
    const tipos = ['fornecedores', 'clientes', 'produtos']

    for (const tipo of tipos) {
      console.log(`[SYNC-FULL] Iniciando ${tipo}...`)
      try {
        const r = await fetch(`${baseUrl}/api/sync/omie/${tipo}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id }),
        })
        const data = await r.json()
        resultado[tipo] = data
        console.log(`[SYNC-FULL] ✅ ${tipo}: +${data.inseridos || 0} / ↻${data.atualizados || 0} / ✗${data.erros || 0}`)
      } catch (err: any) {
        resultado[tipo] = { error: err.message }
        console.error(`[SYNC-FULL] ❌ ${tipo}: ${err.message}`)
      }
    }

    const duracaoMs = Date.now() - inicio
    const totalInseridos = (resultado.fornecedores?.inseridos || 0) + (resultado.clientes?.inseridos || 0) + (resultado.produtos?.inseridos || 0)
    const totalAtualizados = (resultado.fornecedores?.atualizados || 0) + (resultado.clientes?.atualizados || 0) + (resultado.produtos?.atualizados || 0)
    const totalErros = (resultado.fornecedores?.erros || 0) + (resultado.clientes?.erros || 0) + (resultado.produtos?.erros || 0)
    const totalOmie = (resultado.fornecedores?.total_omie || 0) + (resultado.clientes?.total_omie || 0) + (resultado.produtos?.total_omie || 0)

    await supabase.from('omie_sync_log').insert({
      company_id,
      tipo: 'full',
      total_omie: totalOmie,
      inseridos: totalInseridos,
      atualizados: totalAtualizados,
      erros: totalErros,
      duracao_ms: duracaoMs,
      executado_em: new Date().toISOString(),
      status: totalErros > 0 ? 'partial' : 'success',
    })

    return NextResponse.json({
      success: true,
      total_omie: totalOmie,
      inseridos: totalInseridos,
      atualizados: totalAtualizados,
      erros: totalErros,
      duracao_ms: duracaoMs,
      detalhes: resultado,
    })
  } catch (err: any) {
    console.error('[SYNC-FULL] ❌ Erro fatal:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
