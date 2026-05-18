'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { PSGC_COLORS, PSGC_RADIUS, fmtR } from '@/lib/psgc-tokens'
import PSGCMetric from '@/components/psgc/PSGCMetric'

type ModuloProximo = { id: string; nome: string; rota: string; status: string }

type HubKpis = {
  clientes_ativos: number
  jobs_em_andamento: number
  jobs_concluidos_mes?: number
  horas_mes: number
  receita_fee_mensal: number
  briefings_pendentes?: number
  briefings_total?: number
  propostas_em_aberto?: number
  propostas_total?: number
  tem_workspace_pronto: boolean
  workspace_url?: string
  empty_state: boolean
  mensagem_empty?: string
  modulos_proximos?: ModuloProximo[]
}

export default function PmHubPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const [kpis, setKpis] = useState<HubKpis | null>(null)
  const [loading, setLoading] = useState(true)

  // O RPC fn_pm_hub_kpis opera por empresa única. Consolidado/grupo → null,
  // o próprio RPC devolve o empty_state com mensagem.
  const empresaUnica =
    selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  // useCompanyIds recria o array a cada render — estabiliza pelo CSV ordenado.
  const companyIdsKey = useMemo(
    () => [...(companyIds ?? [])].sort().join(','),
    [companyIds],
  )

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase.rpc('fn_pm_hub_kpis', {
        p_company_id: empresaUnica,
      })
      if (ignore) return
      setKpis(error ? null : (data as HubKpis))
      setLoading(false)
    })()
    return () => {
      ignore = true
    }
    // companyIdsKey cobre mudança de seleção; empresaUnica é derivado dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey])

  const briefings = kpis?.briefings_pendentes ?? kpis?.briefings_total ?? 0
  const propostas = kpis?.propostas_em_aberto ?? kpis?.propostas_total ?? 0
  const modulos = kpis?.modulos_proximos ?? []

  return (
    <div style={{ backgroundColor: PSGC_COLORS.offWhite, minHeight: '100vh', color: PSGC_COLORS.espresso }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: PSGC_COLORS.dourado, margin: 0 }}>
            P&amp;M
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
            Hub de Produção &amp; Marketing
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: PSGC_COLORS.espressoLight }}>
            {selInfo.tipo === 'empresa' ? selInfo.nome : 'Clientes, jobs, horas e fee da agência.'}
          </p>
        </header>

        {loading && (
          <div style={{ padding: 48, textAlign: 'center', color: PSGC_COLORS.espressoLight, background: 'white', borderRadius: PSGC_RADIUS.xl, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            Carregando KPIs…
          </div>
        )}

        {!loading && kpis?.empty_state && (
          <div style={{ padding: 48, textAlign: 'center', background: 'white', borderRadius: PSGC_RADIUS.xl, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
            <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '0 0 6px', color: PSGC_COLORS.espresso }}>
              {kpis.mensagem_empty || 'Sem dados ainda'}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: PSGC_COLORS.espressoLight }}>
              {kpis.mensagem_empty
                ? 'Use o seletor de empresa no topo para escolher uma agência.'
                : 'Cadastre clientes e jobs para começar a acompanhar a operação.'}
            </p>
          </div>
        )}

        {!loading && kpis && !kpis.empty_state && (
          <>
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
              <PSGCMetric label="Clientes ativos" valor={kpis.clientes_ativos} icon="👥" />
              <PSGCMetric label="Jobs em andamento" valor={kpis.jobs_em_andamento} icon="🎯" />
              <PSGCMetric label="Concluídos no mês" valor={kpis.jobs_concluidos_mes ?? 0} icon="✅" />
              <PSGCMetric label="Horas no mês" valor={Number(kpis.horas_mes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} icon="⏱️" />
              <PSGCMetric
                label="Receita fee mensal"
                valor={fmtR(kpis.receita_fee_mensal)}
                icon="💰"
                cor={PSGC_COLORS.dourado}
                destaque
              />
              <PSGCMetric label="Briefings pendentes" valor={briefings} icon="📝" />
              <PSGCMetric label="Propostas em aberto" valor={propostas} icon="📄" />
            </section>

            {kpis.tem_workspace_pronto && kpis.workspace_url && (
              <section style={{ marginBottom: 24 }}>
                <Link
                  href={kpis.workspace_url}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 20px',
                    borderRadius: PSGC_RADIUS.md,
                    backgroundColor: PSGC_COLORS.espresso,
                    color: 'white',
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Abrir workspace de produção →
                </Link>
              </section>
            )}

            {modulos.length > 0 && (
              <section style={{ backgroundColor: 'white', borderRadius: PSGC_RADIUS.xl, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${PSGC_COLORS.offWhiteDarker}` }}>
                  <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, margin: 0 }}>
                    Módulos próximos
                  </h2>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: PSGC_COLORS.espressoLight }}>
                    No roteiro de evolução do hub P&amp;M
                  </p>
                </div>
                <div>
                  {modulos.map((m, i) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '14px 20px',
                        borderTop: i === 0 ? 'none' : `1px solid ${PSGC_COLORS.offWhiteDark}`,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: PSGC_COLORS.espresso }}>{m.nome}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          textTransform: 'uppercase',
                          padding: '3px 10px',
                          borderRadius: 999,
                          backgroundColor: PSGC_COLORS.offWhiteDark,
                          color: PSGC_COLORS.espressoLight,
                        }}
                      >
                        {m.status === 'previsto' ? 'Previsto' : m.status}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
