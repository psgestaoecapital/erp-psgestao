'use client'
// P&M · Carga da equipe em horas × capacidade (onda 3 da P&M da Pdois). Regra única em src/lib/pm/cargaEquipe.ts.
// Só leitura e só horas (nunca custo). Escopo por empresa (RLS + company_id).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { COLUNAS_EQUIPE } from '@/lib/pm/equipeCustos'
import { SITUACOES_FIM } from '@/lib/pm/painel'
import { cargaEquipe, type FeeCarga, type JobCarga, type MembroCarga, type PropostaCarga, type Situacao, type TarefaCarga } from '@/lib/pm/cargaEquipe'

const ESPRESSO = '#3D2314'; const DOURADO = '#C8941A'; const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const RED = '#7A1F1F'; const VERDE = '#2F6B3A'
const JANELAS = [{ d: 7, l: 'Esta semana' }, { d: 14, l: '2 semanas' }, { d: 28, l: '4 semanas' }]
const COR: Record<Situacao, string> = { sobrecarga: RED, atencao: DOURADO, ok: VERDE, folga: '#4A6FA5' }
const ROTULO: Record<Situacao, string> = { sobrecarga: 'acima da capacidade', atencao: 'perto do limite', ok: 'equilibrado', folga: 'com folga' }
const h = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
const fimISO = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

type Dados = { membros: MembroCarga[]; jobs: JobCarga[]; tarefas: TarefaCarga[]; usuarios: Record<string, string>; propostas: PropostaCarga[]; fees: FeeCarga[] }

