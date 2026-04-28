// PS Gestão ERP — Core da reconciliação genérica de conectores.
// Este módulo extrai a lógica por empresa para ser reutilizada tanto pela
// rota individual (/api/connectors/reconcile) quanto pela rota em lote
// (/api/connectors/reconcile/batch).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getConnector, type Connector } from './base'
import { OmieRateLimitError } from '@/lib/omieClient'

// Tempo de cache padrão entre reconciliações quando force=false.
const CACHE_TTL_MINUTES = 60

// Módulos onde faz sentido detectar órfãos via listSourceIds.
const MODULOS_COM_ORFAOS = new Set(['clientes', 'contas_pagar', 'contas_receber'])

// Mapeamento módulo → tabela ERP (espelha OmieConnector; usado só no
// detector de órfãos para puxar os IDs do ERP).
const MODULO_TABELA_ERP: Record<string, string> = {
  clientes: 'erp_clientes',
  contas_pagar: 'erp_pagar',
  contas_receber: 'erp_receber',
}

type Vinculo = {
  id: string
  modules_ativos: string[] | null
  credentials_encrypted: Record<string, any> | null
  rate_limit_bloqueado_ate: string | null
  rate_limit_motivo: string | null
  ultima_reconciliacao_em: string | null
  paridade_status: string | null
  paridade_detalhes: any
  data_sources: { slug: string; nome: string } | { slug: string; nome: string }[] | null
}

export type OrfaosResult = {
  module: string
  sample_size: number
  erp_total: number
  only_in_erp_count: number
  only_in_omie_count: number
  only_in_erp_sample: string[]
  only_in_omie_sample: string[]
  note: string
}

export type ReconcileCompanyResult = {
  company_id: string
  ok: boolean
  paridade_geral: 'ok' | 'divergencia'
  reports: any[]
  duracao_ms: number
  error?: string
}

export function pegarSlug(v: Vinculo): string | null {
  const ds = v.data_sources
  if (!ds) return null
  if (Array.isArray(ds)) return ds[0]?.slug ?? null
  return ds.slug ?? null
}

async function detectarOrfaos(
  connector: Connector,
  companyId: string,
  supa: SupabaseClient,
  modulo: string
): Promise<OrfaosResult | null> {
  if (!MODULOS_COM_ORFAOS.has(modulo)) return null
  if (typeof connector.listSourceIds !== 'function') return null

  const tabela = MODULO_TABELA_ERP[modulo]
  if (!tabela) return null

  const sampleSize = 500
  const sourceIds = await connector.listSourceIds(modulo, sampleSize)
  const sourceSet = new Set(sourceIds)

  const erpIds: string[] = []
  let from = 0
  const page = 1000
  while (true) {
    const { data, error } = await supa
      .from(tabela)
      .select('ref_externa_id')
      .eq('company_id', companyId)
      .eq('ref_externa_sistema', 'OMIE')
      .not('ref_externa_id', 'is', null)
      .range(from, from + page - 1)
    if (error) break
    if (!data || data.length === 0) break
    for (const r of data) {
      const v = (r as any).ref_externa_id
      if (v != null && v !== '') erpIds.push(String(v))
    }
    if (data.length < page) break
    from += page
    if (from > 50000) break
  }
  const erpSet = new Set(erpIds)

  const onlyInErp: string[] = []
  for (const id of erpIds) if (!sourceSet.has(id)) onlyInErp.push(id)

  const onlyInOmie: string[] = []
  for (const id of sourceIds) if (!erpSet.has(id)) onlyInOmie.push(id)

  return {
    module: modulo,
    sample_size: sourceIds.length,
    erp_total: erpIds.length,
    only_in_erp_count: onlyInErp.length,
    only_in_omie_count: onlyInOmie.length,
    only_in_erp_sample: onlyInErp.slice(0, 100),
    only_in_omie_sample: onlyInOmie.slice(0, 100),
    note:
      'Comparação: últimos ' +
      sourceIds.length +
      ' IDs do Omie vs TODOS os IDs do ERP. "only_in_erp" pode conter registros mais antigos que a amostra Omie.',
  }
}

