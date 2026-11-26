'use client'

// Razão Financeiro (blueprint GE tela 124 · T045) — razão por conta bancária/caixa.
// Enquanto o Extrato mostra UMA conta por vez em fluxo contínuo, o Razão coloca TODAS as contas
// lado a lado no mesmo período: para cada conta, saldo inicial · entradas · saídas · saldo final,
// com o grupo consolidado no topo e o detalhe de lançamentos ao expandir. É um relatório
// SOMENTE-LEITURA: reutiliza a RPC provada `fn_ge_extrato_conta` (mesma semântica do Extrato —
// sem lógica financeira nova), uma chamada por conta. RD-96: desenho próprio PS, não é cópia.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA_AJUDA = '/dashboard/financeiro/razao-financeiro'

interface Mov {
  id: string
  data: string
  sinal: number
  valor: number
  descricao: string | null
  categoria: string | null
  nome_pessoa: string | null
  saldo_acumulado: number
  status: string
}
interface Totalizadores {
  saldo_anterior: number
  saldo_atual: number
  total_entradas: number
  total_saidas: number
}
interface Conta {
  id: string
  nome: string
}
interface RazaoConta {
  conta: Conta
  total: Totalizadores
  movs: Mov[]
  semPlano: boolean
  erro: string | null
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}
function isoMinus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
function isoToday(): string {
  return new Date().toISOString().split('T')[0]
}
function toISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

const ZERO: Totalizadores = { saldo_anterior: 0, saldo_atual: 0, total_entradas: 0, total_saidas: 0 }

