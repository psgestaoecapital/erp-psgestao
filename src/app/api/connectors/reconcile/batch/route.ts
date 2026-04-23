// PS Gestão ERP — Reconciliação em lote.
//
// POST /api/connectors/reconcile/batch
//   Body: { company_ids: string[], source_slug?: string }
//
// Reconcilia as empresas em SEQUÊNCIA (não paralelo) reusando a função
// reconcileCompany da rota individual. Ideal para rodar o grupo Tryo +
// Gean de uma vez sem estourar rate limit do Omie.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reconcileCompany } from '@/lib/connectors/reconciler'
// Side-effect: registra os adapters.
import '@/lib/connectors/registry'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function baseUrlFromRequest(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

export async function POST(req: Request) {
  const inicio = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    const { company_ids, source_slug } = body as {
      company_ids?: string[]
      source_slug?: string
    }
    if (!Array.isArray(company_ids) || company_ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'company_ids obrigatório (array não vazio)' },
        { status: 400 }
      )
    }
    // Sanidade: limitar o tamanho do lote pra não passar do maxDuration.
    if (company_ids.length > 50) {
      return NextResponse.json(
        { ok: false, error: 'máximo 50 empresas por chamada' },
        { status: 400 }
      )
    }

    const baseUrl = baseUrlFromRequest(req)
    const results: any[] = []

    for (const companyId of company_ids) {
      try {
        const r = await reconcileCompany(companyId, source_slug ?? null, supabase, baseUrl)
        results.push(r)
      } catch (e: any) {
        results.push({
          company_id: companyId,
          ok: false,
          paridade_geral: 'divergencia',
          reports: [],
          error: e.message,
        })
      }
    }

    const totais = {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      com_divergencia: results.filter((r) => r.paridade_geral === 'divergencia').length,
      com_erro: results.filter((r) => !r.ok).length,
    }

    return NextResponse.json({
      ok: true,
      totais,
      results,
      duracao_ms: Date.now() - inicio,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message, duracao_ms: Date.now() - inicio },
      { status: 500 }
    )
  }
}
