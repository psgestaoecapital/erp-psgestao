// src/app/dashboard/compliance/calendario/page.tsx
// Calendario Legal IA — Onda 1 feature M.HC.1
//
// Adaptado do spec ao stack real do projeto:
// - Client Component (projeto nao tem @/lib/supabase/server SSR helper)
// - useCompanyIds hook (padrao multi-tenant do projeto)
// - Estilos inline + paleta Estrela Polar (sem shadcn ui — nao instalado)
// - Mutations via supabase.rpc client-side (sem actions.ts server actions)
//
// Consome:
// - view v_compliance_calendar_dashboard (KPIs)
// - fn_compliance_calendar_priorizado (lista de tarefas)
// - fn_compliance_calendar_gerar_de_documentos (gerar de docs vencendo)
// - fn_compliance_calendar_gerar_recorrentes_mensais (gerar recorrentes)
// - fn_compliance_calendar_marcar_concluida (concluir tarefa)

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offwhite: '#FAF7F2',
  cream: '#F0ECE3',
  gold: '#C8941A',
  goldSoft: '#E8C872',
  borderLt: '#E0D8CC',
  ink: '#1A1A1A',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  amber: '#eab308',
  orange: '#F59E0B',
  red: '#dc2626',
  blue: '#3B82F6',
}

interface KPIs {
  tarefas_ativas: number
  tarefas_vencidas: number
  vencendo_7d: number
  vencendo_15d: number
  vencendo_30d: number
  concluidas_30d: number
  exposicao_multa_total_brl: number
  multa_atual_vencido_brl: number
  criticas_abertas: number
  esocial_abertas: number
}

interface Tarefa {
  tarefa_id: string
  titulo: string
  descricao: string | null
  vencimento_em: string | null
  dias_para_vencer: number | null
  status: string
  prioridade: number
  multa_potencial_brl: number | null
  risco_legal: string | null
  base_legal: string | null
  codigo_esocial: string | null
  tipo_nome: string | null
  funcionario_nome: string | null
  rule_origem: string | null
}

