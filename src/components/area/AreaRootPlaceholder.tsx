'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

// Card de area-raiz para planos novos (M.A.7.5).
// PS (equipe interna) ve o painel comercial (status/MRR/clientes/evolucao — vem da RPC so pra PS).
// CLIENTE ve uma home UTIL: atalhos reais das telas da area (fn_modulos_sidebar_por_area).
// NUNCA renderiza MRR / clientes ativos / % adocao / badge piloto / "em breve" pro cliente
// (dado comercial interno da PS — a RPC ja devolve NULL nesses campos pra nao-PS).

export type AreaRootProps = {
  areaId: string
  fallbackNome: string
  fallbackIcon?: React.ReactNode
}

type AreaMenu = {
  id: string
  nome_menu: string
  icone: string
  rota_raiz: string
  cor_destaque: string
  status_comercial: 'em_producao' | 'piloto' | 'em_construcao' | 'futuro' | 'backlog'
  status_badge_label: string
  status_badge_color: string
  clientes_ativos: number
  mrr_brl: number | string
  pct_evolucao: number
  meta_pct: number
  estrategia_rollout: string
  visivel: boolean
}

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  cream: '#F0ECE3',
  gold: '#C8941A',
  border: '#E0D8CC',
  green: '#10B981',
  amber: '#C8941A',
  gray: '#94A3B8',
}

function getMensagem(area: AreaMenu): string {
  switch (area.status_comercial) {
    case 'em_producao':
      return `Em produção. ${area.clientes_ativos} cliente${area.clientes_ativos === 1 ? '' : 's'} ativo${area.clientes_ativos === 1 ? '' : 's'}.`
    case 'piloto':
      return 'Em validação com piloto. Disponível em breve.'
    case 'em_construcao':
      return `Em desenvolvimento — previsão ${area.estrategia_rollout}.`
    case 'futuro':
      return `Disponível em ${area.estrategia_rollout}.`
    case 'backlog':
      return 'Planejado para futuro próximo. Sem prazo definido.'
    default:
      return ''
  }
}

type AtalhoModulo = { id: string; label: string; href: string }