export default function RazaoFinanceiroPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [contas, setContas] = useState<Conta[]>([])
  const [dataInicio, setDataInicio] = useState<string>(isoMinus(30))
  const [dataFim, setDataFim] = useState<string>(isoToday())

  const [razao, setRazao] = useState<RazaoConta[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [semPlano, setSemPlano] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)

  // contas ativas da empresa (mesma leitura RLS do Extrato)
  useEffect(() => {
    let ignore = false
    if (!empresaUnica) return
    ;(async () => {
      const { data } = await supabase
        .from('erp_banco_contas').select('id, nome')
        .eq('company_id', empresaUnica).eq('ativo', true)
        .order('nome')
      if (!ignore) setContas((data ?? []) as Conta[])
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  // uma chamada à RPC provada por conta — monta o razão por conta no período
  useEffect(() => {
    let ignore = false
    if (!empresaUnica) return
    if (contas.length === 0) { setRazao([]); setLoading(false); return }
    ;(async () => {
      setLoading(true)
      try {
        const res = await Promise.all(contas.map(async (conta) => {
          const { data, error } = await supabase.rpc('fn_ge_extrato_conta', {
            p_company_id: empresaUnica,
            p_conta_id: conta.id,
            p_data_inicio: dataInicio,
            p_data_fim: dataFim,
          })
          if (error) {
            return { conta, total: ZERO, movs: [], semPlano: false, erro: erroAmigavel(error, 'Falha ao carregar.') } as RazaoConta
          }
          const d = data as { sem_plano?: boolean; resultados?: Mov[]; totalizadores?: Totalizadores }
          if (d && d.sem_plano) {
            return { conta, total: ZERO, movs: [], semPlano: true, erro: null } as RazaoConta
          }
          return {
            conta,
            total: d?.totalizadores ?? ZERO,
            movs: (d?.resultados ?? []) as Mov[],
            semPlano: false,
            erro: null,
          } as RazaoConta
        }))
        if (ignore) return
        if (res.length > 0 && res.every((r) => r.semPlano)) {
          setSemPlano(true); setRazao([]); setErro(null)
        } else {
          setSemPlano(false); setRazao(res); setErro(null)
        }
      } catch (e) {
        if (!ignore) { setErro(erroAmigavel(e, 'Não foi possível montar o razão. Tente de novo.')); setRazao([]) }
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [empresaUnica, contas, dataInicio, dataFim])

  const consolidado = useMemo<Totalizadores>(() => {
    return razao.reduce((acc, r) => ({
      saldo_anterior: acc.saldo_anterior + Number(r.total.saldo_anterior ?? 0),
      saldo_atual: acc.saldo_atual + Number(r.total.saldo_atual ?? 0),
      total_entradas: acc.total_entradas + Number(r.total.total_entradas ?? 0),
      total_saidas: acc.total_saidas + Number(r.total.total_saidas ?? 0),
    }), { ...ZERO })
  }, [razao])

  const totalLancamentos = useMemo(() => razao.reduce((s, r) => s + r.movs.length, 0), [razao])

  function exportarCSV() {
    const head = ['Conta', 'Saldo inicial', 'Entradas', 'Saídas', 'Saldo final', 'Lançamentos']
    const rows = razao.map((r) => [
      r.conta.nome.replace(/"/g, '""'),
      Number(r.total.saldo_anterior ?? 0).toFixed(2).replace('.', ','),
      Number(r.total.total_entradas ?? 0).toFixed(2).replace('.', ','),
      Number(r.total.total_saidas ?? 0).toFixed(2).replace('.', ','),
      Number(r.total.saldo_atual ?? 0).toFixed(2).replace('.', ','),
      String(r.movs.length),
    ])
    rows.push([
      'TOTAL DO GRUPO',
      consolidado.saldo_anterior.toFixed(2).replace('.', ','),
      consolidado.total_entradas.toFixed(2).replace('.', ','),
      consolidado.total_saidas.toFixed(2).replace('.', ','),
      consolidado.saldo_atual.toFixed(2).replace('.', ','),
      String(totalLancamentos),
    ])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `razao_financeiro_${dataInicio}_a_${dataFim}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma única empresa para ver o razão financeiro por conta.</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={backLink}>
          ← Painel Gestão Empresarial
        </button>

        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
          Razão Financeiro
        </h1>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
            {loading ? 'Carregando…' : `${fmtDate(dataInicio)} a ${fmtDate(dataFim)} · ${contas.length} conta(s) · ${totalLancamentos} lançamento(s)`}
          </p>
          {razao.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button onClick={exportarCSV} style={quickBtn}>Exportar CSV</button>
              <AjudaCampo chave="ge.razao.acao.exportar" rota={ROTA_AJUDA} />
            </span>
          )}
        </div>

        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#FAF7F2', padding: '8px 0 16px', marginBottom: 16, borderBottom: '0.5px solid rgba(61,35,20,0.08)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <span style={campoCaption}>Período rápido<AjudaCampo chave="ge.razao.acao.periodo_rapido" rota={ROTA_AJUDA} /></span>
            <button type="button" onClick={() => { setDataInicio(isoMinus(7)); setDataFim(isoToday()) }} style={quickBtn}>7 dias</button>
            <button type="button" onClick={() => { setDataInicio(isoMinus(30)); setDataFim(isoToday()) }} style={quickBtn}>30 dias</button>
            <button type="button" onClick={() => { setDataInicio(isoMinus(90)); setDataFim(isoToday()) }} style={quickBtn}>90 dias</button>
            <button type="button" onClick={() => { const h = new Date(); setDataInicio(toISO(new Date(h.getFullYear(), h.getMonth(), 1))); setDataFim(toISO(new Date(h.getFullYear(), h.getMonth() + 1, 0))) }} style={quickBtn}>Mês atual</button>
            <button type="button" onClick={() => { const h = new Date(); setDataInicio(toISO(new Date(h.getFullYear(), h.getMonth() - 1, 1))); setDataFim(toISO(new Date(h.getFullYear(), h.getMonth(), 0))) }} style={quickBtn}>Mês passado</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={campoFiltro}>
              <span style={campoCaption}>De<AjudaCampo chave="ge.razao.filtro.data_inicio" rota={ROTA_AJUDA} /></span>
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={input} />
            </label>
            <label style={campoFiltro}>
              <span style={campoCaption}>Até<AjudaCampo chave="ge.razao.filtro.data_fim" rota={ROTA_AJUDA} /></span>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={input} />
            </label>
          </div>
        </div>

        {!erro && !semPlano && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Card label="Saldo inicial do grupo" ajudaChave="ge.razao.kpi.saldo_inicial" valor={`R$ ${fmt(consolidado.saldo_anterior)}`} cor="rgba(61,35,20,0.55)" sub={`antes de ${fmtDate(dataInicio)}`} />
            <Card label="Entradas (período)" ajudaChave="ge.razao.kpi.entradas" valor={`+ R$ ${fmt(consolidado.total_entradas)}`} cor="#3B6D11" />
            <Card label="Saídas (período)" ajudaChave="ge.razao.kpi.saidas" valor={`− R$ ${fmt(consolidado.total_saidas)}`} cor="#A32D2D" />
            <Card label="Saldo final do grupo" ajudaChave="ge.razao.kpi.saldo_final" valor={`R$ ${fmt(consolidado.saldo_atual)}`} cor={consolidado.saldo_atual < 0 ? '#A32D2D' : '#3B6D11'} sub={`em ${fmtDate(dataFim)}`} destaque />
          </div>
        )}

        {loading ? (
          <div style={{ ...emptyBox, color: 'rgba(61,35,20,0.55)' }}>Montando o razão por conta…</div>
        ) : erro ? (
          <div style={emptyBox}>
            <div style={{ fontSize: 14, color: '#A32D2D', marginBottom: 6, fontWeight: 600 }}>Não foi possível montar o razão</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)' }}>{erro}</div>
          </div>
        ) : semPlano ? (
          <div style={emptyBox}>
            <div style={{ fontSize: 14, color: '#3D2314', marginBottom: 6, fontWeight: 600 }}>Razão indisponível para esta empresa</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)', marginBottom: 16 }}>
              O Razão Financeiro faz parte da Gestão Empresarial, que ainda não está ativa nesta empresa. Fale com o responsável pelo plano para liberar.
            </div>
            <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={primaryBtn}>Ver Gestão Empresarial</button>
          </div>
        ) : contas.length === 0 ? (
          <div style={emptyBox}>
            <div style={{ fontSize: 14, color: '#3D2314', marginBottom: 6, fontWeight: 600 }}>Nenhuma conta cadastrada</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', marginBottom: 16 }}>
              O razão organiza os lançamentos por conta bancária/caixa. Cadastre uma conta para começar.
            </div>
            <button onClick={() => router.push('/dashboard/financeiro/conexoes-bancarias')} style={primaryBtn}>Cadastrar conta</button>
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
              <thead>
                <tr style={{ background: 'rgba(61,35,20,0.04)' }}>
                  <th style={{ ...th, width: 28 }} aria-label="Expandir conta"><AjudaCampo chave="ge.razao.acao.expandir" rota={ROTA_AJUDA} /></th>
                  <th style={th}>Conta<AjudaCampo chave="ge.razao.col.conta" rota={ROTA_AJUDA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Saldo inicial<AjudaCampo chave="ge.razao.col.saldo_inicial" rota={ROTA_AJUDA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Entradas<AjudaCampo chave="ge.razao.col.entradas" rota={ROTA_AJUDA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Saídas<AjudaCampo chave="ge.razao.col.saidas" rota={ROTA_AJUDA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Saldo final<AjudaCampo chave="ge.razao.col.saldo_final" rota={ROTA_AJUDA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Lançamentos<AjudaCampo chave="ge.razao.col.lancamentos" rota={ROTA_AJUDA} /></th>
                </tr>
              </thead>
              <tbody>
                {razao.map((r) => {
                  const aberta = expandida === r.conta.id
                  const saldoFinalCor = Number(r.total.saldo_atual ?? 0) < 0 ? '#A32D2D' : '#3D2314'
                  return (
                    <RazaoLinha
                      key={r.conta.id}
                      r={r}
                      aberta={aberta}
                      saldoFinalCor={saldoFinalCor}
                      onToggle={() => setExpandida(aberta ? null : r.conta.id)}
                    />
                  )
                })}
                <tr style={{ background: '#FFF8E7', fontWeight: 600 }}>
                  <td style={td}></td>
                  <td style={{ ...td, color: '#3D2314' }}>TOTAL DO GRUPO</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(consolidado.saldo_anterior)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>+ R$ {fmt(consolidado.total_entradas)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#A32D2D', fontVariantNumeric: 'tabular-nums' }}>− R$ {fmt(consolidado.total_saidas)}</td>
                  <td style={{ ...td, textAlign: 'right', color: consolidado.saldo_atual < 0 ? '#A32D2D' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(consolidado.saldo_atual)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalLancamentos}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RazaoLinha({ r, aberta, saldoFinalCor, onToggle }: { r: RazaoConta; aberta: boolean; saldoFinalCor: string; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderTop: '0.5px solid rgba(61,35,20,0.08)', cursor: 'pointer', background: aberta ? 'rgba(200,148,26,0.06)' : undefined }}
      >
        <td style={{ ...td, textAlign: 'center', color: 'rgba(61,35,20,0.55)' }} aria-label={aberta ? 'Recolher' : 'Expandir'}>{aberta ? '▾' : '▸'}</td>
        <td style={{ ...td, fontWeight: 600 }}>
          {r.conta.nome}
          {r.erro && <span style={{ color: '#A32D2D', fontSize: 11, marginLeft: 8 }}>· {r.erro}</span>}
          {r.semPlano && <span style={{ color: 'rgba(61,35,20,0.45)', fontSize: 11, marginLeft: 8 }}>· sem plano</span>}
        </td>
        <td style={{ ...td, textAlign: 'right', color: 'rgba(61,35,20,0.6)', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(r.total.saldo_anterior)}</td>
        <td style={{ ...td, textAlign: 'right', color: '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>+ R$ {fmt(r.total.total_entradas)}</td>
        <td style={{ ...td, textAlign: 'right', color: '#A32D2D', fontVariantNumeric: 'tabular-nums' }}>− R$ {fmt(r.total.total_saidas)}</td>
        <td style={{ ...td, textAlign: 'right', color: saldoFinalCor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(r.total.saldo_atual)}</td>
        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.movs.length}</td>
      </tr>
      {aberta && (
        <tr>
          <td></td>
          <td colSpan={6} style={{ padding: '0 14px 14px' }}>
            {r.movs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.5)', padding: '12px 0' }}>Nenhum lançamento nesta conta no período.</div>
            ) : (
              <div style={{ border: '0.5px solid rgba(61,35,20,0.1)', borderRadius: 6, overflow: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
                  <thead>
                    <tr style={{ background: 'rgba(61,35,20,0.03)' }}>
                      <th style={thSmall}>Data<AjudaCampo chave="ge.razao.det.data" rota={ROTA_AJUDA} /></th>
                      <th style={thSmall}>Descrição<AjudaCampo chave="ge.razao.det.descricao" rota={ROTA_AJUDA} /></th>
                      <th style={{ ...thSmall, textAlign: 'right' }}>Valor<AjudaCampo chave="ge.razao.det.valor" rota={ROTA_AJUDA} /></th>
                      <th style={{ ...thSmall, textAlign: 'right' }}>Saldo<AjudaCampo chave="ge.razao.det.saldo" rota={ROTA_AJUDA} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.movs.map((m) => (
                      <tr key={m.id} style={{ borderTop: '0.5px solid rgba(61,35,20,0.06)' }}>
                        <td style={tdSmall}>{fmtDate(m.data)}</td>
                        <td style={tdSmall}>{m.descricao ?? m.nome_pessoa ?? m.categoria ?? '—'}</td>
                        <td style={{ ...tdSmall, textAlign: 'right', color: m.sinal < 0 ? '#A32D2D' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
                          {m.sinal < 0 ? '− ' : '+ '}R$ {fmt(m.valor)}
                        </td>
                        <td style={{ ...tdSmall, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(m.saldo_acumulado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Card({ label, valor, cor, destaque, sub, ajudaChave }: { label: string; valor: string; cor: string; destaque?: boolean; sub?: string; ajudaChave?: string }) {
  return (
    <div style={{ background: destaque ? '#FFF8E7' : '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderLeft: `3px solid ${cor}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
        {label}
        {ajudaChave && <AjudaCampo chave={ajudaChave} rota={ROTA_AJUDA} />}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const input: React.CSSProperties = { background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3D2314', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const campoFiltro: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const campoCaption: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 600, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }
const th: React.CSSProperties = { textAlign: 'left', padding: '12px 14px', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, whiteSpace: 'nowrap' }
const thSmall: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 10, color: 'rgba(61,35,20,0.5)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', color: '#3D2314', whiteSpace: 'nowrap' }
const tdSmall: React.CSSProperties = { padding: '7px 10px', color: '#3D2314' }
const primaryBtn: React.CSSProperties = { background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const quickBtn: React.CSSProperties = { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const backLink: React.CSSProperties = { background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16 }
const infoBox: React.CSSProperties = { padding: 40, background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }
const emptyBox: React.CSSProperties = { background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: 48, textAlign: 'center' }
