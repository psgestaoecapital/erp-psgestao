// PS Gestão ERP — Endpoint de reconciliação de conectores.
//
// POST /api/connectors/reconcile
//   Body: { company_id: string, source_slug?: string }
//   Executa reconciliação síncrona (módulos em SÉRIE, não paralelo).
//   Gera bpo_alertas em divergências e detecta órfãos em clientes/pagar/receber.
//
// GET  /api/connectors/reconcile?company_id=X[&source_slug=Y]
//   Lê apenas paridade_status / paridade_detalhes / ultima_reconciliacao_em
//   de company_data_sources. Não dispara nenhuma chamada externa.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reconcileCompany, pegarSlug } from '@/lib/connectors/reconciler'
// Side-effect: registra os adapters no registry.
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

// ─── POST — executa reconciliação ─────────────────────────────────────
export async function POST(req: Request) {
  const inicio = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    const { company_id, source_slug } = body as {
      company_id?: string
      source_slug?: string
    }
    if (!company_id) {
      return NextResponse.json(
        { ok: false, error: 'company_id obrigatório' },
        { status: 400 }
      )
    }

    const baseUrl = baseUrlFromRequest(req)
    const result = await reconcileCompany(company_id, source_slug ?? null, supabase, baseUrl)

    return NextResponse.json({
      ok: result.ok,
      reports: result.reports,
      paridade_geral: result.paridade_geral,
      duracao_ms: result.duracao_ms,
      error: result.error,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message, duracao_ms: Date.now() - inicio },
      { status: 500 }
    )
  }
}

// ─── GET — só leitura do último status conhecido ──────────────────────
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id')
    const sourceSlug = url.searchParams.get('source_slug')
    if (!companyId) {
      return NextResponse.json(
        { ok: false, error: 'company_id obrigatório (?company_id=...)' },
        { status: 400 }
      )
    }

    let q = supabase
      .from('company_data_sources')
      .select(
        'id, modules_ativos, paridade_status, paridade_detalhes, ultima_reconciliacao_em, ' +
          'ultimo_sync_em, ultimo_sync_status, data_sources!inner(slug, nome)'
      )
      .eq('company_id', companyId)
      .eq('ativo', true)
    if (sourceSlug) q = q.eq('data_sources.slug', sourceSlug)

    const { data, error } = await q
    if (error) {
      return NextResponse.json(
        { ok: false, error: `select company_data_sources: ${error.message}` },
        { status: 500 }
      )
    }

    const lista = (data as any[] | null) ?? []
    const reports = lista.map((v: any) => ({
      slug: pegarSlug(v),
      modules_ativos: v.modules_ativos ?? [],
      paridade_status: v.paridade_status ?? 'desconhecido',
      ultima_reconciliacao_em: v.ultima_reconciliacao_em,
      ultimo_sync_em: v.ultimo_sync_em,
      ultimo_sync_status: v.ultimo_sync_status,
      paridade_detalhes: v.paridade_detalhes,
    }))

    const paridadeGeral = reports.every(
      (r) => r.paridade_status === 'ok' || r.paridade_status === 'desconhecido'
    )
      ? 'ok'
      : 'divergencia'

    return NextResponse.json({
      ok: true,
      company_id: companyId,
      paridade_geral: paridadeGeral,
      reports,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
