import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { avaliarCertificadoFocus } from '@/lib/fiscal/focusConferencia'
import { dataBrasil } from '@/lib/fiscal/dataBrasil'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const { companyId } = (await req.json()) as { companyId?: string }

    if (!companyId || typeof companyId !== 'string') {
      return NextResponse.json(
        { ok: false, mensagem: 'companyId obrigatorio' },
        { status: 400 }
      )
    }

    if (companyId === 'consolidado' || companyId.startsWith('group_')) {
      return NextResponse.json(
        { ok: false, mensagem: 'Selecione 1 empresa (nao consolidado ou grupo)' },
        { status: 400 }
      )
    }

    const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'membro', log: { notaTipo: 'nfe', operacao: 'testar_conexao', endpoint: 'testar-conexao' } })
    if (negado) return negado

    const svc = await createFiscalService(companyId)
    const resultado = await svc.testarConexao()

    // #1944 · validar o certificado NA FOCUS de verdade (antes o teste só listava /v2/empresas e dizia "certificado
    // válido" sem olhar o certificado). Lê o cadastro da empresa na Focus (só leitura) e GRAVA o resultado — a
    // configuração (ultima_validacao_*) e o certificado ativo (ultima_validacao_focus_*) deixam de ficar "nunca validado".
    if (resultado.apiAlcancavel) {
      const { data: comp } = await supabaseAdmin.from('companies').select('cnpj').eq('id', companyId).maybeSingle()
      const cnpj = String(comp?.cnpj ?? '').replace(/\D/g, '')
      let focusEmpresa: Record<string, unknown> | null = null
      let erroFocus: string | null = null
      try { focusEmpresa = cnpj ? await svc.obterEmpresaFocus(cnpj) : null } catch (e) { erroFocus = e instanceof Error ? e.message : String(e) }
      const cert = erroFocus
        ? { ok: null, validoAte: null, mensagem: `Não foi possível ler o cadastro da empresa na Focus: ${erroFocus}` }
        : avaliarCertificadoFocus(focusEmpresa, cnpj, dataBrasil())
      resultado.certificadoOk = cert.ok === true
      resultado.ok = resultado.ok && cert.ok === true
      resultado.mensagem = `${resultado.mensagem} · ${cert.mensagem}`
      resultado.detalhes = { ...(resultado.detalhes ?? {}), certificadoFocus: cert }
      const agora = new Date().toISOString()
      await supabaseAdmin.from('erp_fiscal_provider_config')
        .update({ ultima_validacao_em: agora, ultima_validacao_resultado: { ok: resultado.ok, api: resultado.apiAlcancavel, certificado: cert, por: userId } })
        .eq('company_id', companyId).eq('ativo', true)
      if (cert.ok !== null) {
        await supabaseAdmin.from('erp_certificados_a1')
          .update({ ultima_validacao_focus_em: agora, ultima_validacao_focus_ok: cert.ok, ultima_validacao_focus_erro: cert.ok ? null : cert.mensagem })
          .eq('company_id', companyId).eq('status', 'ativo')
      }
    }

    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502 })
  } catch (err) {
    if (isFiscalError(err)) {
      return NextResponse.json(err.toJSON(), { status: 502 })
    }
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ ok: false, mensagem: msg }, { status: 500 })
  }
})
