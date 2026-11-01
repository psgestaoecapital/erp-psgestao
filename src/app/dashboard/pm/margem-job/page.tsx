'use client'
// MARGEM POR JOB (P&M). valor_job − custo (Σ agency_timesheet.custo_total) → lucro/margem. Semáforo.
// CEO 01/10: sem custo/hora não há lucro — a tela pede para cadastrar o custo da hora (regra em src/lib/pm/margem.ts).
// Auditoria P&M 31/10: quem vê salário cadastra o custo/hora da equipe SEM sair da tela (editor inline), para zerar os
// jobs sem custo; e a coluna Margem diferencia PREJUÍZO REAL (custo apurado) de CUSTO ESTIMADO (ainda sem apontamento).
// Onda 1 da P&M da Pdois (mapeamento do SIGA, Parte S): a mesma margem vista por job, cliente, serviço ou fee (contrato) —
// regra em agruparMargem (src/lib/pm/margem.ts). Escopo por company_id (RD-45). Tema Espresso.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { calcularMargem, totaisMargem, agruparMargem, type ApontamentoMargem, type DimensaoMargem } from '@/lib/pm/margem'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { carregarCustosEquipe } from '@/lib/pm/equipeCustos'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const YELLOW = '#7A5A0F'; const RED = '#7A1F1F'
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// Perda maior que o próprio valor do job (margem <= -100%) vira rótulo "Prejuízo" em vez de um
// número extremo tipo -2042% (auditoria P&M 31/10). O lucro em R$ (negativo) segue mostrado ao lado.
const fmtMargem = (m: number) => (m <= -100 ? 'Prejuízo' : `${m.toFixed(1)}%`)

type Job = { id: string; titulo: string; numero: string | null; valor_job: number | null; custo_estimado: number | null; status: string; cliente_id: string | null; servico_id: string | null; fee_id: string | null; contrato_id: string | null }
type Nome = { id: string; nome: string }
type Contrato = { id: string; cliente_id: string | null; tipo: string | null; status: string | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }
// custo_hora por pessoa só para quem vê salário (fn_pm_equipe_custos, LGPD 03/10); os demais veem só os totais
type Membro = { id: string; nome: string; custo_hora: number | null }

// onde se cadastra o custo da hora: tela Equipe do P&M (custo/hora por pessoa)
const ROTA_CUSTO_HORA = '/dashboard/pm/equipe'

const DIMENSOES: { v: DimensaoMargem; l: string }[] = [
  { v: 'job', l: 'Job' }, { v: 'cliente', l: 'Cliente' }, { v: 'servico', l: 'Serviço' }, { v: 'fee', l: 'Fee' },
]
const SEM_GRUPO: Record<DimensaoMargem, string> = { job: '—', cliente: 'Sem cliente', servico: 'Sem serviço', fee: 'Fora de fee (avulso)' }

