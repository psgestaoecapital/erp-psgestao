'use client'
// RD-41 · Odonto — Painel de Indicadores da Agenda (PR2). Diferencial PS.
// Lê fn_odonto_stats_agenda (agregados HONESTOS por cadeira/profissional). Nada é inventado:
// sem concluídos → "—"; sem horário → "definir horário"; sem receita → "aguardando". (RD-51/58)
// FRONTEIRA GE: receita vem da O0/erp_receber via a RPC — aqui só exibe. Valor ocultável (privacidade).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, EmptyStateOdonto, TOK } from './ui'
import { BarChart3, Clock, Gauge, TrendingUp, CalendarX2, Trophy, Eye, EyeOff } from 'lucide-react'

type Cadeira = { cadeira_id: string; nome: string; cor: string | null; total_ags: number; concluidos: number; tempo_medio_min: number | null; horas_agendadas: number; horas_disponiveis: number | null; ocupacao_pct: number | null; sem_horario: boolean; no_show: number; no_show_pct: number | null }
type Prof = { profissional_id: string; nome: string; cor: string | null; total_ags: number; concluidos: number; tempo_medio_min: number | null; receita: number; tem_receita: boolean; ticket_medio: number | null; no_show: number; no_show_pct: number | null }
type Resumo = { total_ags: number; total_concluidos: number; ocupacao_media_pct: number | null; receita_periodo: number; no_show_medio_pct: number | null }
type Stats = { ok: boolean; erro?: string; periodo?: { ini: string; fim: string }; resumo?: Resumo; por_cadeira?: Cadeira[]; por_profissional?: Prof[] }

const PRESETS = [{ k: 'hoje', l: 'Hoje' }, { k: 'semana', l: 'Semana' }, { k: 'mes', l: 'Mês' }, { k: 'custom', l: 'Intervalo' }] as const
type Preset = typeof PRESETS[number]['k']

