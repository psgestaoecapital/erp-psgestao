// PS Gestão ERP — GET /api/connectors/status
// Lista todas as empresas ativas × conectores, com resumo de paridade.
// Sem custo de API externa — só lê company_data_sources / companies /
// data_sources. Feito pra alimentar o painel /admin/conectores.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function pegarEmbed<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? val[0] ?? null : val
}

// Resumo por módulo a partir de paridade_detalhes (jsonb array).
function resumirModulos(det: any): {
  total: number
  ok: number
  divergentes: number
  erros: number
  por_modulo: { module: string; ok: boolean; source_count: number; erp_count: number }[]
} {
  const arr = Array.isArray(det) ? det : []
  let ok = 0
  let divergentes = 0
  let erros = 0
  const porModulo: any[] = []
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue
    const sc = Number(r.source_count)
    const ec = Number(r.erp_count)
    if (sc < 0 || ec < 0) erros++
    else if (r.ok) ok++
    else divergentes++
    porModulo.push({
      module: String(r.module ?? '?'),
      ok: !!r.ok,
      source_count: isFinite(sc) ? sc : -1,
      erp_count: isFinite(ec) ? ec : -1,
    })
  }
  return { total: arr.length, ok, divergentes, erros, por_modulo: porModulo }
}

// Status efetivo priorizando rate_limited e nunca_executada.
function calcularStatus(v: any): 'ok' | 'divergencia' | 'nunca_executada' | 'rate_limited' {
  const bloqAte = v.rate_limit_bloqueado_ate
    ? new Date(v.rate_limit_bloqueado_ate).getTime()
    : 0
  if (bloqAte > Date.now()) return 'rate_limited'
  if (!v.ultima_reconciliacao_em) return 'nunca_executada'
  if (v.paridade_status === 'rate_limited') return 'rate_limited'
  if (v.paridade_status === 'divergencia') return 'divergencia'
  return 'ok'
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id')
    const sourceSlug = url.searchParams.get('source_slug')

    let q = supabase
      .from('company_data_sources')
      .select(
        'id, company_id, modules_ativos, ' +
          'paridade_status, paridade_detalhes, ultima_reconciliacao_em, ' +
          'rate_limit_bloqueado_ate, rate_limit_motivo, ' +
          'ultimo_sync_em, ultimo_sync_status, ' +
          'companies!inner(id, nome_fantasia, razao_social), ' +
          'data_sources!inner(slug, nome)'
      )
      .eq('ativo', true)
    if (companyId) q = q.eq('company_id', companyId)
    if (sourceSlug) q = q.eq('data_sources.slug', sourceSlug)

    const { data, error } = await q
    if (error) {
      return NextResponse.json(
        { ok: false, error: `select company_data_sources: ${error.message}` },
        { status: 500 }
      )
    }

    const linhas = (data as any[] | null) ?? []
    const conectores = linhas.map((v) => {
      const empresa: any = pegarEmbed(v.companies)
      const fonte: any = pegarEmbed(v.data_sources)
      const status = calcularStatus(v)
      const resumo = resumirModulos(v.paridade_detalhes)
      return {
        company_data_source_id: v.id,
        company_id: v.company_id,
        empresa: {
          id: empresa?.id ?? v.company_id,
          nome_fantasia: empresa?.nome_fantasia ?? '',
          razao_social: empresa?.razao_social ?? '',
        },
        conector: {
          slug: fonte?.slug ?? '',
          nome: fonte?.nome ?? '',
        },
        modules_ativos: v.modules_ativos ?? [],
        status,
        paridade_status: v.paridade_status,
        ultima_reconciliacao_em: v.ultima_reconciliacao_em,
        ultimo_sync_em: v.ultimo_sync_em,
        ultimo_sync_status: v.ultimo_sync_status,
        rate_limit_bloqueado_ate: v.rate_limit_bloqueado_ate,
        rate_limit_motivo: v.rate_limit_motivo,
        rate_limit_segundos_restantes: v.rate_limit_bloqueado_ate
          ? Math.max(
              0,
              Math.round((new Date(v.rate_limit_bloqueado_ate).getTime() - Date.now()) / 1000)
            )
          : null,
        resumo,
      }
    })

    // Ordena: rate_limited/divergencia primeiro, depois por nome da empresa.
    const prioridade: Record<string, number> = {
      rate_limited: 0,
      divergencia: 1,
      nunca_executada: 2,
      ok: 3,
    }
    conectores.sort((a, b) => {
      const pa = prioridade[a.status] ?? 4
      const pb = prioridade[b.status] ?? 4
      if (pa !== pb) return pa - pb
      return (a.empresa.nome_fantasia || '').localeCompare(b.empresa.nome_fantasia || '')
    })

    const totais = {
      total: conectores.length,
      ok: conectores.filter((c) => c.status === 'ok').length,
      divergencia: conectores.filter((c) => c.status === 'divergencia').length,
      nunca_executada: conectores.filter((c) => c.status === 'nunca_executada').length,
      rate_limited: conectores.filter((c) => c.status === 'rate_limited').length,
    }

    return NextResponse.json({ ok: true, totais, conectores })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
