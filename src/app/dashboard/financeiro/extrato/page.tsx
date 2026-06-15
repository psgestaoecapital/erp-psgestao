'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

interface Linha {
  id: string
  data: string
  tipo: 'despesa' | 'receita' | string
  sinal: number
  valor: number
  status: string
  categoria: string | null
  descricao: string | null
  nome_pessoa: string | null
  forma_pagamento: string | null
  saldo_acumulado: number
  numero_documento: string | null
  parcela: string | null
}

interface Extrato {
  periodo: { inicio: string; fim: string }
  resultados: Linha[]
  totalizadores: {
    saldo_anterior: number
    saldo_atual: number
    total_entradas: number
    total_saidas: number
    saldo_base?: number
    data_ancora?: string | null
  }
}

interface Conta {
  id: string
  nome: string
  saldo_atual?: number | null
  saldo_inicial?: number | null
  limite_credito?: number | null
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
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const CATEGORIA_PALETTE = [
  { bg: '#FCE4E4', fg: '#7A2929' },
  { bg: '#E4F0FC', fg: '#1F4A7A' },
  { bg: '#E4FCEA', fg: '#1F6B3A' },
  { bg: '#FCF5E4', fg: '#7A5A1F' },
  { bg: '#F0E4FC', fg: '#4A1F7A' },
  { bg: '#E4FCF8', fg: '#1F6B6B' },
  { bg: '#FCE4F4', fg: '#7A1F5A' },
  { bg: '#EEFCE4', fg: '#3A6B1F' },
]

function hashColor(s: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CATEGORIA_PALETTE[h % CATEGORIA_PALETTE.length]
}

type Tipo = 'todos' | 'entradas' | 'saidas'

export default function ExtratoPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [contas, setContas] = useState<Conta[]>([])
  const [contaId, setContaId] = useState<string>('')
  const [dataInicio, setDataInicio] = useState<string>(isoMinus(30))
  const [dataFim, setDataFim] = useState<string>(isoToday())
  const [tipo, setTipo] = useState<Tipo>('todos')
  const [busca, setBusca] = useState<string>('')
  const [pageSize, setPageSize] = useState<number>(50)
  const [pagina, setPagina] = useState<number>(1)