function iso(d: Date) { return d.toISOString().slice(0, 10) }
function rangeFor(p: Preset, ci: string, cf: string): [string, string] {
  const now = new Date()
  if (p === 'hoje') return [iso(now), iso(now)]
  if (p === 'semana') { const dow = (now.getDay() + 6) % 7; const s = new Date(now); s.setDate(now.getDate() - dow); const e = new Date(s); e.setDate(s.getDate() + 6); return [iso(s), iso(e)] }
  if (p === 'mes') { const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); return [iso(s), iso(e)] }
  return [ci, cf]
}
const fmtMin = (m: number | null) => (m == null ? '—' : `${Math.round(m)} min`)
const fmtPct = (p: number | null) => (p == null ? '—' : `${p}%`)
const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function IndicadoresAgenda({ companyId }: { companyId: string }) {
  const [preset, setPreset] = useState<Preset>('mes')
  const hoje = iso(new Date())
  const [ci, setCi] = useState(hoje); const [cf, setCf] = useState(hoje)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [ocultarValor, setOcultarValor] = useState(false)

  const carregar = useCallback(async () => {
    const [ini, fim] = rangeFor(preset, ci, cf)
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_odonto_stats_agenda', { p_company_id: companyId, p_data_ini: ini, p_data_fim: fim })
    setStats(error ? { ok: false, erro: error.message } : (data as Stats))
    setLoading(false)
  }, [companyId, preset, ci, cf])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const cadeiras = stats?.por_cadeira ?? []
  const profs = stats?.por_profissional ?? []
  const r = stats?.resumo
  const semDados = (r?.total_ags ?? 0) === 0
  // rankings (só quando há base)
  const topProd = profs.filter((p) => p.concluidos > 0).sort((a, b) => b.concluidos - a.concluidos)[0]
  const topOcup = cadeiras.filter((c) => c.ocupacao_pct != null).sort((a, b) => (b.ocupacao_pct ?? 0) - (a.ocupacao_pct ?? 0))[0]
  const money = (v: number | null, tem = true) => (!tem ? 'aguardando' : ocultarValor ? '•••••' : v == null ? '—' : fmtBRL(v))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* controles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: TOK.esp, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 4 }}><BarChart3 size={16} color={TOK.gold} /> Indicadores</div>
        <div style={{ display: 'inline-flex', gap: 4, background: TOK.bg, borderRadius: 999, padding: 2 }}>
          {PRESETS.map((p) => (
            <button key={p.k} onClick={() => setPreset(p.k)} style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: 'none', background: preset === p.k ? TOK.gold : 'transparent', color: preset === p.k ? '#fff' : TOK.mut }}>{p.l}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} style={inpDate} />
            <span style={{ color: TOK.mut, fontSize: 12 }}>até</span>
            <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} style={inpDate} />
          </div>
        )}
        <button onClick={() => setOcultarValor((v) => !v)} title="Privacidade dos valores" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: TOK.mut, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
          {ocultarValor ? <EyeOff size={14} /> : <Eye size={14} />} {ocultarValor ? 'Mostrar R$' : 'Ocultar R$'}
        </button>
      </div>

      {loading && <div style={{ fontSize: 13, color: TOK.mut }}>Carregando…</div>}
      {stats && !stats.ok && <div style={{ padding: '8px 12px', borderRadius: 10, background: '#FBEBEB', color: TOK.red, fontSize: 13 }}>Não foi possível carregar os indicadores{stats.erro ? ` (${stats.erro})` : ''}.</div>}

      {stats?.ok && (
        <>
          {/* RESUMO */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Metric icon={<BarChart3 size={16} />} label="Atendimentos" valor={`${r?.total_concluidos ?? 0}`} sub={`de ${r?.total_ags ?? 0} agendados`} />
            <Metric icon={<Gauge size={16} />} label="Ocupação média" valor={fmtPct(r?.ocupacao_media_pct ?? null)} sub={r?.ocupacao_media_pct == null ? 'defina horários' : 'meta 75–85%'} />
            <Metric icon={<TrendingUp size={16} />} label="Receita do período" valor={money(r?.receita_periodo ?? 0, (r?.receita_periodo ?? 0) > 0)} sub="via aprovações [→GE]" />
            <Metric icon={<CalendarX2 size={16} />} label="No-show médio" valor={fmtPct(r?.no_show_medio_pct ?? null)} sub={r?.no_show_medio_pct == null ? 'sem base' : 'faltas/cancel.'} />
          </div>

          {semDados ? (
            <EmptyStateOdonto titulo="Sem dados suficientes no período" linha="Conforme a clínica opera, os indicadores acendem sozinhos — nada é estimado. Marque atendimentos e conclua-os na agenda." />
          ) : (
            <>
              {/* RANKING */}
              {(topProd || topOcup) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {topProd && <Badge icon={<Trophy size={14} />} texto={`Mais produtivo: ${topProd.nome} · ${topProd.concluidos} atend.`} />}
                  {topOcup && <Badge icon={<Gauge size={14} />} texto={`Mais ocupada: ${topOcup.nome} · ${fmtPct(topOcup.ocupacao_pct)}`} />}
                </div>
              )}

              {/* POR CADEIRA */}
              <SecTitle icon={<Gauge size={15} color={TOK.gold} />} t={`Cadeiras · ${cadeiras.length}`} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {cadeiras.map((c) => (
                  <CardOdonto key={c.cadeira_id} style={{ padding: 14 }}>
                    <Head cor={c.cor} nome={c.nome} right={`${c.concluidos}/${c.total_ags}`} />
                    <Row icon={<Clock size={13} />} k="Tempo médio" v={fmtMin(c.tempo_medio_min)} />
                    <Row icon={<Gauge size={13} />} k="Ocupação" v={c.sem_horario ? 'definir horário' : fmtPct(c.ocupacao_pct)} alerta={c.sem_horario} />
                    <Row icon={<CalendarX2 size={13} />} k="No-show" v={c.no_show_pct == null ? '—' : `${fmtPct(c.no_show_pct)} (${c.no_show})`} />
                  </CardOdonto>
                ))}
              </div>

              {/* POR PROFISSIONAL */}
              <SecTitle icon={<TrendingUp size={15} color={TOK.gold} />} t={`Profissionais · ${profs.length}`} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {profs.map((p) => (
                  <CardOdonto key={p.profissional_id} style={{ padding: 14 }}>
                    <Head cor={p.cor} nome={p.nome} right={`${p.concluidos}/${p.total_ags}`} />
                    <Row icon={<Clock size={13} />} k="Tempo médio" v={fmtMin(p.tempo_medio_min)} />
                    <Row icon={<TrendingUp size={13} />} k="Produção" v={money(p.receita, p.tem_receita)} />
                    <Row icon={<TrendingUp size={13} />} k="Ticket médio" v={p.ticket_medio == null ? '—' : money(p.ticket_medio)} />
                    <Row icon={<CalendarX2 size={13} />} k="No-show" v={p.no_show_pct == null ? '—' : `${fmtPct(p.no_show_pct)} (${p.no_show})`} />
                  </CardOdonto>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

const inpDate: React.CSSProperties = { border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, color: TOK.esp, background: '#fff' }
function Metric({ icon, label, valor, sub }: { icon: React.ReactNode; label: string; valor: string; sub: string }) {
  return (
    <CardOdonto style={{ padding: 14 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TOK.mut, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: TOK.esp, marginTop: 4 }}>{valor}</div>
      <div style={{ fontSize: 11, color: TOK.mut, marginTop: 2 }}>{sub}</div>
    </CardOdonto>
  )
}
function SecTitle({ icon, t }: { icon: React.ReactNode; t: string }) {
  return <div style={{ fontSize: 13, fontWeight: 800, color: TOK.esp, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}>{icon} {t}</div>
}
function Head({ cor, nome, right }: { cor: string | null; nome: string; right: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ width: 20, height: 20, borderRadius: 6, background: cor ?? TOK.gold, flexShrink: 0, border: `1px solid ${TOK.line}` }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, color: TOK.esp, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</div>
      <span title="concluídos / agendados" style={{ fontSize: 11.5, fontWeight: 700, color: TOK.mut, background: TOK.bg, borderRadius: 999, padding: '2px 8px' }}>{right}</span>
    </div>
  )
}
function Row({ icon, k, v, alerta }: { icon: React.ReactNode; k: string; v: string; alerta?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TOK.mut }}>{icon} {k}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: alerta ? TOK.amber : TOK.esp }}>{v}</span>
    </div>
  )
}
function Badge({ icon, texto }: { icon: React.ReactNode; texto: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: TOK.esp, background: '#FBF3DF', border: `0.5px solid ${TOK.gold}55`, borderRadius: 999, padding: '5px 12px' }}>{icon} {texto}</span>
}