async function gravarAlertaDivergencia(
  supa: SupabaseClient,
  companyId: string,
  slug: string,
  report: {
    module: string
    source_count: number
    erp_count: number
    ok: boolean
    divergencias?: number
    details?: string
  }
): Promise<void> {
  if (report.ok) return
  if (report.source_count < 0 || report.erp_count < 0) return
  const diff = Math.abs(report.source_count - report.erp_count)
  const total = Math.max(report.source_count, report.erp_count, 1)
  const pct = (diff / total) * 100
  const severidade = pct > 1 ? 'alta' : 'media'
  const titulo =
    `Divergência ${report.module} (${slug}): Omie ${report.source_count} ` +
    `vs PS Gestão ${report.erp_count} (diff: ${diff})`
  const descricao =
    `Módulo: ${report.module}\n` +
    `Fonte (${slug}): ${report.source_count} registros\n` +
    `ERP (PS Gestão): ${report.erp_count} registros\n` +
    `Diferença absoluta: ${diff} (${pct.toFixed(2)}%)\n` +
    (report.details ? `Detalhes: ${report.details}` : '')
  try {
    await supa.from('bpo_alertas').insert({
      company_id: companyId,
      tipo: 'reconciliacao',
      severidade,
      titulo,
      descricao,
      acao_sugerida: 'Investigar IDs faltantes ou extras',
      status: 'pendente',
    })
  } catch (e: any) {
    console.error('[reconcile] falha ao gravar bpo_alertas:', e?.message)
  }
}

export type ReconcileOptions = {
  // Quando true, ignora cache e bloqueio não-expirado e força nova execução.
  force?: boolean
  // Override do TTL do cache em minutos (default CACHE_TTL_MINUTES).
  cacheTtlMinutes?: number
}

/**
 * Executa reconciliação para uma empresa. Usada pelas rotas
 * /api/connectors/reconcile (individual) e /batch (lote).
 */
