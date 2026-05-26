'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

interface Conta {
  id: string
  descricao: string | null
  valor: number
  vencimento: string
  dias_atraso: number
}

interface Cliente {
  cliente_id: string | null
  cliente_nome: string | null
  cnpj: string | null
  telefone: string | null
  whatsapp: string | null
  email: string | null
  qtd_contas: number
  valor_total: number
  dias_max_atraso: number
  dias_medio_atraso: number
  contas: Conta[]
}

interface Resumo {
  qtd_clientes: number
  total_qtd_contas: number
  total_valor: number
  dias_max_atraso: number
}

interface Resposta {
  sem_plano?: boolean
  resumo?: Resumo
  clientes?: Cliente[]
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function InadimplentesPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())
  const [diasMinimo, setDiasMinimo] = useState(0)
  const [valorMinimo, setValorMinimo] = useState(0)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setLoading(false); return }
    ;(async () => {
      setLoading(true)
      const { data: result } = await supabase.rpc('fn_ge_inadimplentes_agrupado', { p_company_id: empresaUnica })
      if (!ignore) { setData(result as Resposta); setLoading(false) }
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  const clientesFiltrados = useMemo<Cliente[]>(() => {
    if (!data?.clientes) return []
    const buscaLow = busca.trim().toLowerCase()
    return data.clientes.filter((c) => {
      if (c.dias_max_atraso < diasMinimo) return false
      if (c.valor_total < valorMinimo) return false
      if (!buscaLow) return true
      const haystack = `${c.cliente_nome ?? ''} ${c.cnpj ?? ''}`.toLowerCase()
      return haystack.includes(buscaLow)
    })
  }, [data, diasMinimo, valorMinimo, busca])

  function toggleCliente(id: string) {
    const ns = new Set(expandido)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setExpandido(ns)
  }

  function whatsappLink(c: Cliente): string | null {
    const tel = (c.whatsapp || c.telefone || '').replace(/\D/g, '')
    if (!tel || tel.length < 10) return null
    const fone = tel.startsWith('55') ? tel : `55${tel}`
    const msg = encodeURIComponent(
      `Olá ${c.cliente_nome}, tudo bem? Identificamos ${c.qtd_contas} título(s) em aberto totalizando R$ ${fmt(c.valor_total)} com até ${c.dias_max_atraso} dias de atraso. Podemos conversar sobre regularização?`
    )
    return `https://wa.me/${fone}?text=${msg}`
  }

  function exportarContador() {
    if (!data?.clientes) return
    const head = ['Cliente', 'CNPJ/CPF', 'Contas', 'Valor Total', 'Dias Atraso Máx', 'Dias Atraso Médio', 'Telefone', 'Email']
    const rows = clientesFiltrados.map((c) => [
      (c.cliente_nome ?? '').replace(/"/g, '""'),
      c.cnpj ?? '',
      String(c.qtd_contas),
      c.valor_total.toFixed(2).replace('.', ','),
      String(c.dias_max_atraso),
      String(c.dias_medio_atraso),
      c.telefone ?? '',
      c.email ?? '',
    ])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inadimplentes_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver inadimplentes.</div>
  }
  if (loading) {
    return <div style={infoBox}>Carregando…</div>
  }
  if (data?.sem_plano) {
    return (
      <div style={{ ...infoBox, textAlign: 'center' }}>
        <h2 style={{ color: '#3D2314', fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400 }}>Plano GE Pró necessário</h2>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={primaryBtn}>Voltar ao painel</button>
      </div>
    )
  }

  const resumo = data?.resumo

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={backLink}>
          ← Painel Gestão Empresarial
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              Inadimplentes Agrupados
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              Clientes com contas em aberto vencidas · ordenados por maior atraso
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportarContador} style={secondaryBtnAtivo}>Exportar contador</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Card label="Clientes inadimplentes" valor={String(resumo?.qtd_clientes ?? 0)} cor="#A32D2D" />
          <Card label="Contas em atraso" valor={String(resumo?.total_qtd_contas ?? 0)} cor="#BA7517" />
          <Card label="Valor total devido" valor={`R$ ${fmt(resumo?.total_valor)}`} cor="#A32D2D" destaque />
          <Card label="Maior atraso (dias)" valor={String(resumo?.dias_max_atraso ?? 0)} cor="#3D2314" />
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <div>
            <label style={filterLabel}>Dias atraso mínimo: {diasMinimo}</label>
            <input type="range" min={0} max={Math.max(90, resumo?.dias_max_atraso ?? 0)} value={diasMinimo}
              onChange={(e) => setDiasMinimo(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={filterLabel}>Valor mínimo: R$ {fmt(valorMinimo)}</label>
            <input type="range" min={0} max={Math.ceil(resumo?.total_valor ?? 10000)} step={100} value={valorMinimo}
              onChange={(e) => setValorMinimo(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
          <input placeholder="Buscar cliente / CNPJ…" value={busca} onChange={(e) => setBusca(e.target.value)} style={input} />
        </div>

        {clientesFiltrados.length === 0 ? (
          <div style={emptyBox}>
            <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
              {(data?.clientes?.length ?? 0) === 0 ? 'Sem inadimplentes' : 'Nenhum cliente bate com os filtros'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
              {(data?.clientes?.length ?? 0) === 0 ? 'Todas as contas a receber estão em dia.' : 'Ajuste filtros acima.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clientesFiltrados.map((c) => {
              const key = c.cliente_id ?? c.cliente_nome ?? Math.random().toString()
              const open = expandido.has(key)
              const wpp = whatsappLink(c)
              const corAtraso = c.dias_max_atraso >= 30 ? '#A32D2D' : c.dias_max_atraso >= 15 ? '#BA7517' : 'rgba(61,35,20,0.55)'
              return (
                <div key={key} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'hidden' }}>
                  <button type="button" onClick={() => toggleCliente(key)} style={clienteHeader(open)}>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.cliente_nome ?? '(sem nome)'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                        {c.cnpj ? `CNPJ ${c.cnpj} · ` : ''}{c.qtd_contas} {c.qtd_contas === 1 ? 'conta' : 'contas'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#A32D2D', fontVariantNumeric: 'tabular-nums' }}>
                        R$ {fmt(c.valor_total)}
                      </div>
                      <div style={{ fontSize: 11, color: corAtraso, marginTop: 2 }}>
                        {c.dias_max_atraso} dias · médio {c.dias_medio_atraso}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, color: 'rgba(61,35,20,0.4)', marginLeft: 12 }}>{open ? '−' : '+'}</div>
                  </button>

                  {open && (
                    <div style={{ padding: '0 16px 16px', borderTop: '0.5px solid rgba(61,35,20,0.08)' }}>
                      <div style={{ display: 'flex', gap: 8, padding: '12px 0', flexWrap: 'wrap' }}>
                        {wpp ? (
                          <a href={wpp} target="_blank" rel="noopener noreferrer" style={whatsappBtn}>
                            Enviar lembrete WhatsApp
                          </a>
                        ) : (
                          <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.45)', alignSelf: 'center' }}>Sem telefone cadastrado</span>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} style={secondaryBtnAtivo}>Email</a>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {c.contas.map((conta) => (
                          <button
                            type="button"
                            key={conta.id}
                            onClick={() => router.push(`/dashboard/financeiro/receber?id=${conta.id}`)}
                            style={contaRow}
                          >
                            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#3D2314' }}>
                              {conta.descricao ?? '(sem descrição)'}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', minWidth: 90, textAlign: 'right' }}>
                              venc {fmtDate(conta.vencimento)}
                            </div>
                            <div style={{ fontSize: 11, color: '#A32D2D', minWidth: 60, textAlign: 'right', fontWeight: 600 }}>
                              {conta.dias_atraso}d atraso
                            </div>
                            <div style={{ fontSize: 13, color: '#A32D2D', fontWeight: 600, minWidth: 100, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              R$ {fmt(conta.valor)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ label, valor, cor, destaque }: { label: string; valor: string; cor: string; destaque?: boolean }) {
  return (
    <div style={{
      background: destaque ? '#FCEBEB' : '#FFFFFF',
      border: '0.5px solid rgba(61,35,20,0.12)',
      borderLeft: `3px solid ${cor}`,
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
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
  alignSelf: 'center',
}

const filterLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: 'rgba(61,35,20,0.55)',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  marginBottom: 6,
}

function clienteHeader(open: boolean): React.CSSProperties {
  return {
    width: '100%',
    background: open ? 'rgba(61,35,20,0.03)' : 'transparent',
    border: 'none',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    font: 'inherit',
  }
}

const contaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  border: '0.5px solid rgba(61,35,20,0.08)',
  borderRadius: 6,
  background: 'rgba(61,35,20,0.02)',
  cursor: 'pointer',
  font: 'inherit',
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

const secondaryBtnAtivo: React.CSSProperties = {
  background: 'transparent',
  color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '8px 14px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
}

const whatsappBtn: React.CSSProperties = {
  background: '#25D366',
  color: '#FFFFFF',
  border: 'none',
  padding: '8px 14px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
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

const infoBox: React.CSSProperties = {
  padding: 40,
  background: '#FAF7F2',
  minHeight: '100vh',
  color: '#3D2314',
  textAlign: 'center',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.12)',
  borderRadius: 8,
  padding: 48,
  textAlign: 'center',
}
