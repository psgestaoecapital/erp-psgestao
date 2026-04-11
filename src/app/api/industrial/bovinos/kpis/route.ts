import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/industrial/bovinos/kpis?unidade_id=&periodo=today|week|month
export const GET = withAuth(async (req: NextRequest, { user }) => {
  const url = new URL(req.url)
  const unidadeId = url.searchParams.get('unidade_id')
  const periodo = url.searchParams.get('periodo') || 'today'

  if (!unidadeId) return NextResponse.json({ error: 'unidade_id obrigatório' }, { status: 400 })

  const hoje = new Date().toISOString().slice(0,10)
  let dataInicio = hoje
  if (periodo === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7)
    dataInicio = d.toISOString().slice(0,10)
  } else if (periodo === 'month') {
    dataInicio = hoje.slice(0,7) + '-01'
  }

  // KPIs diários consolidados
  const { data: kpis } = await supabaseAdmin
    .from('ind_kpis_diarios')
    .select('*')
    .eq('unidade_id', unidadeId)
    .gte('data', dataInicio)
    .lte('data', hoje)
    .order('data', { ascending: false })

  // Alertas abertos
  const { data: alertas } = await supabaseAdmin
    .from('ind_alertas_ceo')
    .select('*')
    .eq('unidade_id', unidadeId)
    .eq('lido', false)
    .order('urgencia', { ascending: false })
    .limit(10)

  // Agregados do período
  const agg = (kpis || []).reduce((acc: any, k: any) => {
    acc.cabecas_total += (k.cabecas_dia || 0)
    acc.toneladas_total += (k.toneladas_dia || 0)
    acc.receita_total += (k.receita_dia || 0)
    acc.ebitda_total += (k.ebitda_dia || 0)
    acc.custo_condenacao_total += (k.custo_condenacao || 0)
    acc.dias++
    return acc
  }, { cabecas_total:0, toneladas_total:0, receita_total:0, ebitda_total:0, custo_condenacao_total:0, dias:0 })

  const ultimo = kpis?.[0] || null

  return NextResponse.json({
    unidade_id: unidadeId,
    periodo,
    data_inicio: dataInicio,
    data_fim: hoje,
    ultimo_dia: ultimo,
    agregados: {
      ...agg,
      margem_media_pct: agg.receita_total > 0
        ? ((agg.ebitda_total / agg.receita_total) * 100).toFixed(2)
        : 0,
      custo_medio_kg: ultimo?.custo_kg_total || 0,
      rendimento_medio: ultimo?.rendimento_pct || 0,
    },
    alertas: alertas || [],
    historico: kpis || [],
  })
})
