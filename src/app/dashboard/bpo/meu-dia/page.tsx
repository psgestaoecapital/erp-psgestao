'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PSGC_COLORS } from '@/lib/psgc-tokens'
import PSGCCard from '@/components/psgc/PSGCCard'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import PSGCButton from '@/components/psgc/PSGCButton'
import PSGCBadge from '@/components/psgc/PSGCBadge'

const C = {
  bg: PSGC_COLORS.offWhite,
  card: PSGC_COLORS.offWhite,
  bd: PSGC_COLORS.offWhiteDarker,
  tx: PSGC_COLORS.espresso,
  txm: PSGC_COLORS.espressoLight,
  go: PSGC_COLORS.dourado,
  gol: PSGC_COLORS.douradoSoft,
  alta: PSGC_COLORS.alta,
  media: PSGC_COLORS.media,
  baixa: PSGC_COLORS.baixa,
  azul: PSGC_COLORS.azul,
}

// PSGCMetric usa prop `cor` (nao `variant`). Mapeamento semantico local:
const corMetric = {
  default: PSGC_COLORS.espresso,
  info: PSGC_COLORS.azul,
  critical: PSGC_COLORS.alta,
  attention: PSGC_COLORS.media,
  success: PSGC_COLORS.baixa,
}

type MeuDia = {
  inbox_pendente: number
  inbox_em_andamento: number
  inbox_aguardando_cliente: number
  urgentes: number
  sla_vencendo_4h: number
  sla_vencido: number
  resolvidos_hoje: number
  tempo_medio_minutos_30d: number | null
}

type MinhaEmpresa = {
  company_id: string
  nome_fantasia: string
  papel: string
  inbox_pendente: number
  inbox_em_andamento: number
  inbox_aguardando_cliente: number
  sla_vencendo: number
}

type ItemTopo = {
  id: string
  titulo: string
  descricao: string | null
  prioridade: 'urgente' | 'alta' | 'normal' | 'baixa'
  sla_vence_em: string | null
  categoria: string | null
  company_id: string
}

