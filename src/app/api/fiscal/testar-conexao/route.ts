import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createFiscalService } from '@/lib/fiscal/service'
import { isFiscalError } from '@/lib/fiscal/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuth(async (req: NextRequest) => {
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

    const svc = await createFiscalService(companyId)
    const resultado = await svc.testarConexao()

    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502 })
  } catch (err) {
    if (isFiscalError(err)) {
      return NextResponse.json(err.toJSON(), { status: 502 })
    }
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ ok: false, mensagem: msg }, { status: 500 })
  }
})
