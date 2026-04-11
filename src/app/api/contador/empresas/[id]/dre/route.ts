import { NextRequest, NextResponse } from 'next/server'
import { withContadorAuth } from '@/lib/contadorAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  return withContadorAuth(req, async (_req, session) => {
    const { id } = await params
    if (!session.company_ids.includes(id)) {
      return NextResponse.json({ error: 'Acesso negado a esta empresa' }, { status: 403 })
    }

    const url = new URL(req.url)
    const periodo = url.searchParams.get('periodo') || new Date().toISOString().slice(0,7)
    const tipo = url.searchParams.get('tipo') || 'mensal'

    // Busca lançamentos do período
    let query = supabaseAdmin
      .from('erp_movimentacoes')
      .select('tipo, valor, categoria, data_vencimento, data_pagamento')
      .eq('company_id', id)
      .eq('cancelado', false)

    if (tipo === 'mensal') {
      query = query.like('data_vencimento', periodo + '%')
    } else if (tipo === 'trimestral') {
      const [ano, mes] = periodo.split('-').map(Number)
      const trimStart = new Date(ano, Math.floor((mes-1)/3)*3, 1)
      const trimEnd   = new Date(ano, Math.floor((mes-1)/3)*3+3, 0)
      query = query
        .gte('data_vencimento', trimStart.toISOString().slice(0,10))
        .lte('data_vencimento', trimEnd.toISOString().slice(0,10))
    }

    const { data: movs } = await query

    const receitas  = (movs||[]).filter((m:any)=>m.tipo==='receita').reduce((s:number,m:any)=>s+(m.valor||0),0)
    const despesas  = (movs||[]).filter((m:any)=>m.tipo==='despesa').reduce((s:number,m:any)=>s+(m.valor||0),0)
    const resultado = receitas - despesas
    const margem    = receitas > 0 ? (resultado/receitas)*100 : 0

    // Busca fiscal
    const { data: fiscal } = await supabaseAdmin
      .from('fiscal_apuracoes')
      .select('*')
      .eq('company_id', id)
      .eq('periodo', periodo)
      .single()

    return NextResponse.json({
      empresa_id: id,
      periodo,
      tipo,
      receitas,
      despesas,
      resultado,
      margem_pct: parseFloat(margem.toFixed(2)),
      fiscal: fiscal || null,
      total_movimentacoes: movs?.length || 0,
    })
  })
}
