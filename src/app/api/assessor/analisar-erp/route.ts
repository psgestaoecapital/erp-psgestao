import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const empresa_id = body.empresa_id as string
    const assessoria_id = body.assessoria_id as string | undefined
    const cliente_id = body.cliente_id as string | undefined

    if (!empresa_id) return NextResponse.json({ error: 'empresa_id obrigatorio' }, { status: 400 })

    const { data: lancamentos, error } = await supabase
      .from('lancamentos')
      .select('*')
      .eq('empresa_id', empresa_id)
      .order('data', { ascending: false })
      .limit(5000)

    if (error) throw error
    const rows = lancamentos || []
    if (rows.length === 0) return NextResponse.json({ error: 'Nenhum lancamento' }, { status: 404 })

    // ABC Clientes
    const cMap: Record<string, number> = {}
    rows.filter((l: any) => l.valor > 0).forEach((l: any) => {
      const k = l.cliente || l.fornecedor || 'N/I'
      cMap[k] = (cMap[k] || 0) + l.valor
    })
    const abcClientes = Object.entries(cMap).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor)

    // ABC Fornecedores
    const fMap: Record<string, number> = {}
    rows.filter((l: any) => l.valor < 0).forEach((l: any) => {
      const k = l.fornecedor || l.cliente || 'N/I'
      fMap[k] = (fMap[k] || 0) + Math.abs(l.valor)
    })
    const abcFornecedores = Object.entries(fMap).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor)

    // ABC Categorias
    const catMap: Record<string, { receita: number; despesa: number }> = {}
    rows.forEach((l: any) => {
      const k = l.categoria || 'Sem Categoria'
      if (!catMap[k]) catMap[k] = { receita: 0, despesa: 0 }
      if (l.valor >= 0) catMap[k].receita += l.valor
      else catMap[k].despesa += Math.abs(l.valor)
    })
    const abcCategorias = Object.entries(catMap).map(([nome, v]) => ({ nome, receita: v.receita, despesa: v.despesa, saldo: v.receita - v.despesa })).sort((a, b) => b.despesa - a.despesa)

    // DFCL Mensal
    const mMap: Record<string, { receita: number; despesa: number }> = {}
    rows.forEach((l: any) => {
      if (!l.data) return
      const mes = l.data.substring(0, 7)
      if (!mMap[mes]) mMap[mes] = { receita: 0, despesa: 0 }
      if (l.valor >= 0) mMap[mes].receita += l.valor
      else mMap[mes].despesa += Math.abs(l.valor)
    })
    const dfcl = Object.entries(mMap).map(([mes, v]) => ({ mes, receita: v.receita, despesa: v.despesa, saldo: v.receita - v.despesa })).sort((a, b) => a.mes.localeCompare(b.mes))

    if (assessoria_id && cliente_id) {
      await supabase.from('diagnosticos').insert({
        assessoria_id, cliente_id, tipo: 'erp_auto',
        dados: { abcClientes: abcClientes.slice(0, 20), abcFornecedores: abcFornecedores.slice(0, 20), abcCategorias, dfcl },
        status: 'concluido', created_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      total_lancamentos: rows.length,
      periodo: { inicio: rows[rows.length - 1]?.data, fim: rows[0]?.data },
      abc_clientes: abcClientes.slice(0, 20),
      abc_fornecedores: abcFornecedores.slice(0, 20),
      abc_categorias: abcCategorias,
      dfcl_mensal: dfcl,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}