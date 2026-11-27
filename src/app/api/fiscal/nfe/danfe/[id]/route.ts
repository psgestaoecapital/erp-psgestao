import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { gerarDanfePdf } from '@/lib/fiscal/danfePdf'
import { danfeDeNotaEmitida, type NotaEmitidaRow } from '@/lib/fiscal/danfeDados'
import { carregarEmitenteDanfe } from '@/lib/fiscal/danfeEmitente'
import { isoBrasilia } from '@/lib/fiscal/dataBrasil'

// Chamado #11234 — DANFE da nota AUTORIZADA no mesmo leiaute oficial do espelho (src/lib/fiscal/danfePdf.ts), desenhado a partir
// do que ficou gravado na emissão (erp_nfe_emitidas: itens, valores, chave, protocolo). Só leitura: não transmite, não altera a
// nota nem o XML. Nota sem protocolo (processando/rejeitada) não gera DANFE por aqui — o espelho de conferência cobre esse caso.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withAuth(async (
  _req: NextRequest,
  { userId },
  routeCtx?: { params: Promise<{ id: string }> },
) => {
  try {
    const params = await routeCtx?.params
    if (!params?.id) return NextResponse.json({ ok: false, mensagem: 'ID obrigatorio' }, { status: 400 })

    const { data } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, numero, serie, chave, protocolo, data_emissao, natureza_operacao, status, valor_total, valor_produtos, valor_frete, valor_desconto, valor_icms, valor_ipi, valor_pis, valor_cofins, emitente_cnpj, emitente_razao_social, emitente_inscricao_estadual, destinatario_cnpj, destinatario_cpf, destinatario_razao_social, destinatario_endereco, itens, payload_enviado, provider_raw')
      .eq('id', params.id)
      .maybeSingle()
    if (!data) return NextResponse.json({ ok: false, mensagem: 'NFe nao encontrada' }, { status: 404 })
    const nota = data as unknown as NotaEmitidaRow & { id: string; company_id: string; provider_raw?: { protocolo?: string | null } | null }

    const negado = await guardaEmpresaFiscal({ userId, companyId: nota.company_id, papelMinimo: 'membro', log: { notaTipo: 'nfe', notaId: params.id, operacao: 'danfe_pdf', endpoint: 'nfe/danfe' } })
    if (negado) return negado

    // O protocolo de autorização vem da COLUNA; quando ela está vazia (muitas notas autorizadas ficaram sem gravar),
    // cai para provider_raw->>'protocolo' (a resposta crua da Focus sempre o traz). Sem isto, a nota autorizada com
    // chave mas sem a coluna caía no 409 e o "Abrir PDF" mostrava o DANFE do provedor, fora do nosso leiaute.
    const protocoloEfetivo = (nota.protocolo ?? '').trim() || String(nota.provider_raw?.protocolo ?? '').trim()
    nota.protocolo = protocoloEfetivo || null

    if (nota.status !== 'autorizada' || !protocoloEfetivo || String(nota.chave ?? '').replace(/\D/g, '').length !== 44) {
      return NextResponse.json({ ok: false, mensagem: 'O DANFE só existe para nota autorizada (com chave e protocolo).' }, { status: 409 })
    }
    if (!Array.isArray(nota.itens) || nota.itens.length === 0) {
      return NextResponse.json({ ok: false, mensagem: 'Esta nota não tem os itens gravados para montar o DANFE.' }, { status: 422 })
    }

    const emitente = await carregarEmitenteDanfe(nota.company_id)
    const { data: emp } = await supabaseAdmin.from('companies').select('regime_tributario').eq('id', nota.company_id).maybeSingle()
    const simples = String((emp as { regime_tributario?: string } | null)?.regime_tributario ?? '').toLowerCase().includes('simples')

    const bytes = await gerarDanfePdf(danfeDeNotaEmitida(nota, emitente, { simples }), { impressoEmISO: isoBrasilia().slice(0, 16) })
    const num = String(nota.numero ?? '').replace(/\D/g, '') || 'nota'
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="danfe_${num}.pdf"`, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ ok: false, mensagem: msg }, { status: 500 })
  }
})
