import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ProdutoPayload {
  id?: string
  company_id: string
  codigo: string
  nome: string
  descricao?: string | null
  unidade?: string | null
  preco_venda?: number
  preco_custo?: number | null
  ncm?: string | null
  cest?: string | null
  cfop_venda?: string | null
  origem?: string | null
  cst_icms?: string | null
  aliquota_icms?: number | null
  cst_pis?: string | null
  aliquota_pis?: number | null
  cst_cofins?: string | null
  aliquota_cofins?: number | null
  aliquota_ipi?: number | null
  ativo?: boolean
}

function basicValidate(p: Partial<ProdutoPayload>): string | null {
  if (!p.company_id) return 'company_id obrigatorio'
  if (p.company_id === 'consolidado' || String(p.company_id).startsWith('group_')) {
    return 'Selecione 1 empresa especifica'
  }
  if (!p.nome || p.nome.trim().length < 2) return 'nome obrigatorio'
  if (!p.codigo || p.codigo.trim().length < 1) return 'codigo obrigatorio'
  return null
}

export const POST = exigirLogin(async (req: NextRequest, u) => {
  try {
    const body = (await req.json()) as ProdutoPayload
    const erro = basicValidate(body)
    if (erro) return NextResponse.json({ ok: false, mensagem: erro }, { status: 400 })
    const negado = await exigirEmpresas(u, [body.company_id])
    if (negado) return negado

    const { id: _omitId, ...insertable } = body
    void _omitId

    const { data, error } = await supabaseAdmin
      .from('erp_produtos')
      .insert({ ...insertable, ativo: insertable.ativo ?? true })
      .select('id')
      .single()

    if (error) return NextResponse.json({ ok: false, mensagem: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro' },
      { status: 500 }
    )
  }
})

export const PATCH = exigirLogin(async (req: NextRequest, u) => {
  try {
    const body = (await req.json()) as ProdutoPayload
    if (!body.id) {
      return NextResponse.json({ ok: false, mensagem: 'id obrigatorio pra PATCH' }, { status: 400 })
    }
    const erro = basicValidate(body)
    if (erro) return NextResponse.json({ ok: false, mensagem: erro }, { status: 400 })
    // O update já filtra .eq('company_id') — basta o usuário ter acesso a essa empresa.
    const negado = await exigirEmpresas(u, [body.company_id])
    if (negado) return negado

    const { id, company_id, ...updatable } = body

    const { error } = await supabaseAdmin
      .from('erp_produtos')
      .update(updatable)
      .eq('id', id)
      .eq('company_id', company_id)

    if (error) return NextResponse.json({ ok: false, mensagem: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro' },
      { status: 500 }
    )
  }
})
