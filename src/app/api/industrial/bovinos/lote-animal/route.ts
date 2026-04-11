import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const body = await req.json()
  const { unidade_id, data_entrada, fornecedor, tipo_aquisicao,
    quantidade, peso_medio_entrada, custo_arroba, custo_frete_cab } = body

  const custo_kg_vivo = custo_arroba ? custo_arroba / 15 : null
  const custo_total_lote = custo_arroba && quantidade && peso_medio_entrada
    ? quantidade * peso_medio_entrada * (custo_arroba / 15) : null

  const { data, error } = await supabaseAdmin
    .from('ind_lotes_animais')
    .insert({
      unidade_id, data_entrada, fornecedor,
      tipo_aquisicao: tipo_aquisicao || 'compra',
      quantidade, peso_medio_entrada, custo_arroba,
      custo_kg_vivo, custo_frete_cab: custo_frete_cab || 0, custo_total_lote,
    })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ lote: data })
})

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const unidadeId = searchParams.get('unidade_id')
  if (!unidadeId)
    return NextResponse.json({ error: 'unidade_id obrigatorio' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('ind_lotes_animais').select('*')
    .eq('unidade_id', unidadeId)
    .order('data_entrada', { ascending: false })
    .limit(30)
  return NextResponse.json({ lotes: data || [] })
})