const fmtBRL = (v: number | null | undefined): string =>
  `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const venceFormatado = (dias: number | null): string => {
  if (dias === null) return 'Sem data'
  if (dias < 0) return `Vencido ha ${Math.abs(dias)}d`
  if (dias === 0) return 'Vence HOJE'
  if (dias === 1) return 'Vence amanha'
  return `Vence em ${dias}d`
}

function prioColor(prio: number): { bg: string; text: string; label: string } {
  if (prio >= 500) return { bg: C.red + '22', text: C.red, label: 'CRITICO' }
  if (prio >= 100) return { bg: C.orange + '22', text: C.orange, label: 'ALTO' }
  if (prio >= 50) return { bg: C.amber + '22', text: '#8B6914', label: 'MEDIO' }
  return { bg: C.blue + '22', text: C.blue, label: 'BAIXO' }
}

function riscoColor(r: string | null): string {
  if (r === 'critico') return C.red
  if (r === 'alto') return C.orange
  if (r === 'medio') return C.amber
  return C.blue
}

export default function CalendarioCompliancePage() {
  const { companyIds, sel, selInfo, companies, loading: loadingCompanies } = useCompanyIds()
  const companyIdUnico = useMemo(
    () => (selInfo.tipo === 'empresa' && sel ? sel : companyIds[0] ?? null),
    [selInfo, sel, companyIds],
  )
  const empresaNome = useMemo(() => {
    if (!companyIdUnico) return ''
    const c = companies.find((x) => x.id === companyIdUnico)
    return c?.nome_fantasia || c?.razao_social || 'Empresa'
  }, [companyIdUnico, companies])

  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [filtroRisco, setFiltroRisco] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<string | null>('pendente')
  const [msgOk, setMsgOk] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIdUnico) return
    setLoading(true)
    setErro(null)
    try {
      const [kpiRes, tarRes] = await Promise.all([
        supabase
          .from('v_compliance_calendar_dashboard')
          .select('*')
          .eq('company_id', companyIdUnico)
          .maybeSingle(),
        supabase.rpc('fn_compliance_calendar_priorizado', {
          p_company_id: companyIdUnico,
          p_horizonte_dias: 90,
          p_apenas_pendentes: true,
        }),
      ])
      if (kpiRes.error) throw kpiRes.error
      if (tarRes.error) throw tarRes.error
      setKpis((kpiRes.data ?? null) as KPIs | null)
      setTarefas((tarRes.data ?? []) as Tarefa[])
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar calendario')
    } finally {
      setLoading(false)
    }
  }, [companyIdUnico])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function gerarTarefas() {
    if (!companyIdUnico) return
    setGerando(true)
    setErro(null)
    setMsgOk(null)
    try {
      const [docsRes, recRes] = await Promise.all([
        supabase.rpc('fn_compliance_calendar_gerar_de_documentos', {
          p_company_id: companyIdUnico,
          p_horizonte_dias: 365,
        }),
        supabase.rpc('fn_compliance_calendar_gerar_recorrentes_mensais', {
          p_company_id: companyIdUnico,
          p_mes: null,
        }),
      ])
      if (docsRes.error) throw docsRes.error
      if (recRes.error) throw recRes.error
      const criadasDocs = (docsRes.data?.[0]?.tarefas_criadas ?? 0) as number
      const criadasRec = (recRes.data?.[0]?.tarefas_criadas ?? 0) as number
      setMsgOk(`Tarefas geradas: ${criadasDocs} de documentos + ${criadasRec} recorrentes`)
      window.setTimeout(() => setMsgOk(null), 4500)
      await carregar()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar tarefas')
    } finally {
      setGerando(false)
    }
  }

  async function concluir(tarefaId: string) {
    setActingId(tarefaId)
    setErro(null)
    try {
      const { error } = await supabase.rpc('fn_compliance_calendar_marcar_concluida', {
        p_tarefa_id: tarefaId,
        p_observacao: null,
      })
      if (error) throw error
      await carregar()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao concluir tarefa')
    } finally {
      setActingId(null)
    }
  }

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((t) => {
      if (filtroRisco && t.risco_legal !== filtroRisco) return false
      if (filtroStatus === 'vencido' && (t.dias_para_vencer === null || t.dias_para_vencer >= 0)) return false
      if (filtroStatus === 'pendente' && t.status !== 'pendente' && t.status !== 'em_andamento') return false
      return true
    })
  }, [tarefas, filtroRisco, filtroStatus])

  if (loadingCompanies) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Carregando empresas…</div>
  }
  if (!companyIdUnico) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: C.espressoM }}>
          Selecione uma empresa no topo para ver o Calendario Legal IA.
        </p>
      </div>
    )
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 24,
          }}
        >
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
              COMPLIANCE
            </p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
              Calendario Legal IA
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
              {empresaNome} · Tarefas legais priorizadas por risco × multa
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/compliance" style={btnSec}>
              ← Compliance
            </Link>
            <button onClick={gerarTarefas} disabled={gerando} style={{ ...btnPri, opacity: gerando ? 0.6 : 1 }}>
              {gerando ? '⏳ Gerando…' : '✨ Gerar tarefas do periodo'}
            </button>
          </div>
        </header>

        {msgOk && (
          <div
            style={{
              background: '#DCFCE7',
              color: '#166534',
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              borderLeft: `4px solid ${C.green}`,
            }}
          >
            {msgOk}
          </div>
        )}
        {erro && (
          <div
            style={{
              background: '#FEE2E2',
              color: '#991B1B',
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              borderLeft: `4px solid ${C.red}`,
            }}
          >
            {erro}
          </div>
        )}

        {/* KPIs */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <KpiCard label="Ativas" value={String(kpis?.tarefas_ativas ?? 0)} accent={C.blue} hint="pendentes/em andamento" />
          <KpiCard label="Vencem 7d" value={String(kpis?.vencendo_7d ?? 0)} accent={C.orange} hint="acao urgente" />
          <KpiCard
            label="Vencidas"
            value={String(kpis?.tarefas_vencidas ?? 0)}
            accent={C.red}
            hint={fmtBRL(kpis?.multa_atual_vencido_brl ?? 0)}
          />
          <KpiCard
            label="Exposicao"
            value={fmtBRL(kpis?.exposicao_multa_total_brl ?? 0)}
            accent={C.gold}
            hint="multas potenciais"
          />
        </section>

        {/* Filtros */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 }}>
          <span style={{ color: C.muted }}>Filtros:</span>
          <FilterPill label="Todos riscos" active={!filtroRisco} onClick={() => setFiltroRisco(null)} />
          <FilterPill label="Critico" active={filtroRisco === 'critico'} onClick={() => setFiltroRisco('critico')} color={C.red} />
          <FilterPill label="Alto" active={filtroRisco === 'alto'} onClick={() => setFiltroRisco('alto')} color={C.orange} />
          <FilterPill label="Medio" active={filtroRisco === 'medio'} onClick={() => setFiltroRisco('medio')} color={C.amber} />
          <span style={{ color: C.muted, margin: '0 4px' }}>·</span>
          <FilterPill label="Pendentes" active={filtroStatus === 'pendente'} onClick={() => setFiltroStatus('pendente')} />
          <FilterPill label="Vencidas" active={filtroStatus === 'vencido'} onClick={() => setFiltroStatus('vencido')} color={C.red} />
          <FilterPill label="Todas" active={filtroStatus === null} onClick={() => setFiltroStatus(null)} />
        </div>

        {/* Lista */}
        {loading ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Carregando…</p>
        ) : tarefasFiltradas.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 24px',
              background: '#FFFFFF',
              borderRadius: 12,
              boxShadow: '0 1px 3px rgba(61,35,20,0.06)',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, color: C.espresso }}>Tudo em dia!</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: C.muted }}>
              Nenhuma tarefa pendente nos filtros atuais. Clique em &ldquo;Gerar tarefas&rdquo; para sincronizar com seus
              documentos.
            </p>
            <button onClick={gerarTarefas} disabled={gerando} style={{ ...btnSec, padding: '10px 16px' }}>
              ↻ Sincronizar agora
            </button>
          </div>
        ) : (
          <>
            {/* Mobile: cards empilhados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="mobile-list">
              {tarefasFiltradas.map((t) => {
                const prio = prioColor(t.prioridade)
                return (
                  <div
                    key={t.tarefa_id}
                    style={{
                      background: '#FFFFFF',
                      borderRadius: 12,
                      padding: 14,
                      boxShadow: '0 1px 3px rgba(61,35,20,0.06)',
                      borderLeft: `4px solid ${prio.text}`,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={badgeStyle(prio.bg, prio.text)}>{prio.label}</span>
                      {t.codigo_esocial && (
                        <span style={badgeStyle(C.gold + '22', C.gold)}>{t.codigo_esocial}</span>
                      )}
                      {t.risco_legal && (
                        <span style={badgeStyle(riscoColor(t.risco_legal) + '22', riscoColor(t.risco_legal))}>
                          {t.risco_legal}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.espresso, marginBottom: 6 }}>{t.titulo}</div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        fontSize: 12,
                        color: C.espressoLt,
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          color: t.dias_para_vencer !== null && t.dias_para_vencer < 0 ? C.red : C.espressoLt,
                          fontWeight: t.dias_para_vencer !== null && t.dias_para_vencer < 0 ? 600 : 400,
                        }}
                      >
                        📅 {venceFormatado(t.dias_para_vencer)}
                      </span>
                      {t.multa_potencial_brl != null && t.multa_potencial_brl > 0 && (
                        <span style={{ color: C.red, fontFamily: 'monospace' }}>{fmtBRL(t.multa_potencial_brl)}</span>
                      )}
                    </div>
                    {t.base_legal && (
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, fontStyle: 'italic' }}>
                        {t.base_legal}
                      </div>
                    )}
                    <button
                      onClick={() => concluir(t.tarefa_id)}
                      disabled={actingId === t.tarefa_id}
                      style={{ ...btnSec, marginTop: 10, width: '100%', minHeight: 44 }}
                    >
                      {actingId === t.tarefa_id ? '…' : '✓ Marcar concluida'}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <footer style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${C.borderLt}`, fontSize: 11, color: C.espressoL, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 6px' }}>
            <strong style={{ color: C.espressoM }}>Como funciona:</strong> a IA cruza seus documentos cadastrados
            (compliance_documentos) com a biblioteca legal brasileira (73 tipos com multa/risco/base legal mapeados) e
            gera tarefas priorizadas. Atualizado em tempo real.
          </p>
          <p style={{ margin: 0 }}>
            {kpis?.criticas_abertas ?? 0} criticas · {kpis?.esocial_abertas ?? 0} eSocial · {kpis?.concluidas_30d ?? 0}{' '}
            concluidas nos ultimos 30d
          </p>
        </footer>
      </div>
    </div>
  )
}

function KpiCard({ label, value, accent, hint }: { label: string; value: string; accent: string; hint: string }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${C.borderLt}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          color: C.espressoL,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1.1, wordBreak: 'break-word' }}>
        {value}
      </span>
      <span style={{ fontSize: 10, color: C.muted }}>{hint}</span>
    </div>
  )
}

function FilterPill({
  label,
  active,
  onClick,
  color,
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        border: `1px solid ${active ? C.espresso : C.borderLt}`,
        background: active ? C.espresso : '#FFFFFF',
        color: active ? C.offwhite : color || C.espressoLt,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    background: bg,
    color,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  }
}

const btnSec: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: `1px solid ${C.borderLt}`,
  background: '#FFFFFF',
  color: C.espresso,
  fontSize: 12,
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const btnPri: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: C.gold,
  color: '#FFFFFF',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}
