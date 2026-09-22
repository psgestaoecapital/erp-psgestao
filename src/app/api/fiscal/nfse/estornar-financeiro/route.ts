import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// NFS-e primeiro → financeiro pelo LÍQUIDO · Etapa 2 (API).
// Estorna o contas a receber gerado por uma NFS-e (usado quando a nota é cancelada).
// Nunca apaga em silêncio: recusa se houver baixa (pago/parcial) — decisão humana no banco.

interface Body { companyId: string; nfseId: string; motivo?: string }

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json()) as Body
    if (!body.companyId || !body.nfseId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId e nfseId são obrigatórios' }, { status: 400 })
    }

    const { data: nota, error: notaErr } = await supabaseAdmin
      .from('erp_nfse_emitidas')
      .select('id, company_id')
      .eq('id', body.nfseId)
      .maybeSingle()
    if (notaErr) return NextResponse.json({ ok: false, mensagem: notaErr.message }, { status: 400 })
    if (!nota || nota.company_id !== body.companyId) {
      return NextResponse.json({ ok: false, mensagem: 'Nota não encontrada nesta empresa' }, { status: 404 })
    }

    const negado = await guardaEmpresaFiscal({
      userId, companyId: body.companyId, papelMinimo: 'membro',
      log: { notaTipo: 'nfse', operacao: 'estornar_financeiro', endpoint: 'nfse/estornar-financeiro' },
    })
    if (negado) return negado

    const { data, error } = await supabaseAdmin.rpc('fn_nfse_estornar_financeiro', {
      p_nfse_id: body.nfseId,
      p_motivo: (typeof body.motivo === 'string' && body.motivo.trim()) ? body.motivo.trim() : null,
    })
    if (error) return NextResponse.json({ ok: false, mensagem: error.message }, { status: 400 })

    const res = (data ?? {}) as { ok?: boolean; erro?: string; aviso?: string }
    if (res.ok === false) {
      const status = res.erro === 'titulo_com_baixa' ? 409 : 422
      return NextResponse.json({ ...res, mensagem: res.aviso ?? mensagemErro(res.erro) }, { status })
    }
    return NextResponse.json(res)
  } catch (err) {
    return NextResponse.json({ ok: false, mensagem: (err as Error)?.message ?? 'Erro interno' }, { status: 500 })
  }
})

function mensagemErro(erro?: string): string {
  switch (erro) {
    case 'titulo_com_baixa': return 'Há título já recebido (total/parcial) ligado a esta nota. Trate a baixa antes de estornar.'
    case 'sem_permissao_empresa': return 'Sem permissão para esta empresa.'
    case 'nota_inexistente': return 'Nota não encontrada.'
    default: return erro ?? 'Não foi possível estornar o financeiro.'
  }
}
