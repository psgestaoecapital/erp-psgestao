import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(req: NextRequest) {
  try {
    const { empresa_id, assessoria_id, cliente_id } = await req.json()
    if (!empresa_id) return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 })

    // Buscar lançamentos da empresa
    const { data: lancamentos, error } = await supabase
      .from('lancamentos')
      .select('*')
      .eq('empresa_id', empresa_id)
      .order('data', { ascending: false })
      .limit(5000)

    if (error) throw error
    if (!lancamentos || lancamentos.length === 0) {
      return NextResponse.json({ error: 'Nenhum lançamento encontrado para esta empresa' }, { status: 404 })
    }

    // ABC Clientes
    const clientesMap = new Map<string, number>()
    lancamentos.filter(l => l.valor > 0).forEach(l => {
      const key = l.cliente || l.fornecedor || 'N/I'
      clientesMap.set(key, (clientesMap.get(key) || 0) + l.valor)
    })
    const abcClientes = Array.from(clientesMap.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)

    // ABC Fornecedores
    const fornMap = new Map<string, number>()
    lancamentos.filter(l => l.valor < 0).forEach(l => {
      const key = l.fornecedor || l.cliente || 'N/I'
      fornMap.set(key, (fornMap.get(key) || 0) + Math.abs(l.valor))
    })
    const abcFornecedores = Array.from(fornMap.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)

    // ABC Categorias
    const catMap = new Map<string, { receita: number; despesa: number }>()
    lancamentos.forEach(l => {
      const key = l.categoria || 'Sem Categoria'
      if (!catMap.has(key)) catMap.set(key, { receita: 0, despesa: 0 })
      const cat = catMap.get(key)!
      if (l.valor >= 0) cat.receita += l.valor
      else cat.despesa += Math.abs(l.valor)
    })
    const abcCategorias = Array.from(catMap.entries())
      .map(([nome, vals]) => ({ nome, receita: vals.receita, despesa: vals.despesa, saldo: vals.receita - vals.despesa }))
      .sort((a, b) => b.despesa - a.despesa)

    // DFCL Mensal
    const mesesMap = new Map<string, { receita: number; despesa: number }>()
    lancamentos.forEach(l => {
      if (!l.data) return
      const mes = l.data.substring(0, 7)
      if (!mesesMap.has(mes)) mesesMap.set(mes, { receita: 0, despesa: 0 })
      const m = mesesMap.get(mes)!
      if (l.valor >= 0) m.receita += l.valor
      else m.despesa += Math.abs(l.valor)
    })
    const dfcl = Array.from(mesesMap.entries())
      .map(([mes, vals]) => ({ mes, receita: vals.receita, despesa: vals.despesa, saldo: vals.receita - vals.despesa }))
      .sort((a, b) => a.mes.localeCompare(b.mes))

    // Salvar diagnóstico se assessoria_id e cliente_id
    if (assessoria_id && cliente_id) {
      await supabase.from('diagnosticos').insert({
        assessoria_id,
        cliente_id,
        tipo: 'erp_auto',
        dados: { abcClientes: abcClientes.slice(0, 20), abcFornecedores: abcFornecedores.slice(0, 20), abcCategorias, dfcl },
        status: 'concluido',
        created_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      total_lancamentos: lancamentos.length,
      periodo: { inicio: lancamentos[lancamentos.length - 1]?.data, fim: lancamentos[0]?.data },
      abc_clientes: abcClientes.slice(0, 20),
      abc_fornecedores: abcFornecedores.slice(0, 20),
      abc_categorias: abcCategorias,
      dfcl_mensal: dfcl,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}