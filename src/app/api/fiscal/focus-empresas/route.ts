// POST /api/fiscal/focus-empresas — conferência do cadastro da empresa no FOCUS × nossa config local.
// Existe porque nunca damos PUT em /v2/empresas (só GET) e a Focus CARIMBA no DPS o que está no cadastro
// dela (regime/optante, série, IM). Uma DIVERGÊNCIA entre Focus e local vira rejeição na emissão — foi o
// que injetou o pTotTribSN no E0713 da FC (regime normal no nosso lado, provável "optante" no cadastro
// Focus) e a provável causa do E0010 de série. Só leitura; nada é escrito na Focus.
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { createFiscalService } from '@/lib/fiscal/service'
import { compararFocusLocal, type LocalFiscalConfig } from '@/lib/fiscal/focusConferencia'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 25

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = await req.json().catch(() => ({}))
    const companyId = typeof body?.companyId === 'string' ? body.companyId : ''
    if (!companyId) return NextResponse.json({ ok: false, erro: 'companyId ausente' }, { status: 400 })

    const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'membro', log: { notaTipo: 'nfse', operacao: 'focus_conferencia', endpoint: 'fiscal/focus-empresas' } })
    if (negado) return negado

    // Config local (a que MANDAMOS) + IM da empresa.
    const { data: cfg } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('regime_tributario, opcao_simples_nacional, serie_nfse_padrao')
      .eq('company_id', companyId).eq('provider', 'focusnfe').eq('ativo', true)
      .maybeSingle()
    const { data: comp } = await supabaseAdmin
      .from('companies').select('cnpj, inscricao_municipal').eq('id', companyId).maybeSingle()

    if (!comp?.cnpj) {
      return NextResponse.json({ ok: false, erro: 'CNPJ da empresa não encontrado' }, { status: 400 })
    }

    const local: LocalFiscalConfig = {
      regime_tributario: (cfg?.regime_tributario as string | null) ?? null,
      opcao_simples_nacional: (cfg?.opcao_simples_nacional as number | null) ?? null,
      serie_nfse_padrao: (cfg?.serie_nfse_padrao as string | null) ?? null,
      inscricao_municipal: (comp.inscricao_municipal as string | null) ?? null,
    }

    // Cadastro no Focus (só leitura). createFiscalService pode lançar se faltar cert/config.
    let focusEmpresa: Record<string, unknown> | null = null
    let focusErro: string | null = null
    try {
      const svc = await createFiscalService(companyId)
      focusEmpresa = await svc.obterEmpresaFocus(String(comp.cnpj).replace(/\D/g, ''))
    } catch (e) {
      focusErro = isFiscalError(e) ? e.message : (e instanceof Error ? e.message : String(e))
    }

    if (!focusEmpresa) {
      return NextResponse.json({
        ok: true, presente: false, divergencias: 0, campos: [],
        erro: focusErro ?? 'Empresa não encontrada no cadastro do Focus (verifique se o CNPJ está cadastrado lá).',
      })
    }

    const { campos, divergencias } = compararFocusLocal(focusEmpresa, local)
    return NextResponse.json({ ok: true, presente: true, divergencias, campos })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
})
