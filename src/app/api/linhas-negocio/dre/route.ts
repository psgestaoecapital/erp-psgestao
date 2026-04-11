import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'
import { applyStandardFilters } from '@/lib/dataFilters'
import type { DREPorLinha } from '@/types/linhas-negocio'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const periodo = searchParams.get('periodo') // 'YYYY-MM'
  if (!empresaId || !periodo) return NextResponse.json({ error: 'empresa_id e periodo obrigatórios' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const [ano, mes] = periodo.split('-')
  const mesNum = String(Number(mes) + 1).padStart(2, '0')

  // Busca lançamentos do período com linha de negócio
  const { data: lancamentos, error: lErr } = await sb
    .from('lancamentos')
    .select('*, linhas_negocio(id, nome, cor)')
    .eq('empresa_id', empresaId)
    .gte('data_lancamento', `${ano}-${mes}-01`)
    .lt('data_lancamento', `${ano}-${mesNum}-01`)
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

  // Busca linhas ativas
  const { data: linhas } = await sb
    .from('linhas_negocio').select('*').eq('empresa_id', empresaId).eq('ativo', true)

  // Busca budgets do período
  const { data: budgets } = await sb
    .from('linhas_negocio_budget')
    .select('*').eq('empresa_id', empresaId).eq('ano', Number(ano)).eq('mes', Number(mes))

  const filtered = applyStandardFilters(lancamentos ?? [])
  const budgetMap = Object.fromEntries((budgets ?? []).map((b: any) => [b.linha_id, b]))

  // Agrupa por linha
  const dreMap: Record<string, DREPorLinha> = {}

  for (const linha of (linhas ?? [])) {
    const items = filtered.filter((l: any) => l.linha_negocio_id === linha.id)
    const receita = items.filter((l: any) => l.tipo === 'receita').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)
    const despesa = items.filter((l: any) => l.tipo === 'despesa').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)
    const custosDiretos = items.filter((l: any) => l.tipo === 'despesa' && l.natureza === 'custo_direto').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)
    const despComerciais = items.filter((l: any) => l.tipo === 'despesa' && l.natureza === 'comercial').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)
    const overhead = items.filter((l: any) => l.tipo === 'despesa' && l.natureza === 'overhead').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)

    const cm1 = receita - custosDiretos
    const cm2 = cm1 - despComerciais
    const cm3 = cm2 - overhead
    const budget = budgetMap[linha.id]
    const desvio = budget ? ((receita - budget.receita_budget) / budget.receita_budget) * 100 : undefined

    // Health score simples: 0-100 baseado em margem CM3
    const healthScore = receita > 0 ? Math.min(100, Math.max(0, Math.round(50 + (cm3 / receita) * 100))) : 0

    dreMap[linha.id] = {
      linha_id: linha.id, linha_nome: linha.nome, linha_cor: linha.cor,
      receita_bruta: receita, custos_diretos: custosDiretos,
      cm1, cm1_pct: receita > 0 ? (cm1 / receita) * 100 : 0,
      despesas_comerciais: despComerciais,
      cm2, cm2_pct: receita > 0 ? (cm2 / receita) * 100 : 0,
      overhead_rateado: overhead,
      cm3, cm3_pct: receita > 0 ? (cm3 / receita) * 100 : 0,
      budget_receita: budget?.receita_budget, budget_despesa: budget?.despesa_budget,
      desvio_pct: desvio, health_score: healthScore,
    }
  }

  return NextResponse.json({ data: Object.values(dreMap) })
})