export default function MargemJobPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<Job[]>([]); const [ts, setTs] = useState<ApontamentoMargem[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [podeVer, setPodeVer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [servicos, setServicos] = useState<Nome[]>([]); const [contratos, setContratos] = useState<Contrato[]>([])
  const [dim, setDim] = useState<DimensaoMargem>('job')
  // editor inline do custo/hora (só para quem vê salário): id da pessoa → texto digitado
  const [custoEdit, setCustoEdit] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const [msgSalvar, setMsgSalvar] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [j, t, c, m, custos, sv, co] = await Promise.all([
      supabase.from('agency_jobs').select('id, titulo, numero, valor_job, custo_estimado, status, cliente_id, servico_id, fee_id, contrato_id').eq('company_id', empresa).is('excluido_em', null).order('created_at', { ascending: false }).limit(1000), // RD-98 (exclusão rastreável): não mostra job soft-deleted. PostgREST corta em 1000: sem ordem, o job mais novo some quando a empresa passa disso
      supabase.rpc('fn_pm_job_custos', { p_company_id: empresa }), // agregado por job; ninguém lê custo/hora por pessoa direto (LGPD)
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
      supabase.from('agency_equipe').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
      carregarCustosEquipe(supabase, empresa),
      supabase.from('agency_servico').select('id, nome').eq('company_id', empresa),
      supabase.from('agency_contratos').select('id, cliente_id, tipo, status').eq('company_id', empresa),
    ])
    setServicos((sv.data ?? []) as Nome[]); setContratos((co.data ?? []) as Contrato[])
    setJobs((j.data ?? []) as Job[]); setTs(((t.data ?? []) as { job_id: string; horas: number; tem_custo: boolean; custo_total: number }[]).map((r) => ({ job_id: r.job_id, horas: Number(r.horas), tem_custo: r.tem_custo, custo_total: Number(r.custo_total) })) as ApontamentoMargem[]); setClientes((c.data ?? []) as Cli[])
    setPodeVer(custos.podeVer)
    setMembros(((m.data ?? []) as { id: string; nome: string }[]).map((x) => ({ ...x, custo_hora: custos.custos.get(x.id) ?? null })))
    setLoading(false)
  }, [empresa])

  useEffect(() => { void carregar() }, [carregar])

  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const linhas = useMemo(() => jobs.map((j) => {
    const m = calcularMargem(j, ts)
    const tom = m.margem == null ? TEXTM : m.margem >= 50 ? GREEN : m.margem >= 25 ? YELLOW : RED
    return { j, ...m, tom }
  }).sort((a, b) => (a.margem ?? -1e9) - (b.margem ?? -1e9)), [jobs, ts])

  const tot = useMemo(() => totaisMargem(linhas), [linhas])
  // fee = contrato do job (fee_id; job antigo só tem contrato_id)
  const chaveDe = (j: Job): string | null => dim === 'cliente' ? j.cliente_id : dim === 'servico' ? j.servico_id : (j.fee_id ?? j.contrato_id)
  const nomeGrupo = (id: string | null): string => {
    if (!id) return SEM_GRUPO[dim]
    if (dim === 'cliente') return nomeCli(id)
    if (dim === 'servico') return servicos.find((x) => x.id === id)?.nome ?? 'Serviço'
    const c = contratos.find((x) => x.id === id)
    return c ? `${nomeCli(c.cliente_id)} · ${c.tipo === 'projeto' ? 'projeto' : 'fee'}${c.status && c.status !== 'ativo' ? ` (${c.status})` : ''}` : 'Fee'
  }
  const grupos = useMemo(() => dim === 'job' ? [] : agruparMargem(linhas.map((l) => ({ chave: chaveDe(l.j), linha: l }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, dim])
  // quem está sem custo/hora é dado por pessoa: só aparece para quem vê salário
  const semCustoHoraMembros = useMemo(() => podeVer ? membros.filter((m) => !(Number(m.custo_hora ?? 0) > 0)) : [], [podeVer, membros])
  const semCustoHora = semCustoHoraMembros.map((m) => m.nome)

  // grava o custo/hora inline pelo MESMO caminho da tela Equipe (RLS por empresa; direito de UPDATE da coluna é de quem
  // vê salário). A leitura do valor continua só pela função protegida — aqui só gravamos o que o usuário digitou.
  const salvarCustos = useCallback(async () => {
    if (!empresa) return
    const alvos = Object.entries(custoEdit)
      .map(([id, v]) => ({ id, v: v.trim() === '' ? NaN : Number(v.replace(',', '.')) }))
      .filter((x) => Number.isFinite(x.v) && x.v > 0)
    if (alvos.length === 0) { setMsgSalvar({ tipo: 'erro', texto: 'Informe um custo/hora maior que zero em pelo menos uma pessoa.' }); return }
    setSalvando(true); setMsgSalvar(null)
    try {
      for (const a of alvos) {
        const { error } = await supabase.from('agency_equipe').update({ custo_hora: a.v }).eq('id', a.id).eq('company_id', empresa)
        if (error) throw error
      }
      setMsgSalvar({ tipo: 'ok', texto: alvos.length === 1 ? 'Custo/hora salvo. Margem recalculada.' : `${alvos.length} custos/hora salvos. Margem recalculada.` })
      setCustoEdit({})
      await carregar()
    } catch (e) {
      setMsgSalvar({ tipo: 'erro', texto: `Não foi possível salvar: ${(e as { message?: string })?.message ?? 'erro'}.` })
    } finally {
      setSalvando(false)
    }
  }, [empresa, custoEdit, carregar])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center' }}>Margem por Job<AjudaCampo chave="pm.margem.tela" /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Valor − custo (horas apontadas × custo/hora). Custo estimado quando não há apontamento.</p>
        </header>

        {(tot.semCustoHora > 0 || semCustoHora.length > 0) && (
          <div data-testid="margem-aviso-custo-hora" style={{ background: '#FFF7E6', border: `1px solid ${DOURADO}`, borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center' }}><b>Cadastre o custo da hora da equipe.</b><AjudaCampo chave="pm.equipe.custo_hora" /></div>{' '}
            {tot.semCustoHora > 0
              ? <>Há {tot.semCustoHora === 1 ? '1 job com horas apontadas' : `${tot.semCustoHora} jobs com horas apontadas`} por quem não tem custo/hora — sem isso o lucro sairia igual ao valor do job.</>
              : <>Sem custo/hora, as horas apontadas por essas pessoas não entram no custo do job.</>}

            {/* editor inline: quem vê salário informa o custo/hora de cada pessoa sem sair da tela (auditoria 31/10) */}
            {podeVer && semCustoHoraMembros.length > 0 ? (
              <div data-testid="margem-custo-inline" style={{ marginTop: 10, background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: TEXTM, marginBottom: 8 }}>Informe o custo/hora de cada pessoa sem custo cadastrado:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {semCustoHoraMembros.map((m) => (
                    <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ flex: '1 1 160px', minWidth: 140, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{m.nome}<AjudaCampo chave="pm.equipe.custo_hora" /></span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: TEXTM, fontSize: 12 }}>R$</span>
                        <input
                          type="number" inputMode="decimal" min={0} step="0.01" placeholder="0,00"
                          data-testid={`margem-custo-input-${m.id}`}
                          value={custoEdit[m.id] ?? ''}
                          onChange={(e) => setCustoEdit((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          style={{ width: 110, minHeight: 40, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '6px 10px', fontSize: 14 }}
                        />
                        <span style={{ color: TEXTM, fontSize: 12 }}>/h</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void salvarCustos()} disabled={salvando} data-testid="margem-custo-salvar"
                    style={{ background: ESPRESSO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.6 : 1, minHeight: 40 }}>
                    {salvando ? 'Salvando…' : 'Salvar custo/hora'}
                  </button>
                  <a href={ROTA_CUSTO_HORA} data-testid="margem-cadastrar-custo-hora" style={{ color: ESPRESSO, fontWeight: 700, fontSize: 12, textDecoration: 'underline' }}>
                    Abrir a tela Equipe →
                  </a>
                  {msgSalvar && <span data-testid="margem-custo-msg" style={{ fontSize: 12, fontWeight: 600, color: msgSalvar.tipo === 'ok' ? GREEN : RED }}>{msgSalvar.texto}</span>}
                </div>
              </div>
            ) : (
              <>
                {semCustoHora.length > 0 && <div style={{ color: TEXTM, marginTop: 4 }}>Sem custo/hora: {semCustoHora.join(', ')}.</div>}
                <div style={{ marginTop: 8 }}>
                  <a href={ROTA_CUSTO_HORA} data-testid="margem-cadastrar-custo-hora" style={{ display: 'inline-block', background: ESPRESSO, color: '#fff', borderRadius: 8, padding: '6px 12px', fontWeight: 700, textDecoration: 'none' }}>
                    Cadastrar custo da hora →
                  </a>
                  <span style={{ color: TEXTM, marginLeft: 8, fontSize: 12 }}>Tela Equipe: em cada pessoa, campo &quot;Custo/hora (R$)&quot;.</span>
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 6 }}>
          <Kpi l="Valor total" v={brl(tot.valor)} ajuda="pm.margem.kpi_valor" />
          <Kpi l="Custo total" v={brl(tot.custo)} ajuda="pm.margem.kpi_custo" />
          <Kpi l="Lucro" v={brl(tot.lucro)} cor={tot.lucro >= 0 ? GREEN : RED} ajuda="pm.margem.kpi_lucro" />
          <Kpi l="Margem geral" v={`${tot.margem.toFixed(1)}%`} cor={tot.margem >= 50 ? GREEN : tot.margem >= 25 ? YELLOW : RED} ajuda="pm.margem.kpi_margem" />
        </div>
        {(tot.semCustoHora + tot.semCusto) > 0 && (
          <div style={{ fontSize: 12, color: TEXTM, marginBottom: 6 }} data-testid="margem-fora-do-total">
            {tot.semCustoHora + tot.semCusto} job(s) sem custo completo não entram no lucro nem na margem acima.
          </div>
        )}
        {/* legenda: distingue a margem apurada (custo real) da estimada (custo previsto, ainda sem apontamento) */}
        <div style={{ fontSize: 12, color: TEXTM, marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }} data-testid="margem-legenda">
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><span style={{ color: GREEN, fontWeight: 700, marginRight: 4 }}>●</span>margem apurada (custo real)</span>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><span style={{ color: YELLOW, fontWeight: 700, marginRight: 4 }}>◍</span>estimada (custo previsto, sem apontamento)<AjudaCampo chave="pm.margem.col_custo" /></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }} data-testid="margem-ver-por">
          <span style={{ fontSize: 12, color: TEXTM, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Ver margem por<AjudaCampo chave="pm.margem.ver_por" /></span>
          {DIMENSOES.map((d) => (
            <button key={d.v} type="button" onClick={() => setDim(d.v)} data-testid={`margem-dim-${d.v}`} aria-pressed={dim === d.v}
              style={{ border: `1px solid ${dim === d.v ? ESPRESSO : BORDA}`, background: dim === d.v ? ESPRESSO : '#fff', color: dim === d.v ? '#fff' : ESPRESSO, borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36 }}>
              {d.l}
            </button>
          ))}
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : linhas.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Sem jobs ainda.</div>
          : dim !== 'job' ? (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.margem.col_dimensao">{DIMENSOES.find((d) => d.v === dim)?.l}</Th><Th chave="pm.margem.col_jobs">Jobs</Th><Th chave="pm.margem.col_valor">Valor</Th><Th chave="pm.margem.col_custo">Custo</Th><Th chave="pm.margem.col_lucro">Lucro</Th><Th chave="pm.margem.grupo">Margem</Th></tr></thead>
                <tbody>
                  {grupos.map((g) => {
                    const tom = g.margem == null ? TEXTM : g.margem >= 50 ? GREEN : g.margem >= 25 ? YELLOW : RED
                    return (
                      <tr key={g.chave ?? 'sem'} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`margem-grupo-${g.chave ?? 'sem'}`}>
                        <Td><b>{nomeGrupo(g.chave)}</b></Td>
                        <Td style={{ color: TEXTM }}>{g.jobs}{g.pendentes > 0 && <span style={{ fontSize: 11, color: YELLOW }}> · {g.pendentes} sem custo</span>}</Td>
                        {g.margem == null ? (
                          <Td colSpan={4} style={{ color: TEXTM }}>Sem custo lançado nos jobs deste grupo</Td>
                        ) : (<>
                          <Td>{brl(g.valor)}</Td>
                          <Td>{brl(g.custo)}</Td>
                          <Td style={{ color: g.lucro >= 0 ? GREEN : RED, fontWeight: 700 }}>{brl(g.lucro)}</Td>
                          <Td><span style={{ fontWeight: 700, color: tom }}>● {fmtMargem(g.margem)}</span></Td>
                        </>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.margem.col_job">Job</Th><Th chave="pm.margem.col_cliente">Cliente</Th><Th chave="pm.margem.col_valor">Valor</Th><Th chave="pm.margem.col_custo">Custo</Th><Th chave="pm.margem.col_lucro">Lucro</Th><Th chave="pm.margem.grupo">Margem</Th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.j.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`margem-job-${l.j.id}`}>
                      <Td><b>{l.j.titulo}</b></Td>
                      <Td style={{ color: TEXTM }}>{nomeCli(l.j.cliente_id)}</Td>
                      <Td>{brl(l.valor)}</Td>
                      {l.situacao === 'ok' ? (<>
                        <Td>{brl(l.custo)}{l.estimado && <span style={{ fontSize: 10, color: YELLOW }}> (est.)</span>}</Td>
                        <Td style={{ color: l.estimado ? YELLOW : ((l.lucro ?? 0) >= 0 ? GREEN : RED), fontWeight: 700 }}>{brl(l.lucro ?? 0)}</Td>
                        {l.estimado ? (
                          <Td data-testid={`margem-estimado-${l.j.id}`}>
                            <span style={{ fontWeight: 700, color: YELLOW }} title="Custo estimado (previsto no job): ainda não há horas apontadas com custo/hora. O número fecha quando o custo real entrar.">
                              ◍ {(l.margem ?? 0) < 0 ? 'Prejuízo' : fmtMargem(l.margem ?? 0)} · estimado
                            </span>
                          </Td>
                        ) : (
                          <Td><span style={{ fontWeight: 700, color: l.tom }} title="Margem apurada pelo custo real das horas apontadas.">● {fmtMargem(l.margem ?? 0)}</span></Td>
                        )}
                      </>) : l.situacao === 'sem_custo_hora' ? (
                        <Td colSpan={3} style={{ color: YELLOW }}>
                          <a href={ROTA_CUSTO_HORA} style={{ color: YELLOW, fontWeight: 700 }}>Cadastre o custo da hora da equipe</a>
                          {' '}— {l.horasSemCusto.toLocaleString('pt-BR')} h apontada(s) sem custo/hora
                        </Td>
                      ) : (
                        <Td colSpan={3} style={{ color: TEXTM }}>Sem custo lançado — aponte as horas do job ou informe o custo estimado</Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}

function Kpi({ l, v, cor, ajuda }: { l: string; v: string; cor?: string; ajuda?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{l}{ajuda && <AjudaCampo chave={ajuda} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children, chave }: { children?: React.ReactNode; chave?: string }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{chave ? <span style={{ display: 'inline-flex', alignItems: 'center' }}>{children}<AjudaCampo chave={chave} /></span> : children}</th> }
function Td({ children, style, colSpan }: { children?: React.ReactNode; style?: CSSProperties; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
