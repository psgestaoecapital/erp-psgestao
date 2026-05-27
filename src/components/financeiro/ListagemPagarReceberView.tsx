'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import MarcarPagoModal from './MarcarPagoModal'
import MarcarPagoLoteModal from './MarcarPagoLoteModal'

type Tipo = 'pagar' | 'receber'

type Situacao = 'pago' | 'vencido' | 'hoje' | 'a_vencer'

type Resultado = {
  id: string
  descricao: string
  nome_pessoa: string | null
  categoria: string | null
  valor_documento: number
  valor_pago: number | null
  data_vencimento: string
  data_pagamento: string | null
  status: string
  situacao: Situacao
  numero_documento: string | null
  forma_pagamento: string | null
}

type KpiBlock = { valor: number; qtd: number }

type Resposta = {
  sem_plano?: boolean
  tipo: Tipo
  periodo: { data_inicio: string; data_fim: string }
  kpis: {
    vencidos: KpiBlock
    hoje: KpiBlock
    avencer: KpiBlock
    pagos: KpiBlock
    total: number
  }
  resultados: Resultado[]
}

const PAGE_SIZE = 20

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

const fmtData = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

type PeriodoChoice = 'mes_atual' | 'mes_passado' | 'ano_atual' | 'personalizado'

interface Props {
  companyId: string
  tipo: Tipo
}