export default function MeuDiaPage() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [meuDia, setMeuDia] = useState<MeuDia | null>(null)
  const [empresas, setEmpresas] = useState<MinhaEmpresa[]>([])
  const [topItens, setTopItens] = useState<ItemTopo[]>([])

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setLoading(true)
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { setLoading(false); return }
    setUser(u)

    // Meu dia (KPIs pessoais)
    const { data: md } = await supabase.rpc('fn_bpo_meu_dia', { p_user_id: u.id })
    setMeuDia(md as MeuDia)

    // Minhas empresas
    const { data: emp } = await supabase.rpc('fn_bpo_minhas_empresas', { p_user_id: u.id })
    setEmpresas((emp || []) as MinhaEmpresa[])

    // Top 5 prioritarios
    const { data: top } = await supabase
      .from('bpo_inbox_items')
      .select('id, titulo, descricao, prioridade, sla_vence_em, categoria, company_id')
      .eq('assigned_to', u.id)
      .in('status', ['pendente', 'em_andamento'])
      .order('prioridade', { ascending: false })
      .order('sla_vence_em', { ascending: true })
      .limit(5)
    setTopItens((top || []) as ItemTopo[])

    setLoading(false)
  }

  function saudacao() {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  function nome() {
    return user?.email?.split('@')[0]?.split('.')[0] || 'operador'
  }

  if (loading) {
    return <div style={{ padding: 32, color: C.tx }}>Carregando...</div>
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: 24 }}>
      {/* Botao volta */}
      <div style={{ marginBottom: 16 }}>
        <PSGCButton variant="ghost" size="sm" onClick={() => { window.location.href = '/dashboard/bpo' }}>
          ← BPO
        </PSGCButton>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 32,
          color: C.tx,
          marginBottom: 8,
          margin: 0,
        }}>
          Meu Dia
        </h1>
        <p style={{ fontSize: 14, color: C.txm, marginTop: 8, marginBottom: 0 }}>
          {saudacao()}, <span style={{ color: C.go, fontWeight: 600 }}>{nome()}</span>.
          {meuDia && meuDia.inbox_pendente > 0
            ? ` Voce tem ${meuDia.inbox_pendente} itens pendentes.`
            : ' Sua fila esta limpa hoje.'}
        </p>
      </div>

      {/* Grid 4 KPIs principais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <PSGCMetric
          label="Pendentes"
          valor={String(meuDia?.inbox_pendente ?? 0)}
          cor={corMetric.default}
        />
        <PSGCMetric
          label="Em andamento"
          valor={String(meuDia?.inbox_em_andamento ?? 0)}
          cor={corMetric.info}
        />
        <PSGCMetric
          label="Urgentes"
          valor={String(meuDia?.urgentes ?? 0)}
          cor={corMetric.critical}
        />
        <PSGCMetric
          label="Resolvidos hoje"
          valor={String(meuDia?.resolvidos_hoje ?? 0)}
          cor={corMetric.success}
        />
      </div>

      {/* Grid 3 KPIs de SLA + tempo medio */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <PSGCMetric
          label="SLA vencendo 4h"
          valor={String(meuDia?.sla_vencendo_4h ?? 0)}
          cor={corMetric.attention}
        />
        <PSGCMetric
          label="SLA vencido"
          valor={String(meuDia?.sla_vencido ?? 0)}
          cor={corMetric.critical}
        />
        <PSGCMetric
          label="Tempo medio (30d)"
          valor={meuDia?.tempo_medio_minutos_30d != null ? `${meuDia.tempo_medio_minutos_30d} min` : '—'}
          cor={corMetric.default}
        />
      </div>

      {/* Sessao Minhas Empresas */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: C.tx, marginBottom: 12, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          Minhas Empresas
        </h2>
        {empresas.length === 0 ? (
          <PSGCCard variant="default">
            <p style={{ color: C.txm, fontSize: 13, margin: 0 }}>Nenhuma empresa atribuida.</p>
          </PSGCCard>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {empresas.map((e) => (
              <PSGCCard
                key={e.company_id}
                variant={e.sla_vencendo > 0 ? 'attention' : 'default'}
                onClick={() => { window.location.href = `/dashboard/bpo/inbox?company_id=${e.company_id}` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                  <strong style={{ color: C.tx, fontSize: 14 }}>{e.nome_fantasia}</strong>
                  <PSGCBadge variant={e.papel === 'titular' ? 'success' : 'default'} size="sm">
                    {e.papel}
                  </PSGCBadge>
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.txm, flexWrap: 'wrap' }}>
                  <span><strong style={{ color: C.tx }}>{e.inbox_pendente}</strong> pendente</span>
                  <span><strong style={{ color: C.tx }}>{e.inbox_em_andamento}</strong> em curso</span>
                  {e.sla_vencendo > 0 && (
                    <span style={{ color: C.alta, fontWeight: 700 }}>
                      ⚠ {e.sla_vencendo} SLA
                    </span>
                  )}
                </div>
              </PSGCCard>
            ))}
          </div>
        )}
      </div>

      {/* Sessao Top 5 prioritarios */}
      <div>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: C.tx, marginBottom: 12, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          Top 5 Prioritarios
        </h2>
        {topItens.length === 0 ? (
          <PSGCCard variant="success">
            <p style={{ color: C.tx, fontSize: 13, margin: 0 }}>✓ Sua fila esta limpa.</p>
          </PSGCCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topItens.map((item) => {
              const corPrior = item.prioridade === 'urgente' ? C.alta
                            : item.prioridade === 'alta' ? C.media
                            : C.baixa
              return (
                <PSGCCard
                  key={item.id}
                  variant="default"
                  onClick={() => { window.location.href = `/dashboard/bpo/inbox?item_id=${item.id}` }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{
                          background: corPrior,
                          color: PSGC_COLORS.offWhite,
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        }}>
                          {item.prioridade}
                        </span>
                        <span style={{ fontSize: 11, color: C.txm }}>{item.categoria || 'geral'}</span>
                      </div>
                      <strong style={{ color: C.tx, fontSize: 14 }}>{item.titulo}</strong>
                      {item.descricao && (
                        <p style={{ color: C.txm, fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                          {item.descricao.slice(0, 100)}{item.descricao.length > 100 ? '...' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </PSGCCard>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