export function CargaEquipe({ empresa, versao = 0 }: { empresa: string; versao?: number }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [dias, setDias] = useState(7)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const [eq, j, t, u, p, c] = await Promise.all([
        supabase.from('agency_equipe').select(COLUNAS_EQUIPE).eq('company_id', empresa),
        supabase.from('agency_jobs').select('id, status, responsavel_id, responsavel_nome, data_prazo, horas_estimadas, horas_realizadas, proposta_id, fee_id, contrato_id, created_at, updated_at')
          .eq('company_id', empresa).is('excluido_em', null).not('status', 'in', `(${SITUACOES_FIM.join(',')})`).limit(5000),
        supabase.from('agency_tarefas').select('job_id, status, responsavel_id, data_prazo, horas_estimadas, horas_realizadas')
          .eq('company_id', empresa).neq('status', 'concluida').gt('horas_estimadas', 0).limit(20000),
        supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa }),
        supabase.from('agency_propostas').select('id, status').eq('company_id', empresa).in('status', ['enviada', 'aprovada']).is('deleted_at', null).limit(2000),
        supabase.from('agency_contratos').select('id, status, tipo, proposta_id').eq('company_id', empresa).eq('status', 'ativo').limit(2000),
      ])
      if (!vivo) return
      const falha = eq.error ?? j.error ?? t.error
      if (falha) { setErro(falha.message); return }
      setErro(null)
      // horas estimadas das propostas (as abertas e as que deram origem a um fee ativo), numa consulta só
      const contratos = (c.data ?? []) as { id: string; status: string; tipo: string | null; proposta_id: string | null }[]
      const propIds = [...new Set([...((p.data ?? []) as { id: string }[]).map((x) => x.id), ...contratos.map((x) => x.proposta_id).filter(Boolean) as string[]])]
      const horasProp = new Map<string, number>()
      if (propIds.length) {
        const it = await supabase.from('agency_proposta_itens').select('proposta_id, horas_estimadas').in('proposta_id', propIds).is('excluido_em', null).limit(20000)
        if (!vivo) return
        for (const r of (it.data ?? []) as { proposta_id: string; horas_estimadas: number | null }[]) horasProp.set(r.proposta_id, (horasProp.get(r.proposta_id) ?? 0) + Number(r.horas_estimadas ?? 0))
      }
      const usuarios: Record<string, string> = {}
      for (const x of (u.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) usuarios[x.id] = x.full_name || x.email || 'Usuário'
      setDados({
        membros: (eq.data ?? []) as MembroCarga[], jobs: (j.data ?? []) as JobCarga[], tarefas: (t.data ?? []) as TarefaCarga[], usuarios,
        propostas: ((p.data ?? []) as { id: string; status: string }[]).map((x) => ({ ...x, horas: horasProp.get(x.id) ?? 0 })),
        fees: contratos.map((x) => ({ id: x.id, status: x.status, tipo: x.tipo, horas_mes: x.proposta_id ? horasProp.get(x.proposta_id) ?? 0 : 0 })),
      })
    })()
    return () => { vivo = false }
  }, [empresa, versao])

  const r = useMemo(() => (dados ? cargaEquipe({ ...dados, dias }) : null), [dados, dias])

  return (
    <section data-testid="carga-equipe" style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'inline-flex', alignItems: 'center' }}>Carga × capacidade<AjudaCampo chave="pm.equipe.carga" /></h2>
        <div role="group" aria-label="Período" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {JANELAS.map((w) => (
            <button key={w.d} type="button" onClick={() => setDias(w.d)} aria-pressed={dias === w.d}
              style={{ ...chip, ...(dias === w.d ? { background: ESPRESSO, color: '#fff', borderColor: ESPRESSO } : {}) }}>{w.l}</button>
          ))}
          <AjudaCampo chave="pm.equipe.carga_periodo" />
        </div>
      </div>
      {erro ? <p role="alert" style={{ color: RED, fontSize: 13 }}>{erro}</p>
        : !r ? <p style={{ color: TEXTM, fontSize: 13 }}>Carregando…</p> : (
          <>
            <p style={{ fontSize: 12, color: TEXTM, margin: '0 0 10px' }}>De {fimISO(r.de)} a {fimISO(r.ate)} · {r.diasUteis} dia(s) útil(eis)</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 8, marginBottom: 12 }}>
              <Indicador l="Capacidade" v={h(r.capacidade)} ajuda="pm.equipe.carga_capacidade" />
              <Indicador l="Comprometido" v={h(r.comprometido)} ajuda="pm.equipe.carga_comprometido" />
              <Indicador l="Previsão" v={h(r.previsao.propostas + r.previsao.fees)} sub={`propostas ${h(r.previsao.propostas)} · fees ${h(r.previsao.fees)}`} ajuda="pm.equipe.carga_previsao" />
              <Indicador l="Livre" v={h(r.livre)} cor={r.livre < 0 ? RED : VERDE} ajuda="pm.equipe.carga_livre" />
            </div>
            {r.linhas.length === 0 ? <p style={{ fontSize: 13, color: TEXTM }}>Cadastre a equipe com a jornada (h/dia) para ver a capacidade.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {r.linhas.map((l) => {
                  const pct = l.pct == null ? null : Math.round(l.pct * 100)
                  return (
                    <li key={l.chave} data-situacao={l.situacao} style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                        <span style={{ fontWeight: 700 }}>{l.nome}{!l.naEquipe && <span style={{ color: RED, fontWeight: 400, fontSize: 11 }}> · fora da equipe (sem jornada)</span>}{l.jornadaPadrao && <span style={{ color: TEXTM, fontWeight: 400, fontSize: 11 }}> · jornada padrão 8 h</span>}</span>
                        <span style={{ color: COR[l.situacao], fontWeight: 700 }}>{h(l.comprometido)} de {h(l.capacidade)}{pct != null ? ` · ${pct}%` : ''} · {ROTULO[l.situacao]}</span>
                      </div>
                      <div aria-hidden style={{ height: 8, background: '#F3EEE7', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, pct ?? 100)}%`, height: '100%', background: COR[l.situacao] }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {r.semDono > 0 && <p style={{ fontSize: 12, color: RED, margin: '10px 0 0' }}>{h(r.semDono)} de trabalho aberto sem responsável — defina quem faz para entrar na carga de alguém.</p>}
          </>
        )}
    </section>
  )
}

function Indicador({ l, v, sub, cor, ajuda }: { l: string; v: string; sub?: string; cor?: string; ajuda: string }) {
  return (
    <div style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700, display: 'flex', alignItems: 'center' }}>{l}<AjudaCampo chave={ajuda} /></div>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: TEXTM }}>{sub}</div>}
    </div>
  )
}
const chip: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