export default function ListagemPagarReceberView({ companyId, tipo }: Props) {
  const labels = useMemo(() => labelsPorTipo(tipo), [tipo])

  const hoje = new Date()
  const toISO = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const inicioMesAtual = () => toISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const fimMesAtual = () => toISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0))
  const [dataInicio, setDataInicio] = useState<string>(inicioMesAtual())
  const [dataFim, setDataFim] = useState<string>(fimMesAtual())
  const [pagandoItem, setPagandoItem] = useState<Resultado | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const [periodoChoice, setPeriodoChoice] = useState<PeriodoChoice>('mes_atual')
  const [statusFiltro, setStatusFiltro] = useState<'todos' | 'avencer' | 'vencidos' | 'pagos' | 'hoje'>('todos')
  const [categoria, setCategoria] = useState('')
  const [busca, setBusca] = useState('')
  const [page, setPage] = useState(1)

  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true)
    setErro(null)
    supabase
      .rpc('fn_ge_listagem_v2', {
        p_company_id: companyId,
        p_tipo: tipo,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        p_status_filtro: statusFiltro,
      })
      .then(({ data, error }) => {
        if (!alive) return
        setLoading(false)
        if (error) {
          setErro(error.message)
          return
        }
        setData(data as Resposta)
        setPage(1)
      })
    return () => {
      alive = false
    }
  }, [companyId, tipo, dataInicio, dataFim, statusFiltro, reloadKey])

  const resultadosFiltrados = useMemo(() => {
    const base = data?.resultados ?? []
    const q = busca.trim().toLowerCase()
    return base.filter((r) => {
      if (categoria && r.categoria !== categoria) return false
      if (q) {
        const hay = `${r.descricao} ${r.nome_pessoa ?? ''} ${r.numero_documento ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, busca, categoria])

  const idsSelecionaveis = useMemo(
    () => resultadosFiltrados.filter((r) => r.situacao !== 'pago').map((r) => r.id),
    [resultadosFiltrados],
  )
  const valorTotalSelecionados = useMemo(() => {
    return resultadosFiltrados
      .filter((r) => selecionados.has(r.id))
      .reduce((s, r) => s + (r.valor_documento - (r.valor_pago ?? 0)), 0)
  }, [resultadosFiltrados, selecionados])

  function toggleSelecionado(id: string) {
    const ns = new Set(selecionados)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setSelecionados(ns)
  }
  function toggleTodos() {
    if (selecionados.size === idsSelecionaveis.length && idsSelecionaveis.length > 0) {
      setSelecionados(new Set())
    } else {
      setSelecionados(new Set(idsSelecionaveis))
    }
  }
  function limparSelecao() { setSelecionados(new Set()) }

  useEffect(() => { setSelecionados(new Set()) }, [companyId, tipo, dataInicio, dataFim, statusFiltro, reloadKey])

  const totalPages = Math.max(1, Math.ceil(resultadosFiltrados.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const pageStart = (pageSafe - 1) * PAGE_SIZE
  const pageItems = resultadosFiltrados.slice(pageStart, pageStart + PAGE_SIZE)

  const categoriasDistinct = useMemo(() => {
    const set = new Set<string>()
    ;(data?.resultados ?? []).forEach((r) => {
      if (r.categoria) set.add(r.categoria)
    })
    return Array.from(set).sort()
  }, [data])

  function aplicarPeriodo(choice: PeriodoChoice) {
    setPeriodoChoice(choice)
    const ref = new Date()
    if (choice === 'mes_atual') {
      setDataInicio(toISO(new Date(ref.getFullYear(), ref.getMonth(), 1)))
      setDataFim(toISO(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)))
    } else if (choice === 'mes_passado') {
      setDataInicio(toISO(new Date(ref.getFullYear(), ref.getMonth() - 1, 1)))
      setDataFim(toISO(new Date(ref.getFullYear(), ref.getMonth(), 0)))
    } else if (choice === 'ano_atual') {
      setDataInicio(toISO(new Date(ref.getFullYear(), 0, 1)))
      setDataFim(toISO(new Date(ref.getFullYear(), 11, 31)))
    }
  }

  if (data?.sem_plano) {
    return (
      <Wrapper>
        <Header labels={labels} />
        <div
          style={{
            background: '#FFF7ED',
            border: '0.5px solid rgba(200,148,26,0.4)',
            borderRadius: 12,
            padding: '20px 24px',
            color: '#854F0B',
            fontSize: 13,
            maxWidth: 720,
          }}
        >
          Esta empresa ainda não tem o plano <strong>Gestão Empresarial Pro</strong> ativo.
          Ative o plano pra ver as {labels.tipoPlural}.
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <Header labels={labels} />

      {/* KPIs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <KpiCard
          titulo="A vencer"
          valor={data?.kpis.avencer.valor ?? 0}
          qtd={data?.kpis.avencer.qtd ?? 0}
          cor="#C8941A"
        />
        <KpiCard
          titulo="Vencidos"
          valor={data?.kpis.vencidos.valor ?? 0}
          qtd={data?.kpis.vencidos.qtd ?? 0}
          cor="#DC2626"
          destaque={(data?.kpis.vencidos.qtd ?? 0) > 0}
        />
        <KpiCard
          titulo={labels.pagosLabel}
          valor={data?.kpis.pagos.valor ?? 0}
          qtd={data?.kpis.pagos.qtd ?? 0}
          cor="#16A34A"
        />
        <KpiCard
          titulo="Hoje"
          valor={data?.kpis.hoje.valor ?? 0}
          qtd={data?.kpis.hoje.qtd ?? 0}
          cor="#3D2314"
        />
      </div>

      {/* Filtros */}
      <div
        style={{
          background: '#FFFFFF',
          border: '0.5px solid rgba(61,35,20,0.12)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <Campo label="Período">
          <select value={periodoChoice} onChange={(e) => aplicarPeriodo(e.target.value as PeriodoChoice)} style={inputStyle}>
            <option value="mes_atual">Mês atual ({MESES[hoje.getMonth()]})</option>
            <option value="mes_passado">Mês passado</option>
            <option value="ano_atual">Este ano</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </Campo>

        {periodoChoice === 'personalizado' && (
          <>
            <Campo label="Data início">
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                style={inputStyle}
              />
            </Campo>
            <Campo label="Data fim">
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                style={inputStyle}
              />
            </Campo>
          </>
        )}

        <Campo label="Status">
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as typeof statusFiltro)} style={inputStyle}>
            <option value="todos">Todos</option>
            <option value="avencer">A vencer</option>
            <option value="vencidos">Vencidos</option>
            <option value="hoje">Hoje</option>
            <option value="pagos">{labels.pagosLabel}</option>
          </select>
        </Campo>

        <Campo label="Categoria">
          <select value={categoria} onChange={(e) => { setCategoria(e.target.value); setPage(1) }} style={inputStyle}>
            <option value="">Todas</option>
            {categoriasDistinct.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Campo>

        <Campo label="Buscar">
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(1) }}
            placeholder="descrição, quem, documento..."
            style={inputStyle}
          />
        </Campo>
      </div>

      {/* Erro */}
      {erro && (
        <div
          style={{
            background: '#FCEBEB',
            color: '#A32D2D',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {erro}
        </div>
      )}

      {/* Tabela / Cards */}
      <div
        style={{
          background: '#FFFFFF',
          border: '0.5px solid rgba(61,35,20,0.12)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(61,35,20,0.55)', fontSize: 13 }}>
            Carregando...
          </div>
        ) : pageItems.length === 0 ? (
          <EmptyState labels={labels} />
        ) : (
          <>
            {selecionados.size > 0 && (
              <div style={{
                position: 'sticky', top: 0, zIndex: 5,
                background: '#3D2314', color: '#FAF7F2',
                padding: '12px 16px', borderRadius: '12px 12px 0 0',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, flexWrap: 'wrap', marginBottom: -1,
              }}>
                <div style={{ fontSize: 13 }}>
                  ✅ <strong>{selecionados.size}</strong> selecionado{selecionados.size !== 1 ? 's' : ''} · R$ <strong>{fmtBRL(valorTotalSelecionados)}</strong> total
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setLoteAberto(true)}
                    style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {tipo === 'pagar' ? `Marcar ${selecionados.size} pagas` : `Marcar ${selecionados.size} recebidas`}
                  </button>
                  <button
                    type="button"
                    onClick={limparSelecao}
                    style={{ background: 'transparent', color: '#FAF7F2', border: '0.5px solid rgba(250,247,242,0.3)', padding: '8px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                  >
                    Limpar
                  </button>
                </div>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#FAF7F2', borderBottom: '0.5px solid rgba(61,35,20,0.12)' }}>
                    <Th>
                      <input
                        type="checkbox"
                        checked={idsSelecionaveis.length > 0 && selecionados.size === idsSelecionaveis.length}
                        onChange={toggleTodos}
                        disabled={idsSelecionaveis.length === 0}
                        aria-label="Selecionar todos não pagos"
                      />
                    </Th>
                    <Th>Descrição</Th>
                    <Th>Quem</Th>
                    <Th>Categoria</Th>
                    <Th>Vencimento</Th>
                    <Th align="right">Valor</Th>
                    <Th>Status</Th>
                    <Th align="right">Ação</Th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r) => {
                    const pago = r.situacao === 'pago'
                    const checked = selecionados.has(r.id)
                    return (
                      <tr key={r.id} style={{ borderBottom: '0.5px solid rgba(61,35,20,0.06)', background: checked ? 'rgba(200,148,26,0.06)' : 'transparent' }}>
                        <Td>
                          {!pago && (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelecionado(r.id)}
                              aria-label={`Selecionar ${r.descricao}`}
                            />
                          )}
                        </Td>
                        <Td><strong style={{ color: '#3D2314' }}>{r.descricao}</strong>{r.numero_documento && (
                          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)' }}>nº {r.numero_documento}</div>
                        )}</Td>
                        <Td>{r.nome_pessoa || '—'}</Td>
                        <Td><span style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>{r.categoria || '—'}</span></Td>
                        <Td>{fmtData(r.data_vencimento)}</Td>
                        <Td align="right"><strong>{fmtBRL(r.valor_pago ?? r.valor_documento)}</strong></Td>
                        <Td><Pill situacao={r.situacao} /></Td>
                        <Td align="right">
                          {!pago ? (
                            <button
                              type="button"
                              onClick={() => setPagandoItem(r)}
                              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              {tipo === 'pagar' ? 'Marcar pago' : 'Marcar recebido'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 10, color: 'rgba(61,35,20,0.4)' }}>✓ baixado</span>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '0.5px solid rgba(61,35,20,0.12)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                fontSize: 12,
                color: 'rgba(61,35,20,0.65)',
              }}
            >
              <div>
                Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, resultadosFiltrados.length)} de {resultadosFiltrados.length}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe <= 1}
                  style={btnPaginacao(pageSafe <= 1)}
                >
                  Anterior
                </button>
                <span style={{ padding: '6px 4px' }}>
                  Página {pageSafe} de {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe >= totalPages}
                  style={btnPaginacao(pageSafe >= totalPages)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <MarcarPagoModal
        open={!!pagandoItem}
        onClose={() => setPagandoItem(null)}
        onSucesso={() => setReloadKey((k) => k + 1)}
        companyId={companyId}
        tipo={tipo}
        itemId={pagandoItem?.id ?? ''}
        descricao={pagandoItem?.descricao ?? ''}
        valorTotal={pagandoItem ? (pagandoItem.valor_documento - (pagandoItem.valor_pago ?? 0)) : 0}
      />

      <MarcarPagoLoteModal
        open={loteAberto}
        onClose={() => setLoteAberto(false)}
        onSucesso={() => { setReloadKey((k) => k + 1); setSelecionados(new Set()); setLoteAberto(false) }}
        companyId={companyId}
        tipo={tipo}
        ids={Array.from(selecionados)}
        valorTotal={valorTotalSelecionados}
      />
    </Wrapper>
  )
}

// ──────────────────────────────────────────────────────────
// Subcomponentes & helpers

function labelsPorTipo(tipo: Tipo) {
  if (tipo === 'pagar') {
    return {
      breadcrumb: 'Financeiro · Despesas',
      titulo: 'Despesas a pagar',
      subtitulo: 'Acompanhe tudo que você tem para pagar',
      tipoPlural: 'despesas',
      pagosLabel: 'Pagos',
      ctaNovo: 'Nova despesa',
      rotaNovo: '/dashboard/financeiro/nova-despesa',
    }
  }
  return {
    breadcrumb: 'Financeiro · Receitas',
    titulo: 'Receitas a receber',
    subtitulo: 'Acompanhe tudo que você tem para receber',
    tipoPlural: 'receitas',
    pagosLabel: 'Recebidos',
    ctaNovo: 'Nova receita',
    rotaNovo: '/dashboard/financeiro/nova-receita',
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function Header({ labels }: { labels: ReturnType<typeof labelsPorTipo> }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(61,35,20,0.55)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          {labels.breadcrumb}
        </div>
        <h1 style={{ fontSize: 24, color: '#3D2314', margin: 0, fontWeight: 500 }}>{labels.titulo}</h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>{labels.subtitulo}</div>
      </div>
      <Link
        href={labels.rotaNovo + '?area=gestao_empresarial'}
        style={{
          background: '#C8941A',
          color: '#3D2314',
          padding: '10px 22px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        + {labels.ctaNovo}
      </Link>
    </div>
  )
}

function KpiCard({ titulo, valor, qtd, cor, destaque = false }: {
  titulo: string; valor: number; qtd: number; cor: string; destaque?: boolean
}) {
  return (
    <div
      style={{
        background: destaque ? '#FCEBEB' : '#FFFFFF',
        border: `0.5px solid ${destaque ? cor : 'rgba(61,35,20,0.12)'}`,
        borderRadius: 12,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'rgba(61,35,20,0.55)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 8,
        }}
      >
        {titulo}
      </div>
      <div style={{ fontSize: 20, color: cor, fontWeight: 600 }}>{fmtBRL(valor)}</div>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
        {qtd} {qtd === 1 ? 'lançamento' : 'lançamentos'}
      </div>
    </div>
  )
}

function Pill({ situacao }: { situacao: Situacao }) {
  const map: Record<Situacao, { bg: string; cor: string; label: string }> = {
    pago: { bg: '#DCFCE7', cor: '#16A34A', label: 'Pago' },
    a_vencer: { bg: '#FEF3C7', cor: '#C8941A', label: 'A vencer' },
    hoje: { bg: '#FEF3C7', cor: '#C8941A', label: 'Hoje' },
    vencido: { bg: '#FEE2E2', cor: '#DC2626', label: 'Vencido' },
  }
  const s = map[situacao] ?? map.a_vencer
  return (
    <span
      style={{
        background: s.bg,
        color: s.cor,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {s.label}
    </span>
  )
}

function EmptyState({ labels }: { labels: ReturnType<typeof labelsPorTipo> }) {
  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.7)', marginBottom: 12 }}>
        Nenhuma {labels.tipoPlural === 'despesas' ? 'despesa' : 'receita'} encontrada neste período.
        Que tal cadastrar a primeira?
      </div>
      <Link
        href={labels.rotaNovo + '?area=gestao_empresarial'}
        style={{
          display: 'inline-block',
          background: '#C8941A',
          color: '#3D2314',
          padding: '10px 22px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        + {labels.ctaNovo}
      </Link>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'rgba(61,35,20,0.65)',
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        padding: '10px 14px',
        textAlign: align,
        fontSize: 11,
        color: 'rgba(61,35,20,0.55)',
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      style={{
        padding: '12px 14px',
        textAlign: align,
        fontSize: 13,
        color: 'rgba(61,35,20,0.85)',
        verticalAlign: 'top',
      }}
    >
      {children}
    </td>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  background: '#FFFFFF',
  color: '#3D2314',
  fontFamily: 'inherit',
}

const btnPaginacao = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? '#F3EFE8' : '#FFFFFF',
  color: disabled ? 'rgba(61,35,20,0.35)' : '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.25)',
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
})
