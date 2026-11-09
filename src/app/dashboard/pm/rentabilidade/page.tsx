'use client'
// RENTABILIDADE POR CLIENTE (P&M) — slice 2 da margem por cliente/serviço (Blueprint P&M §3/§6).
// Mostra as DESPESAS INDIRETAS da GE (erp_pagar tipo=despesa, sem contrato) RATEADAS por cliente, por participação
// no critério configurado (receita ou horas). É a "base da margem": margem = receita − custos diretos − indiretas
// rateadas. Os custos diretos entram num próximo slice; aqui mostramos honestamente só a parte das indiretas +
// as "despesas a classificar" (sem conta no plano) à parte, sem mascarar (RD-38).
// Somente leitura: consome a RPC fn_pm_indiretas_rateio (guarda fn_pm_pode_ver_margem, SECURITY DEFINER). Escopo por
// company_id. Tema Espresso (RD-96). "?" em tudo (RD-95).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/rentabilidade'
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const RED = '#7A1F1F'; const CARD = '#FFFFFF'

const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: number) => (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const pct = (v: number) => `${(v ?? 0).toFixed(2)}%`

type ClienteRateio = {
  cliente_id: string
  cliente_nome: string
  base: number
  participacao_pct: number
  indiretas_rateadas: number
}
type Rateio = {
  ok: boolean
  erro?: string
  criterio: 'receita' | 'horas'
  base_unidade: 'receita' | 'horas'
  total_indiretas: number
  base_total: number
  nao_classificado: { n: number; valor: number }
  clientes: ClienteRateio[]
}

const hoje = new Date()
const anoAtual = hoje.getFullYear()
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function RentabilidadePage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [ini, setIni] = useState(`${anoAtual}-01-01`)
  const [fim, setFim] = useState(iso(hoje))
  const [dados, setDados] = useState<Rateio | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa || !ini || !fim) return
    setLoading(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_pm_indiretas_rateio', {
        p_company_id: empresa, p_ini: ini, p_fim: fim,
      })
      if (error) { console.error('rentabilidade: falha na RPC fn_pm_indiretas_rateio', error); setErro('Não foi possível calcular a rentabilidade. Tente novamente.'); setDados(null); return }
      const r = data as Rateio
      if (!r?.ok) {
        setErro(r?.erro === 'sem_acesso'
          ? 'Você não tem permissão para ver margem/rentabilidade nesta empresa.'
          : r?.erro === 'periodo_invalido' ? 'Período inválido.' : 'Não foi possível calcular.')
        setDados(null); return
      }
      setDados(r)
    } catch (e: any) { console.error('rentabilidade: erro ao calcular', e); setErro('Não foi possível calcular a rentabilidade. Tente novamente.'); setDados(null) }
    finally { setLoading(false) }
  }, [empresa, ini, fim])

  useEffect(() => { carregar() }, [carregar])

  const unidade = dados?.base_unidade === 'horas' ? 'horas' : 'receita'
  const totalRateado = useMemo(
    () => (dados?.clientes ?? []).reduce((s, c) => s + (c.indiretas_rateadas ?? 0), 0),
    [dados],
  )

  const label: CSSProperties = { fontSize: 13, color: TEXTM, display: 'flex', alignItems: 'center', gap: 4 }
  const inputS: CSSProperties = {
    border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 14,
    color: ESPRESSO, background: CARD, fontFamily: 'inherit',
  }
  const kpi: CSSProperties = {
    background: CARD, border: `1px solid ${BORDA}`, borderRadius: 12, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
  }
  const kpiVal: CSSProperties = { fontSize: 22, fontWeight: 700, color: ESPRESSO, fontFamily: 'Fraunces, Georgia, serif' }

  return (
    <div style={{ padding: 20, background: OFFWHITE, minHeight: '100%', color: ESPRESSO }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: 'Fraunces, Georgia, serif', margin: 0 }}>
          Rentabilidade por cliente
        </h1>
        <p style={{ color: TEXTM, fontSize: 14, margin: '6px 0 0', maxWidth: 680 }}>
          Despesas <strong>indiretas</strong> da empresa rateadas por cliente, pela participação em{' '}
          <strong>{unidade === 'horas' ? 'horas trabalhadas' : 'receita'}</strong>. É a base da margem —
          os custos diretos de cada etapa entram num próximo passo.
        </p>
      </header>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <label style={{ ...label, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Período <AjudaCampo chave="pm.rentab.periodo" rota={ROTA} />
          </span>
          <input type="date" aria-label="Data inicial" value={ini} onChange={e => setIni(e.target.value)} style={inputS} />
          <span style={{ color: TEXTM }}>até</span>
          <input type="date" aria-label="Data final" value={fim} onChange={e => setFim(e.target.value)} style={inputS} />
        </label>
        {dados && (
          <div style={{ ...label, paddingBottom: 8 }}>
            Critério de rateio: <strong style={{ color: ESPRESSO }}>{dados.criterio === 'horas' ? 'Horas' : 'Receita'}</strong>
            <AjudaCampo chave="pm.rentab.criterio" rota={ROTA} />
          </div>
        )}
      </div>

      {erro && (
        <div style={{ background: '#FBEAEA', border: `1px solid ${RED}33`, color: RED, borderRadius: 10, padding: 14, marginBottom: 16 }}>
          {erro}
        </div>
      )}
      {loading && <div style={{ color: TEXTM, padding: 12 }}>Calculando…</div>}

      {dados && !loading && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 18 }}>
            <div style={kpi}>
              <span style={label}>Total das indiretas <AjudaCampo chave="pm.rentab.total_indiretas" rota={ROTA} /></span>
              <span style={kpiVal}>{brl(dados.total_indiretas)}</span>
            </div>
            <div style={kpi}>
              <span style={label}>Base de rateio ({unidade === 'horas' ? 'horas' : 'receita'}) <AjudaCampo chave="pm.rentab.base_total" rota={ROTA} /></span>
              <span style={kpiVal}>{unidade === 'horas' ? `${num(dados.base_total)} h` : brl(dados.base_total)}</span>
            </div>
            <div style={kpi}>
              <span style={label}>Despesas a classificar <AjudaCampo chave="pm.rentab.nao_classificado" rota={ROTA} /></span>
              <span style={{ ...kpiVal, color: dados.nao_classificado.valor > 0 ? RED : ESPRESSO }}>{brl(dados.nao_classificado.valor)}</span>
              <span style={{ fontSize: 12, color: TEXTM }}>{dados.nao_classificado.n} lançamento(s) — não rateado</span>
            </div>
          </div>

          {/* RD-98 pilar 1: estado vazio das indiretas — a tela não pode parecer morta.
              Quando NÃO há nenhuma despesa indireta no período (nem rateada, nem a classificar),
              oriente o empresário a lançar/classificar as despesas na GE e dê o botão para fazer. */}
          {dados.total_indiretas === 0 && dados.nao_classificado.valor === 0 && (
            <div style={{ background: '#FDF6E9', border: `1px solid ${DOURADO}55`, borderRadius: 10, padding: 16, marginBottom: 16, fontSize: 13, color: '#7A5A0F' }}>
              <p style={{ margin: 0, fontWeight: 700, color: ESPRESSO, fontSize: 14 }}>Nenhuma despesa indireta para ratear no período</p>
              <p style={{ margin: '6px 0 0' }}>
                A rentabilidade só aparece quando a empresa tem <strong>despesas indiretas</strong> lançadas em Contas a pagar
                (tipo despesa, sem contrato), <strong>com conta do plano</strong> e <strong>data dentro do período</strong>.
                Lance ou classifique essas despesas na Gestão Empresarial para que sejam rateadas entre os clientes.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                <Link href="/dashboard/financeiro/pagar" style={{ background: ESPRESSO, color: OFFWHITE, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  Ir para Contas a pagar
                </Link>
                <Link href="/dashboard/cadastros/plano-contas" style={{ background: CARD, color: ESPRESSO, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  Plano de contas
                </Link>
              </div>
            </div>
          )}

          {dados.nao_classificado.valor > 0 && (
            <div style={{ background: '#FDF6E9', border: `1px solid ${DOURADO}55`, borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: '#7A5A0F' }}>
              {brl(dados.nao_classificado.valor)} em {dados.nao_classificado.n} despesa(s) sem conta no plano não entraram no
              rateio. Classifique-as no plano de contas para que sejam distribuídas entre os clientes.
            </div>
          )}

          {/* Tabela */}
          {dados.clientes.length === 0 ? (
            <div style={{ background: CARD, border: `1px dashed ${BORDA}`, borderRadius: 12, padding: 32, textAlign: 'center', color: TEXTM }}>
              <p style={{ margin: 0, fontWeight: 600, color: ESPRESSO }}>Nenhum cliente com base no período</p>
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                Não há {unidade === 'horas' ? 'horas apontadas' : 'receita lançada'} por cliente entre as datas escolhidas.
                Ajuste o período ou registre o faturamento/apontamento dos clientes.
              </p>
            </div>
          ) : (
            <div style={{ background: CARD, border: `1px solid ${BORDA}`, borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead>
                  <tr style={{ background: '#F4EEE6' }}>
                    <th style={th()}>Cliente <AjudaCampo chave="pm.rentab.cliente" rota={ROTA} /></th>
                    <th style={th('right')}>{unidade === 'horas' ? 'Horas' : 'Receita'} <AjudaCampo chave="pm.rentab.base" rota={ROTA} alinhar="fim" /></th>
                    <th style={th('right')}>Participação <AjudaCampo chave="pm.rentab.participacao" rota={ROTA} alinhar="fim" /></th>
                    <th style={th('right')}>Indiretas rateadas <AjudaCampo chave="pm.rentab.indiretas_rateadas" rota={ROTA} alinhar="fim" /></th>
                  </tr>
                </thead>
                <tbody>
                  {dados.clientes.map((c, i) => (
                    <tr key={`${c.cliente_id}-${i}`} style={{ borderTop: `1px solid ${BORDA}` }}>
                      <td style={td()}>{c.cliente_nome}</td>
                      <td style={td('right')}>{unidade === 'horas' ? `${num(c.base)} h` : brl(c.base)}</td>
                      <td style={td('right')}>{pct(c.participacao_pct)}</td>
                      <td style={td('right')}>{brl(c.indiretas_rateadas)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${ESPRESSO}22`, background: '#F4EEE6', fontWeight: 700 }}>
                    <td style={td()}>Total ({dados.clientes.length} cliente(s))</td>
                    <td style={td('right')}>{unidade === 'horas' ? `${num(dados.base_total)} h` : brl(dados.base_total)}</td>
                    <td style={td('right')}>100%</td>
                    <td style={td('right')}>{brl(totalRateado)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function th(align: 'left' | 'right' = 'left'): CSSProperties {
  return { textAlign: align, padding: '10px 14px', fontSize: 12, color: TEXTM, fontWeight: 600, whiteSpace: 'nowrap' }
}
function td(align: 'left' | 'right' = 'left'): CSSProperties {
  return { textAlign: align, padding: '10px 14px', fontSize: 14, color: ESPRESSO, whiteSpace: 'nowrap' }
}
