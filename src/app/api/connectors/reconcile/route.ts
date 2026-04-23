// PS Gestão ERP — Endpoint genérico de reconciliação.
// POST /api/connectors/reconcile
// Body: { company_id: string, source_slug?: string }
//
// Para cada vínculo ativo em company_data_sources (filtrado por slug se
// fornecido), cria um run em data_source_runs, instancia o Connector via
// registry e chama reconcileModule() pra cada módulo ativo. Atualiza
// company_data_sources com paridade_status/paridade_detalhes e o run com
// resultado/status.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getConnector } from '@/lib/connectors/base'
// Side-effect: garante que os adapters estão registrados antes de getConnector.
import '@/lib/connectors/registry'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Vinculo = {
  id: string
  modules_ativos: string[] | null
  credentials_encrypted: Record<string, any> | null
  data_sources: { slug: string; nome: string } | { slug: string; nome: string }[] | null
}

function pegarSlug(v: Vinculo): string | null {
  const ds = v.data_sources
  if (!ds) return null
  if (Array.isArray(ds)) return ds[0]?.slug ?? null
  return ds.slug ?? null
}

export async function POST(req: Request) {
  const inicio = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    const { company_id, source_slug } = body as { company_id?: string; source_slug?: string }
    if (!company_id) {
      return NextResponse.json(
        { ok: false, error: 'company_id obrigatório' },
        { status: 400 }
      )
    }

    let q = supabase
      .from('company_data_sources')
      .select('id, modules_ativos, credentials_encrypted, data_sources!inner(slug, nome)')
      .eq('company_id', company_id)
      .eq('ativo', true)
    if (source_slug) {
      q = q.eq('data_sources.slug', source_slug)
    }
    const { data: vinculos, error } = await q
    if (error) throw new Error(`select company_data_sources: ${error.message}`)
    const lista = (vinculos as Vinculo[] | null) ?? []
    if (lista.length === 0) {
      return NextResponse.json({
        ok: true,
        reports: [],
        paridade_geral: 'ok',
        duracao_ms: Date.now() - inicio,
        message: 'nenhum conector ativo encontrado para esta empresa',
      })
    }

    // Origem da chamada para o fetch interno dentro de syncModule (sprint 2).
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const host = req.headers.get('host') || 'localhost:3000'
    const baseUrl = `${proto}://${host}`

    const reports: any[] = []
    let paridadeGeral: 'ok' | 'divergencia' = 'ok'

    for (const v of lista) {
      const slug = pegarSlug(v)
      const modules = v.modules_ativos ?? []
      if (!slug || modules.length === 0) {
        reports.push({
          slug,
          paridade_status: 'pulado',
          motivo: !slug ? 'sem data_source vinculado' : 'modules_ativos vazio',
        })
        continue
      }

      const inicioRun = Date.now()
      const { data: run } = await supabase
        .from('data_source_runs')
        .insert({
          company_data_source_id: v.id,
          company_id,
          data_source_slug: slug,
          tipo: 'reconcile',
          status: 'executando',
          trigger_type: 'manual',
        })
        .select('id')
        .single()
      const runId = (run as any)?.id ?? null

      const connector = getConnector(slug, {
        companyId: company_id,
        companyDataSourceId: v.id,
        credentials: v.credentials_encrypted ?? {},
        supabase,
        baseUrl,
      })
      if (!connector) {
        const msg = `connector '${slug}' não registrado`
        if (runId) {
          await supabase
            .from('data_source_runs')
            .update({
              status: 'erro',
              erro_mensagem: msg,
              finalizado_em: new Date().toISOString(),
              duracao_ms: Date.now() - inicioRun,
            })
            .eq('id', runId)
        }
        reports.push({ slug, paridade_status: 'erro', motivo: msg })
        paridadeGeral = 'divergencia'
        continue
      }

      const reportsModulo: any[] = []
      let erroFatal: string | null = null

      for (const m of modules) {
        try {
          const r = await connector.reconcileModule(m)
          reportsModulo.push(r)
          if (!r.ok) paridadeGeral = 'divergencia'
        } catch (e: any) {
          reportsModulo.push({
            module: m,
            ok: false,
            source_count: -1,
            erp_count: -1,
            details: e.message,
          })
          erroFatal = e.message
          paridadeGeral = 'divergencia'
        }
      }

      const paridadeStatus = reportsModulo.every((r) => r.ok) ? 'ok' : 'divergencia'

      await supabase
        .from('company_data_sources')
        .update({
          ultima_reconciliacao_em: new Date().toISOString(),
          paridade_status: paridadeStatus,
          paridade_detalhes: reportsModulo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', v.id)

      if (runId) {
        await supabase
          .from('data_source_runs')
          .update({
            status: erroFatal ? 'erro' : 'sucesso',
            finalizado_em: new Date().toISOString(),
            duracao_ms: Date.now() - inicioRun,
            resultado: reportsModulo,
            erro_mensagem: erroFatal,
          })
          .eq('id', runId)
      }

      reports.push({
        slug,
        paridade_status: paridadeStatus,
        run_id: runId,
        modulos: reportsModulo,
      })
    }

    return NextResponse.json({
      ok: true,
      reports,
      paridade_geral: paridadeGeral,
      duracao_ms: Date.now() - inicio,
    })
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e.message,
        duracao_ms: Date.now() - inicio,
      },
      { status: 500 }
    )
  }
}
