'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// Card de area-raiz para planos novos (M.A.7.5).
// Renderiza titulo + status badge + mensagem proporcional ao status.
// Busca dados em area_menu_config / fn_areas_menu_lateral pelo id da area.

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

export default function AreaRootPlaceholder({ areaId, fallbackNome, fallbackIcon }: AreaRootProps) {
  const [area, setArea] = useState<AreaMenu | null>(null)
  const [loading, setLoading] = useState(true)

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

  const nome = area?.nome_menu ?? fallbackNome
  const mrrNum = area ? (typeof area.mrr_brl === 'string' ? parseFloat(area.mrr_brl) : area.mrr_brl) : 0

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 920, margin: '0 auto', color: C.espresso }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
        {fallbackIcon && <span style={{ color: C.gold, display: 'inline-flex' }}>{fallbackIcon}</span>}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: C.espresso, margin: 0 }}>{nome}</h1>
        {area && (
          <span
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              background: area.status_badge_color + '22',
              color: area.status_badge_color,
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
        <p style={{ color: C.espressoM, fontSize: 13 }}>Carregando informações da área…</p>
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