  const [extrato, setExtrato] = useState<Extrato | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) return
    ;(async () => {
      const { data } = await supabase
        .from('erp_banco_contas').select('id, nome, saldo_atual, saldo_inicial, limite_credito')
        .eq('company_id', empresaUnica).eq('ativo', true)
        .order('nome')
      if (!ignore) setContas((data ?? []) as Conta[])
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.rpc('fn_ge_extrato_conta', {
        p_company_id: empresaUnica,
        p_conta_id: contaId || null,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
      })
      if (!ignore) {
        setExtrato(data as Extrato)
        setPagina(1)
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [empresaUnica, contaId, dataInicio, dataFim])

  const linhasFiltradas = useMemo<Linha[]>(() => {
    if (!extrato) return []
    const buscaLow = busca.trim().toLowerCase()
    return extrato.resultados.filter((l) => {
      if (tipo === 'entradas' && l.sinal <= 0) return false
      if (tipo === 'saidas' && l.sinal >= 0) return false
      if (!buscaLow) return true
      const haystack = `${l.descricao ?? ''} ${l.nome_pessoa ?? ''} ${l.categoria ?? ''}`.toLowerCase()
      return haystack.includes(buscaLow)
    })
  }, [extrato, tipo, busca])

  const totalPaginas = Math.max(1, Math.ceil(linhasFiltradas.length / pageSize))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const linhasPagina = linhasFiltradas.slice((paginaAtual - 1) * pageSize, paginaAtual * pageSize)

  function exportarCSV() {
    const head = ['Data', 'Descrição', 'Categoria', 'Pessoa', 'Valor', 'Saldo Acumulado', 'Status', 'Documento']
    const rows = linhasFiltradas.map((l) => [
      fmtDate(l.data),
      (l.descricao ?? '').replace(/"/g, '""'),
      (l.categoria ?? '').replace(/"/g, '""'),
      (l.nome_pessoa ?? '').replace(/"/g, '""'),
      l.sinal.toFixed(2).replace('.', ','),
      l.saldo_acumulado.toFixed(2).replace('.', ','),
      l.status,
      l.numero_documento ?? '',
    ])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `extrato_${dataInicio}_a_${dataFim}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function drilldown(l: Linha) {
    const destino = l.sinal < 0 ? `/dashboard/financeiro/pagar` : `/dashboard/financeiro/receber`
    router.push(`${destino}?q=${encodeURIComponent(l.descricao ?? '')}`)
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver o extrato.</div>
  }

  const total = extrato?.totalizadores

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={backLink}>
          ← Painel Gestão Empresarial
        </button>

        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
          Extrato Conta Corrente
        </h1>
        <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, marginBottom: 24 }}>
          {extrato ? `${fmtDate(extrato.periodo.inicio)} a ${fmtDate(extrato.periodo.fim)} · ${linhasFiltradas.length} lançamentos` : 'Carregando…'}
        </p>

        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#FAF7F2', padding: '8px 0 16px', marginBottom: 16, borderBottom: '0.5px solid rgba(61,35,20,0.08)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" onClick={() => { setDataInicio(isoToday()); setDataFim(isoToday()) }} style={quickBtn}>Hoje</button>
            <button type="button" onClick={() => { setDataInicio(isoMinus(7)); setDataFim(isoToday()) }} style={quickBtn}>7 dias</button>
            <button type="button" onClick={() => { setDataInicio(isoMinus(30)); setDataFim(isoToday()) }} style={quickBtn}>30 dias</button>
            <button type="button" onClick={() => { setDataInicio(isoMinus(90)); setDataFim(isoToday()) }} style={quickBtn}>90 dias</button>
            <button type="button" onClick={() => { const h = new Date(); setDataInicio(toISO(new Date(h.getFullYear(), h.getMonth(), 1))); setDataFim(toISO(new Date(h.getFullYear(), h.getMonth() + 1, 0))) }} style={quickBtn}>Mês atual</button>
            <button type="button" onClick={() => { const h = new Date(); setDataInicio(toISO(new Date(h.getFullYear(), h.getMonth() - 1, 1))); setDataFim(toISO(new Date(h.getFullYear(), h.getMonth(), 0))) }} style={quickBtn}>Mês passado</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} style={input}>
              <option value="">Todas as contas</option>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={input} />
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={input} />
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} style={input}>
              <option value="todos">Todos os tipos</option>
              <option value="entradas">Só entradas</option>
              <option value="saidas">Só saídas</option>
            </select>
            <input placeholder="Buscar descrição, pessoa, categoria…" value={busca} onChange={(e) => setBusca(e.target.value)} style={input} />
          </div>
        </div>

        {/* ONDA-A-EXTRATO-KPIs-UNIFICADOS-v1: fonte unica = totalizadores do RPC (ancorados no saldo_inicial) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Card
            label="Saldo inicial"
            valor={`R$ ${fmt(total?.saldo_base)}`}
            cor="rgba(61,35,20,0.55)"
            sub={total?.data_ancora ? `em ${fmtDate(total.data_ancora)}` : '—'}
          />
          <Card label="Entradas (período)" valor={`+ R$ ${fmt(total?.total_entradas)}`} cor="#3B6D11" />
          <Card label="Saídas (período)" valor={`− R$ ${fmt(total?.total_saidas)}`} cor="#A32D2D" />
          <Card
            label="Saldo atual"
            valor={`R$ ${fmt(total?.saldo_atual)}`}
            cor={Number(total?.saldo_atual ?? 0) < 0 ? '#A32D2D' : '#3B6D11'}
            destaque
          />
        </div>

        {loading ? (
          <div style={{ ...emptyBox, color: 'rgba(61,35,20,0.55)' }}>Carregando lançamentos…</div>
        ) : linhasFiltradas.length === 0 ? (
          <div style={emptyBox}>
            <div style={{ fontSize: 14, color: '#3D2314', marginBottom: 6, fontWeight: 600 }}>Nenhum movimento no período</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', marginBottom: 16 }}>
              Importe seu extrato ou aguarde primeiros lançamentos.
            </div>
            <button onClick={() => router.push('/dashboard/financeiro/conciliacao')} style={primaryBtn}>
              Importar OFX
            </button>
          </div>
        ) : (
          <>
            <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(61,35,20,0.04)' }}>
                    <th style={th}>Data</th>
                    <th style={th}>Descrição</th>
                    <th style={th}>Categoria</th>
                    <th style={th}>Pessoa</th>
                    <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, width: 36 }} aria-label="Editar"></th>
                  </tr>
                </thead>
                <tbody>
                  {linhasPagina.map((l, idx) => {
                    const parcelaVisivel = l.parcela && l.parcela.trim() !== '' && l.parcela !== '1/1' && l.parcela !== '001/001'
                    const categoriaCor = l.categoria ? hashColor(l.categoria) : null
                    return (
                    <tr key={l.id} style={{ borderTop: '0.5px solid rgba(61,35,20,0.08)', background: idx % 2 ? 'rgba(61,35,20,0.015)' : 'transparent' }}>
                      <td style={td}>{fmtDate(l.data)}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{l.descricao ?? '—'}</span>
                          {parcelaVisivel && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(61,35,20,0.65)', background: 'rgba(61,35,20,0.06)', padding: '1px 6px', borderRadius: 3 }} title="Parcela atual / total">
                              parcela {l.parcela}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        {l.categoria && categoriaCor ? (
                          <span style={{ fontSize: 11, fontWeight: 600, color: categoriaCor.fg, background: categoriaCor.bg, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                            {l.categoria}
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(61,35,20,0.45)', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ ...td, color: 'rgba(61,35,20,0.85)', fontSize: 12 }}>{l.nome_pessoa ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.sinal < 0 ? '#A32D2D' : '#3B6D11', fontWeight: 600 }}>
                        {l.sinal < 0 ? '−' : '+'} R$ {fmt(Math.abs(l.sinal))}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#3D2314' }}>R$ {fmt(l.saldo_acumulado)}</td>
                      <td style={td}>
                        <span style={statusBadge(l.status)}>{l.status}</span>
                      </td>
                      <td style={td}>
                        <button type="button" onClick={() => drilldown(l)} style={pencilBtn} title="Abrir registro" aria-label="Abrir registro">
                          ✎
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)' }}>Por página:</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPagina(1) }} style={{ ...input, width: 80 }}>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <span style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)' }}>
                  {(paginaAtual - 1) * pageSize + 1}–{Math.min(paginaAtual * pageSize, linhasFiltradas.length)} de {linhasFiltradas.length}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPagina(Math.max(1, paginaAtual - 1))} disabled={paginaAtual <= 1} style={secondaryBtn(paginaAtual <= 1)}>← Anterior</button>
                <button onClick={() => setPagina(Math.min(totalPaginas, paginaAtual + 1))} disabled={paginaAtual >= totalPaginas} style={secondaryBtn(paginaAtual >= totalPaginas)}>Próxima →</button>
                <button onClick={exportarCSV} style={primaryBtn}>Exportar CSV</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, valor, cor, destaque, sub }: { label: string; valor: string; cor: string; destaque?: boolean; sub?: string }) {
  return (
    <div style={{
      background: destaque ? '#FFF8E7' : '#FFFFFF',
      border: '0.5px solid rgba(61,35,20,0.12)',
      borderLeft: `3px solid ${cor}`,
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const input: React.CSSProperties = {
  background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.2)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  color: '#3D2314',
  fontFamily: 'inherit',
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 11,
  color: 'rgba(61,35,20,0.55)',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '10px 14px',
  color: '#3D2314',
  whiteSpace: 'nowrap',
}

const primaryBtn: React.CSSProperties = {
  background: '#C8941A',
  color: '#3D2314',
  border: 'none',
  padding: '10px 18px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const quickBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.25)',
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const pencilBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'rgba(61,35,20,0.55)',
  fontSize: 14,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: disabled ? 'rgba(61,35,20,0.3)' : '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.2)',
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function statusBadge(status: string): React.CSSProperties {
  const map: Record<string, { fg: string; bg: string }> = {
    pago: { fg: '#3B6D11', bg: '#EAF3DE' },
    recebido: { fg: '#3B6D11', bg: '#EAF3DE' },
    aberto: { fg: '#BA7517', bg: '#FAEEDA' },
  }
  const tone = map[status] ?? { fg: 'rgba(61,35,20,0.65)', bg: 'rgba(61,35,20,0.08)' }
  return {
    background: tone.bg,
    color: tone.fg,
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  }
}

const backLink: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'rgba(61,35,20,0.55)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
  marginBottom: 16,
}

const loadingBox: React.CSSProperties = {
  padding: 40,
  textAlign: 'center',
  color: 'rgba(61,35,20,0.65)',
  background: '#FAF7F2',
  minHeight: '100vh',
}

const infoBox: React.CSSProperties = {
  padding: 40,
  background: '#FAF7F2',
  minHeight: '100vh',
  color: '#3D2314',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.12)',
  borderRadius: 8,
  padding: 48,
  textAlign: 'center',
}
