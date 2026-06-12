// FEAT-NFE-DIAGNOSTICO-FOCUS-v1
// GET read-only · zero emissao · revela se o token autentica e se a empresa
// tem NF-e habilitada em producao. Sanitiza (so flags, sem token/cert).

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const companyId = req.nextUrl.searchParams.get('companyId')
    if (!companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    const svc = await createFiscalService(companyId)
    const diag = await svc.diagnosticoEmpresas()
    const alvo = diag.empresas.find((e) => e.cnpj.replace(/\D/g, '') === '55081828000103') ?? null
    return NextResponse.json(
      {
        ok: true,
        autenticou: diag.autenticou,
        status_focus: diag.status,
        total_empresas_na_conta: diag.empresas.length,
        kgf_encontrada: !!alvo,
        kgf: alvo,
      },
      { status: 200 },
    )
  } catch (err) {
    if (isFiscalError(err)) return NextResponse.json(err.toJSON(), { status: 502 })
    return NextResponse.json(
      { ok: false, mensagem: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    )
  }
})