export default function AreaRootPlaceholder({ areaId, fallbackNome, fallbackIcon }: AreaRootProps) {
  const [area, setArea] = useState<AreaMenu | null>(null)
  const [loading, setLoading] = useState(true)
  const [atalhos, setAtalhos] = useState<AtalhoModulo[]>([])
  const { companyIds } = useCompanyIds()
  const companyId = companyIds[0] ?? null

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.rpc('fn_areas_menu_lateral')
      if (!alive) return
      const match = Array.isArray(data) ? data.find((a: AreaMenu) => a.id === areaId) : null
      setArea(match ?? null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [areaId])

  // Home util do CLIENTE: atalhos reais das telas da area. So busca quando NAO e PS
  // (PS = status_comercial presente, que a RPC so devolve pra equipe interna).
  const isPS = !!area?.status_comercial
  useEffect(() => {
    if (loading || isPS) return
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = await supabase.rpc('fn_modulos_sidebar_por_area', {
        p_area_id: areaId, p_company_id: companyId, p_user_id: user?.id ?? null,
      })
      if (!alive) return
      const vistos = new Set<string>()
      const lista: AtalhoModulo[] = []
      for (const r of (Array.isArray(data) ? data : [])) {
        const href = r.rota as string | null
        if (!href || href === '#' || vistos.has(r.modulo_id)) continue
        vistos.add(r.modulo_id)
        lista.push({ id: r.modulo_id, label: r.nome, href })
      }
      setAtalhos(lista)
    })()
    return () => { alive = false }
  }, [loading, isPS, areaId, companyId])

  const nome = area?.nome_menu ?? fallbackNome
  const mrrNum = area ? (typeof area.mrr_brl === 'string' ? parseFloat(area.mrr_brl) : area.mrr_brl) : 0

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 920, margin: '0 auto', color: C.espresso }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
        {fallbackIcon && <span style={{ color: C.gold, display: 'inline-flex' }}>{fallbackIcon}</span>}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: C.espresso, margin: 0 }}>{nome}</h1>
        {isPS && area?.status_badge_label && (
          <span
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              background: (area.status_badge_color ?? C.gray) + '22',
              color: area.status_badge_color ?? C.gray,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {area.status_badge_label}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ color: C.espressoM, fontSize: 13 }}>Carregando…</p>
      ) : !isPS ? (
        /* HOME DO CLIENTE — atalhos úteis das telas da área. Sem badge/MRR/clientes/"em breve". */
        <>
          <p style={{ color: C.espressoM, fontSize: 14, lineHeight: 1.6, marginBottom: 18, maxWidth: 640 }}>
            Acesse as ferramentas de {nome}:
          </p>
          {atalhos.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {atalhos.map((m) => (
                <Link key={m.id} href={m.href} style={{ textDecoration: 'none' }}>
                  <div style={{
                    background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '14px 16px', color: C.espresso, fontSize: 14, fontWeight: 600,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                  }}>
                    <span>{m.label}</span>
                    <span style={{ color: C.gold }}>→</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ color: C.espressoM, fontSize: 13 }}>Use o menu lateral para acessar as telas desta área.</p>
          )}
        </>
      ) : area ? (
        <>
          <p style={{ color: C.espressoM, fontSize: 14, lineHeight: 1.6, marginBottom: 18, maxWidth: 640 }}>
            {getMensagem(area)}
          </p>

          {/* Cards de stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <StatCard label="Clientes ativos" value={String(area.clientes_ativos)} />
            <StatCard
              label="MRR"
              value={mrrNum > 0 ? `R$ ${mrrNum.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : '—'}
            />
            <StatCard
              label="% evolução"
              value={`${area.pct_evolucao}%`}
              accent={area.pct_evolucao >= 80 ? C.green : area.pct_evolucao >= 40 ? C.amber : C.gray}
              progress={area.pct_evolucao}
            />
            <StatCard label="Rollout" value={area.estrategia_rollout} small />
          </div>

          {/* CTAs proporcionais ao status */}
          {area.status_comercial === 'em_producao' && (
            <div
              style={{
                background: C.offWhite,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: 16,
                fontSize: 13,
                color: C.espressoM,
              }}
            >
              Esta área já tem clientes em produção. Os módulos específicos estão sendo migrados para subrotas dedicadas.
              Use o menu lateral ou{' '}
              <Link href="/dashboard" style={{ color: C.gold, fontWeight: 600 }}>volte ao Dashboard</Link>{' '}
              enquanto estamos consolidando.
            </div>
          )}

          {(area.status_comercial === 'piloto' || area.status_comercial === 'em_construcao') && (
            <div
              style={{
                background: '#FAF0DF',
                border: `1px solid ${area.status_badge_color}`,
                borderLeft: `4px solid ${area.status_badge_color}`,
                borderRadius: 10,
                padding: 16,
                fontSize: 13,
                color: C.espresso,
              }}
            >
              <strong>Acompanhe o progresso:</strong> esta área está em desenvolvimento ativo. Previsão de
              entrega: <strong>{area.estrategia_rollout}</strong>.
            </div>
          )}

          {(area.status_comercial === 'futuro' || area.status_comercial === 'backlog') && (
            <div
              style={{
                background: C.cream,
                border: `1px dashed ${C.border}`,
                borderRadius: 10,
                padding: 16,
                fontSize: 13,
                color: C.espressoM,
              }}
            >
              {area.status_comercial === 'futuro'
                ? `Esta área entra no roadmap formal em ${area.estrategia_rollout}.`
                : 'Esta área está no backlog estratégico. Caso tenha interesse, entre em contato.'}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: C.espressoM, fontSize: 13 }}>
          Área não configurada em <code>area_menu_config</code>. Contate o administrador.
        </p>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  progress,
  small,
}: {
  label: string
  value: string
  accent?: string
  progress?: number
  small?: boolean
}) {
  return (
    <div
      style={{
        background: C.offWhite,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: C.espressoL,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: small ? 13 : 20,
          fontWeight: 700,
          color: accent ?? C.espresso,
          lineHeight: 1.2,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
      {progress != null && (
        <div style={{ height: 5, background: C.cream, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: accent ?? C.gold }} />
        </div>
      )}
    </div>
  )
}
