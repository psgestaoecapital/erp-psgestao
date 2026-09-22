import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// NFS-e primeiro → financeiro pelo LÍQUIDO · Etapa 2 (API).
// A partir de uma NFS-e AUTORIZADA, gera o contas a receber pelo VALOR LÍQUIDO
// (bruto − deduções − desconto − retenções). Entrega 1: retenções INFORMADAS PELO USUÁRIO.
// A regra fiscal e a idempotência vivem no banco (fn_nfse_gerar_financeiro).

interface Body {
  companyId: string
  nfseId: string
  deducoes?: number
  descontoIncondicionado?: number
  retencoes?: {
    iss?: number; irrf?: number; pis?: number; cofins?: number; csll?: number; inss?: number
  }
  primeiroVencimento?: string | null
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as Body
    if (!body.companyId || !body.nfseId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId e nfseId são obrigatórios' }, { status: 400 })
    }

    // a nota tem de ser da empresa informada (evita IDOR entre empresas)
    const { data: nota, error: notaErr } = await supabaseAdmin
      .from('erp_nfse_emitidas')
      .select('id, company_id, status')
      .eq('id', body.nfseId)
      .maybeSingle()
    if (notaErr) return NextResponse.json({ ok: false, mensagem: notaErr.message }, { status: 400 })
    if (!nota || nota.company_id !== body.companyId) {
      return NextResponse.json({ ok: false, mensagem: 'Nota não encontrada nesta empresa' }, { status: 404 })
    }

    const negado = await guardaEmpresaFiscal({
      userId, companyId: body.companyId, papelMinimo: 'membro',
      log: { notaTipo: 'nfse', operacao: 'gerar_financeiro', endpoint: 'nfse/gerar-financeiro' },
    })
    if (negado) return negado

    const r = body.retencoes ?? {}
    const { data, error } = await supabaseAdmin.rpc('fn_nfse_gerar_financeiro', {
      p_nfse_id: body.nfseId,
      p_deducoes: num(body.deducoes),
      p_desconto: num(body.descontoIncondicionado),
      p_iss_retido: num(r.iss),
      p_irrf: num(r.irrf),
      p_pis: num(r.pis),
      p_cofins: num(r.cofins),
      p_csll: num(r.csll),
      p_inss: num(r.inss),
      p_primeiro_vencimento: body.primeiroVencimento || null,
    })
    if (error) return NextResponse.json({ ok: false, mensagem: error.message }, { status: 400 })

    const res = (data ?? {}) as { ok?: boolean; erro?: string }
    if (res.ok === false) {
      // idempotência (financeiro_ja_gerado), nota não autorizada, etc. → 409/422 conforme o motivo
      const status = res.erro === 'financeiro_ja_gerado' ? 409 : 422
      return NextResponse.json({ ...res, mensagem: mensagemErro(res.erro) }, { status })
    }
    return NextResponse.json(res)
  } catch (err) {
    return NextResponse.json({ ok: false, mensagem: (err as Error)?.message ?? 'Erro interno' }, { status: 500 })
  }
})

function mensagemErro(erro?: string): string {
  switch (erro) {
    case 'financeiro_ja_gerado': return 'O financeiro desta nota já foi gerado.'
    case 'nota_nao_autorizada': return 'A nota ainda não está autorizada — gere o financeiro após a autorização.'
    case 'sem_permissao_empresa': return 'Sem permissão para esta empresa.'
    case 'nota_inexistente': return 'Nota não encontrada.'
    default: return erro ?? 'Não foi possível gerar o financeiro.'
  }
}
