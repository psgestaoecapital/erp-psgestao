import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  listarVinculosProduto,
  mensagemBloqueio,
  type AlvoVinculo,
} from '@/lib/produtos/vinculosProduto'

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
  cfop_venda_interestadual?: string | null
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

// #3255: código repetido (índice único company_id+codigo) vira mensagem clara, não o texto do Postgres.
function mensagemErro(error: { code?: string; message: string }, codigo?: string): string {
  if (error.code === '23505') return `Já existe um produto com o código ${String(codigo ?? '').trim()} nesta empresa. Use outro código.`
  return error.message
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

    if (error) return NextResponse.json({ ok: false, mensagem: mensagemErro(error, body.codigo) }, { status: error.code === '23505' ? 409 : 500 })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro' },
      { status: 500 }
    )
  }
})

// Conta, no banco, quantos registros usam o produto em um alvo de vínculo. Service role: vê tudo da empresa,
// independente da RLS do usuário. Erro de contagem propaga — na dúvida o produto NÃO é excluído (fail-closed).
async function contarVinculo(alvo: AlvoVinculo, companyId: string, produto: { id: string; codigo: string | null }): Promise<number> {
  if (alvo.tipo === 'json_codigo' && !produto.codigo) return 0 // sem código, a nota não tem como apontar para ele
  const base = supabaseAdmin.from(alvo.tabela).select('id', { count: 'exact', head: true })
  const consulta = alvo.tipo === 'json_codigo'
    ? base.eq('company_id', companyId).contains(alvo.coluna, [{ codigo: produto.codigo }])
    : base.eq(alvo.coluna, produto.id)
  const { count, error } = await consulta
  if (error) throw new Error(`Não foi possível verificar vínculos (${alvo.rotulo}): ${error.message}`)
  return count ?? 0
}

async function produtoDaEmpresa(id: string, companyId: string) {
  const { data, error } = await supabaseAdmin
    .from('erp_produtos')
    .select('id,codigo,nome,ativo')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  return data
}

// Vínculos do produto (a tela mostra antes de confirmar a exclusão).
export const GET = exigirLogin(async (req: NextRequest, u) => {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const companyId = url.searchParams.get('company_id')
    if (!id || !companyId) return NextResponse.json({ ok: false, mensagem: 'id e company_id obrigatorios' }, { status: 400 })
    const negado = await exigirEmpresas(u, [companyId])
    if (negado) return negado

    const produto = await produtoDaEmpresa(id, companyId)
    if (!produto) return NextResponse.json({ ok: false, mensagem: 'Produto não encontrado nesta empresa' }, { status: 404 })

    const vinculos = await listarVinculosProduto((alvo) => contarVinculo(alvo, companyId, produto))
    return NextResponse.json({ ok: true, produto, vinculos, pode_excluir: vinculos.length === 0 })
  } catch (err) {
    return NextResponse.json({ ok: false, mensagem: (err as Error)?.message ?? 'Erro' }, { status: 500 })
  }
})

// Exclusão LÓGICA (ativo = false): o registro e o histórico ficam no banco. Bloqueia se houver qualquer vínculo.
export const DELETE = exigirLogin(async (req: NextRequest, u) => {
  try {
    const body = (await req.json()) as { id?: string; company_id?: string }
    if (!body.id || !body.company_id) {
      return NextResponse.json({ ok: false, mensagem: 'id e company_id obrigatorios' }, { status: 400 })
    }
    const negado = await exigirEmpresas(u, [body.company_id])
    if (negado) return negado

    const produto = await produtoDaEmpresa(body.id, body.company_id)
    if (!produto) return NextResponse.json({ ok: false, mensagem: 'Produto não encontrado nesta empresa' }, { status: 404 })

    const vinculos = await listarVinculosProduto((alvo) => contarVinculo(alvo, body.company_id!, produto))
    if (vinculos.length > 0) {
      return NextResponse.json({ ok: false, mensagem: mensagemBloqueio(vinculos), vinculos }, { status: 409 })
    }

    const { error } = await supabaseAdmin
      .from('erp_produtos')
      .update({ ativo: false })
      .eq('id', body.id)
      .eq('company_id', body.company_id)
    if (error) return NextResponse.json({ ok: false, mensagem: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: body.id })
  } catch (err) {
    return NextResponse.json({ ok: false, mensagem: (err as Error)?.message ?? 'Erro' }, { status: 500 })
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

    if (error) return NextResponse.json({ ok: false, mensagem: mensagemErro(error, body.codigo) }, { status: error.code === '23505' ? 409 : 500 })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro' },
      { status: 500 }
    )
  }
})