export async function reconcileCompany(
  companyId: string,
  sourceSlugFilter: string | null,
  supa: SupabaseClient,
  baseUrl: string,
  options?: ReconcileOptions
): Promise<ReconcileCompanyResult> {
  const inicio = Date.now()
  const force = options?.force === true
  const ttlMin = options?.cacheTtlMinutes ?? CACHE_TTL_MINUTES

  let q = supa
    .from('company_data_sources')
    .select(
      'id, modules_ativos, credentials_encrypted, ' +
        'rate_limit_bloqueado_ate, rate_limit_motivo, ' +
        'ultima_reconciliacao_em, paridade_status, paridade_detalhes, ' +
        'data_sources!inner(slug, nome)'
    )
    .eq('company_id', companyId)
    .eq('ativo', true)
  if (sourceSlugFilter) q = q.eq('data_sources.slug', sourceSlugFilter)
  const { data: vinculos, error } = await q
  if (error) {
    return {
      company_id: companyId,
      ok: false,
      paridade_geral: 'divergencia',
      reports: [],
      duracao_ms: Date.now() - inicio,
      error: `select company_data_sources: ${error.message}`,
    }
  }
  // Cast via `unknown` porque o tipo inferido de `data` em selects com
  // embed (data_sources!inner(...)) inclui GenericStringError[] na union.
  // Já tratamos o `error` acima — aqui sabemos que é Vinculo[] | null.
  const lista = (vinculos as unknown as Vinculo[] | null) ?? []
  if (lista.length === 0) {
    return {
      company_id: companyId,
      ok: true,
      paridade_geral: 'ok',
      reports: [],
      duracao_ms: Date.now() - inicio,
    }
  }

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

    // Pre-check 1: bloqueio anti-boomerang. Se o Omie já disse que está
    // bloqueado até T, não chamamos antes disso (nem com force).
    const bloqueadoAte = v.rate_limit_bloqueado_ate
      ? new Date(v.rate_limit_bloqueado_ate)
      : null
    if (bloqueadoAte && bloqueadoAte.getTime() > Date.now()) {
      paridadeGeral = 'divergencia'
      reports.push({
        slug,
        paridade_status: 'rate_limited',
        bloqueado_ate: v.rate_limit_bloqueado_ate,
        motivo: v.rate_limit_motivo,
        modulos: [],
      })
      continue
    }

    // Pre-check 2: cache. Se reconciliação recente e force=false, devolve
    // o que já está em paridade_detalhes sem chamar a API externa.
    if (!force && v.ultima_reconciliacao_em) {
      const idadeMs = Date.now() - new Date(v.ultima_reconciliacao_em).getTime()
      const idadeMin = idadeMs / 60000
      if (idadeMin < ttlMin) {
        const cached = Array.isArray(v.paridade_detalhes) ? v.paridade_detalhes : []
        const cachedStatus = v.paridade_status === 'divergencia' ? 'divergencia' : 'ok'
        if (cachedStatus === 'divergencia') paridadeGeral = 'divergencia'
        reports.push({
          slug,
          paridade_status: cachedStatus,
          from_cache: true,
          cache_age_minutes: Math.round(idadeMin),
          modulos: cached,
        })
        continue
      }
    }

    const inicioRun = Date.now()
    const { data: run } = await supa
      .from('data_source_runs')
      .insert({
        company_data_source_id: v.id,
        company_id: companyId,
        data_source_slug: slug,
        tipo: 'reconcile',
        status: 'executando',
        trigger_type: 'manual',
      })
      .select('id')
      .single()
    const runId = (run as any)?.id ?? null

    const connector = getConnector(slug, {
      companyId: companyId,
      companyDataSourceId: v.id,
      credentials: v.credentials_encrypted ?? {},
      supabase: supa,
      baseUrl,
    })
    if (!connector) {
      const msg = `connector '${slug}' não registrado`
      if (runId) {
        await supa
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
    const orfaosPorModulo: Record<string, OrfaosResult | null> = {}
    let erroFatal: string | null = null
    let rateLimited: { bloqueado_ate: string | null; motivo: string | null } | null = null

    // Módulos em SÉRIE (não paralelo) — evita pico de rate limit Omie.
    for (const m of modules) {
      try {
        const r = await connector.reconcileModule(m)
        reportsModulo.push(r)
        if (!r.ok) {
          paridadeGeral = 'divergencia'
          await gravarAlertaDivergencia(supa, companyId, slug, r)
          if (MODULOS_COM_ORFAOS.has(m)) {
            try {
              const orf = await detectarOrfaos(connector, companyId, supa, m)
              if (orf) orfaosPorModulo[m] = orf
            } catch (e: any) {
              console.warn(`[reconcile] detectarOrfaos(${m}) falhou:`, e?.message)
            }
          }
        }
      } catch (e: any) {
        // Omie bloqueou explicitamente — aborta o resto dos módulos pra
        // não piorar o bloqueio. O connector já persistiu rate_limit_*.
        if (e instanceof OmieRateLimitError) {
          const bloqueadoAte = new Date(
            Date.now() + e.retryAfterSeconds * 1000
          ).toISOString()
          rateLimited = {
            bloqueado_ate: bloqueadoAte,
            motivo: e.faultstring || e.message,
          }
          reportsModulo.push({
            module: m,
            ok: false,
            source_count: -1,
            erp_count: -1,
            details: `Omie rate-limited até ${bloqueadoAte}: ${e.faultstring || e.message}`,
          })
          paridadeGeral = 'divergencia'
          break
        }
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

    const paridadeStatus = rateLimited
      ? 'rate_limited'
      : reportsModulo.every((r) => r.ok)
        ? 'ok'
        : 'divergencia'

    await supa
      .from('company_data_sources')
      .update({
        ultima_reconciliacao_em: new Date().toISOString(),
        paridade_status: paridadeStatus,
        paridade_detalhes: reportsModulo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', v.id)

    if (runId) {
      await supa
        .from('data_source_runs')
        .update({
          status: erroFatal || rateLimited ? 'erro' : 'sucesso',
          finalizado_em: new Date().toISOString(),
          duracao_ms: Date.now() - inicioRun,
          resultado: {
            modulos: reportsModulo,
            orfaos: orfaosPorModulo,
            rate_limited: rateLimited,
          },
          erro_mensagem: rateLimited
            ? `rate-limited até ${rateLimited.bloqueado_ate}: ${rateLimited.motivo}`
            : erroFatal,
        })
        .eq('id', runId)
    }

    reports.push({
      slug,
      paridade_status: paridadeStatus,
      run_id: runId,
      modulos: reportsModulo,
      orfaos: orfaosPorModulo,
      ...(rateLimited ? { rate_limited: rateLimited } : {}),
    })
  }

  return {
    company_id: companyId,
    ok: !reports.some((r) => r.paridade_status === 'erro'),
    paridade_geral: paridadeGeral,
    reports,
    duracao_ms: Date.now() - inicio,
  }
}
