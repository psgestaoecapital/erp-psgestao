'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

// PR-FIX-INADIMPLENTES-3-TABS (CEO 27/05/2026)
// Substitui fn_ge_inadimplentes_agrupado por fn_inadimplentes_por_status
// (retorna atrasadas + em_andamento + resolvidas).

interface ContaAtrasada {
  id: string
  descricao: string | null
  vencimento: string
  valor: number
  dias_atraso: number
}

interface ClienteAtrasado {
  cliente_id: string | null
  cliente_nome: string | null
  cliente_cpf_cnpj: string | null
  cliente_telefone: string | null
  cliente_celular: string | null
  cliente_whatsapp: string | null
  cliente_email: string | null
  qtd_contas: number
  total_valor: number
  contas: ContaAtrasada[]
}

interface TabSimples {
  count: number
  total_valor: number
}

interface TabAtrasadas extends TabSimples {
  agrupado_cliente: ClienteAtrasado[]
}

interface Resposta {
  company_id?: string
  atrasadas?: TabAtrasadas
  em_andamento?: TabSimples
  resolvidas?: TabSimples
}

type Tab = 'atrasadas' | 'em_andamento' | 'resolvidas'

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function hoje(): string {
  return new Date().toISOString().split('T')[0]
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

function corPorAtraso(dias: number): string {
  if (dias > 60) return '#DC2626'
  if (dias > 30) return '#EA580C'
  return '#C8941A'
}

function whatsappHref(cliente: ClienteAtrasado, empresaNome: string): string | null {
  const tel = onlyDigits(cliente.cliente_whatsapp ?? cliente.cliente_celular ?? '')
  if (!tel) return null
  const fone = tel.length <= 11 ? `55${tel}` : tel
  const nome = (cliente.cliente_nome ?? '').split(' ')[0] || 'tudo bem'
  const valor = Number(cliente.total_valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const empresa = empresaNome || 'da empresa'
  const msg = `Olá ${nome}, tudo bem? Aqui é da ${empresa}. Notei que há ${cliente.qtd_contas} ${cliente.qtd_contas === 1 ? 'conta em aberto' : 'contas em aberto'} totalizando R$ ${valor}. Posso te ajudar a regularizar?`
  return `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`
}

function exportarCSVInadimplentes(clientes: ClienteAtrasado[]): void {
  const head = ['Cliente', 'CNPJ/CPF', 'Conta', 'Vencimento', 'Valor', 'Dias atraso', 'Telefone', 'Email']
  const linhas: string[][] = []
  for (const c of clientes) {
    const tel = c.cliente_telefone || c.cliente_celular || c.cliente_whatsapp || ''
    for (const conta of c.contas) {
      linhas.push([
        (c.cliente_nome ?? '').replace(/"/g, '""'),
        c.cliente_cpf_cnpj ?? '',
        (conta.descricao ?? '').replace(/"/g, '""'),
        conta.vencimento,
        Number(conta.valor).toFixed(2).replace('.', ','),
        String(conta.dias_atraso),
        tel,
        c.cliente_email ?? '',
      ])
    }
  }
  const csv = [head, ...linhas].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inadimplentes_${hoje()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function mailtoHref(cliente: ClienteAtrasado): string | null {
  if (!cliente.cliente_email) return null
  const nome = cliente.cliente_nome ?? 'cliente'
  const valor = Number(cliente.total_valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const subject = 'Cobrança · contas em aberto'
  const body = `Prezado(a) ${nome},\n\nIdentificamos ${cliente.qtd_contas} ${cliente.qtd_contas === 1 ? 'conta' : 'contas'} em aberto totalizando R$ ${valor}.\n\nSolicitamos a gentileza de regularizar ou entrar em contato para renegociação.\n\nAtenciosamente.`
  return `mailto:${cliente.cliente_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function InadimplentesPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('atrasadas')
  const [expandido, setExpandido] = useState<Set<string>>(new Set())
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [contaPadrao, setContaPadrao] = useState<string>('')
  const [renegociandoIds, setRenegociandoIds] = useState<string[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [acaoLoading, setAcaoLoading] = useState(false)
  const [ordem, setOrdem] = useState<'valor' | 'atraso'>('valor')
  const [empresaNome, setEmpresaNome] = useState<string>('')

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) { setLoading(false); return }
    ;(async () => {
      setLoading(true)
      const [{ data: result }, { data: contas }] = await Promise.all([
        supabase.rpc('fn_inadimplentes_por_status', { p_company_id: empresaUnica }),
        supabase.from('erp_banco_contas').select('id, nome').eq('company_id', empresaUnica).eq('ativo', true).order('nome'),
      ])
      if (ignore) return
      setData(result as Resposta)
      if (contas && contas.length > 0) setContaPadrao(contas[0].id as string)
      setLoading(false)
    })()
    return () => { ignore = true }
  }, [empresaUnica, reloadKey])

  useEffect(() => {
    let ignore = false
    if (!empresaUnica) return
    ;(async () => {
      const { data } = await supabase
        .from('companies').select('nome_fantasia, razao_social')
        .eq('id', empresaUnica).maybeSingle()
      if (!ignore && data) setEmpresaNome((data.nome_fantasia as string) || (data.razao_social as string) || '')
    })()
    return () => { ignore = true }
  }, [empresaUnica])

  const clientesAtrasadosRaw = data?.atrasadas?.agrupado_cliente ?? []
  const clientesAtrasados = useMemo(() => {
    const arr = [...clientesAtrasadosRaw]
    if (ordem === 'valor') {
      arr.sort((a, b) => Number(b.total_valor) - Number(a.total_valor))
    } else {
      arr.sort((a, b) => {
        const maxA = Math.max(...a.contas.map((c) => c.dias_atraso))
        const maxB = Math.max(...b.contas.map((c) => c.dias_atraso))
        return maxB - maxA
      })
    }
    return arr
  }, [clientesAtrasadosRaw, ordem])
  const countAtrasadas = data?.atrasadas?.count ?? 0
  const countAndamento = data?.em_andamento?.count ?? 0
  const countResolvidas = data?.resolvidas?.count ?? 0

  const todosIdsAtrasados = useMemo<string[]>(() => {
    return clientesAtrasados.flatMap((c) => c.contas.map((co) => co.id))
  }, [clientesAtrasados])

  function toggleSelect(id: string) {
    const ns = new Set(selecionados)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setSelecionados(ns)
  }

  function toggleCliente(key: string) {
    const ns = new Set(expandido)
    if (ns.has(key)) ns.delete(key); else ns.add(key)
    setExpandido(ns)
  }

  async function marcarPagoIds(ids: string[]) {
    if (ids.length === 0 || !contaPadrao) {
      alert(!contaPadrao ? 'Nenhuma conta bancária ativa cadastrada' : 'Selecione ao menos 1 conta')
      return
    }
    setAcaoLoading(true)
    const { error } = await supabase.rpc('fn_baixar_pagamento_em_massa', {
      p_tipo: 'receber',
      p_ids: ids,
      p_data_pagamento: hoje(),
      p_conta_bancaria_id: contaPadrao,
      p_forma_pagamento: 'PIX',
    })
    setAcaoLoading(false)
    if (error) { alert(`Erro: ${error.message}`); return }
    setSelecionados(new Set())
    setReloadKey((k) => k + 1)
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver inadimplentes.</div>
  }
  if (loading) return <div style={infoBox}>Carregando…</div>

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/gestao-empresarial')} style={backLink}>
          ← Painel Gestão Empresarial
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              Inadimplentes
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              Atrasadas · Em renegociação · Resolvidas
            </p>
          </div>
          {tab === 'atrasadas' && selecionados.size > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => marcarPagoIds(Array.from(selecionados))} disabled={acaoLoading} style={primaryBtn(acaoLoading)}>
                Marcar {selecionados.size} pagas
              </button>
              <button onClick={() => setRenegociandoIds(Array.from(selecionados))} disabled={acaoLoading} style={secondaryBtnAtivo}>
                Renegociar {selecionados.size}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          <TabBtn ativa={tab === 'atrasadas'} onClick={() => { setTab('atrasadas'); setSelecionados(new Set()) }}>
            🚨 Atrasadas ({countAtrasadas})
          </TabBtn>
          <TabBtn ativa={tab === 'em_andamento'} onClick={() => { setTab('em_andamento'); setSelecionados(new Set()) }}>
            🔄 Em Andamento ({countAndamento})
          </TabBtn>
          <TabBtn ativa={tab === 'resolvidas'} onClick={() => { setTab('resolvidas'); setSelecionados(new Set()) }}>
            ✅ Resolvidas ({countResolvidas})
          </TabBtn>
        </div>

        {tab === 'atrasadas' && (
          <ConteudoAtrasadas
            clientes={clientesAtrasados}
            totalValor={data?.atrasadas?.total_valor ?? 0}
            selecionados={selecionados}
            todosIds={todosIdsAtrasados}
            onToggleSelect={toggleSelect}
            onSelectAll={(ids) => setSelecionados(new Set(ids))}
            onClearAll={() => setSelecionados(new Set())}
            expandido={expandido}
            onToggleCliente={toggleCliente}
            onMarcarPago={(id) => marcarPagoIds([id])}
            onRenegociar={(id) => setRenegociandoIds([id])}
            acaoLoading={acaoLoading}
            ordem={ordem}
            onOrdemChange={setOrdem}
            onExportCSV={() => exportarCSVInadimplentes(clientesAtrasados)}
            empresaNome={empresaNome}
          />
        )}

        {tab === 'em_andamento' && (
          <ConteudoEmAndamento companyId={empresaUnica} count={countAndamento} totalValor={data?.em_andamento?.total_valor ?? 0} />
        )}

        {tab === 'resolvidas' && (
          <ConteudoResolvidas companyId={empresaUnica} count={countResolvidas} totalValor={data?.resolvidas?.total_valor ?? 0} />
        )}
      </div>

      <RenegociarModal
        open={!!renegociandoIds}
        ids={renegociandoIds ?? []}
        onClose={() => setRenegociandoIds(null)}
        onSucesso={() => { setRenegociandoIds(null); setSelecionados(new Set()); setReloadKey((k) => k + 1) }}
      />
    </div>
  )
}

function ConteudoAtrasadas({
  clientes, totalValor, selecionados, todosIds, onToggleSelect,
  onSelectAll, onClearAll, expandido, onToggleCliente,
  onMarcarPago, onRenegociar, acaoLoading,
  ordem, onOrdemChange, onExportCSV, empresaNome,
}: {
  clientes: ClienteAtrasado[]
  totalValor: number
  selecionados: Set<string>
  todosIds: string[]
  onToggleSelect: (id: string) => void
  onSelectAll: (ids: string[]) => void
  onClearAll: () => void
  ordem: 'valor' | 'atraso'
  onOrdemChange: (o: 'valor' | 'atraso') => void
  onExportCSV: () => void
  empresaNome: string
  expandido: Set<string>
  onToggleCliente: (k: string) => void
  onMarcarPago: (id: string) => void
  onRenegociar: (id: string) => void
  acaoLoading: boolean
}) {
  if (clientes.length === 0) {
    return (
      <div style={emptyBox}>
        <div style={{ fontSize: 14, color: '#3B6D11', fontWeight: 600 }}>Sem inadimplentes ✅</div>
        <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', marginTop: 6 }}>
          Todas as contas a receber em dia.
        </div>
      </div>
    )
  }

  const allSelected = selecionados.size > 0 && selecionados.size === todosIds.length

  return (
    <>
      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderLeft: '3px solid #A32D2D', borderRadius: 8, padding: '12px 16px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>Total atrasado</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#A32D2D', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(totalValor)}</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3D2314', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => allSelected ? onClearAll() : onSelectAll(todosIds)}
          />
          Selecionar todas ({todosIds.length})
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>Ordenar:</span>
          <button type="button" onClick={() => onOrdemChange('valor')} style={ordemBtnStyle(ordem === 'valor')}>Maior valor</button>
          <button type="button" onClick={() => onOrdemChange('atraso')} style={ordemBtnStyle(ordem === 'atraso')}>Maior atraso</button>
        </div>
        <button type="button" onClick={onExportCSV} style={contatoBtnStyle('#3D2314')} title="Exportar CSV pra contador">
          Exportar CSV
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {clientes.map((c) => {
          const key = c.cliente_id ?? c.cliente_nome ?? Math.random().toString()
          const open = expandido.has(key)
          const waHref = whatsappHref(c, empresaNome)
          const mHref = mailtoHref(c)
          return (
            <div key={key} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={clienteHeaderStyle(open)} role="button" tabIndex={0} onClick={() => onToggleCliente(key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCliente(key) } }}>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.cliente_nome ?? '(sem nome)'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                    {c.qtd_contas} {c.qtd_contas === 1 ? 'conta' : 'contas'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginRight: 12, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  {waHref && (
                    <a href={waHref} target="_blank" rel="noopener noreferrer" title="Cobrar via WhatsApp" aria-label="Cobrar via WhatsApp" style={contatoBtnStyle('#25D366')}>
                      WhatsApp
                    </a>
                  )}
                  {mHref && (
                    <a href={mHref} title="Enviar email" aria-label="Enviar email" style={contatoBtnStyle('#3D2314')}>
                      Email
                    </a>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#A32D2D', fontVariantNumeric: 'tabular-nums' }}>
                    R$ {fmt(c.total_valor)}
                  </div>
                </div>
                <div style={{ fontSize: 16, color: 'rgba(61,35,20,0.4)', marginLeft: 12 }}>{open ? '−' : '+'}</div>
              </div>

              {open && (
                <div style={{ borderTop: '0.5px solid rgba(61,35,20,0.08)', padding: '4px 8px 8px' }}>
                  {c.contas.map((conta) => {
                    const checked = selecionados.has(conta.id)
                    const corAtraso = corPorAtraso(conta.dias_atraso)
                    return (
                      <div key={conta.id} style={{ padding: '8px 8px 8px 10px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '0.5px solid rgba(61,35,20,0.05)', borderLeft: `4px solid ${corAtraso}` }}>
                        <input type="checkbox" checked={checked} onChange={() => onToggleSelect(conta.id)} />
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>{conta.descricao ?? '(sem descrição)'}</div>
                          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)', marginTop: 2 }}>
                            venc {fmtDate(conta.vencimento)} · {conta.dias_atraso} dias atraso
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#A32D2D', minWidth: 100, textAlign: 'right' }}>
                          R$ {fmt(conta.valor)}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => onMarcarPago(conta.id)} disabled={acaoLoading} style={smallBtn('#C8941A', acaoLoading)}>
                            Marcar pago
                          </button>
                          <button onClick={() => onRenegociar(conta.id)} disabled={acaoLoading} style={smallBtn('transparent', acaoLoading, '#3D2314')}>
                            Renegociar
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

interface ContaSimples {
  id: string
  descricao: string | null
  cliente_nome: string | null
  data_vencimento: string
  data_pagamento?: string | null
  valor: number
  valor_pago?: number | null
}

function ConteudoEmAndamento({ companyId, count, totalValor }: { companyId: string; count: number; totalValor: number }) {
  const [linhas, setLinhas] = useState<ContaSimples[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data } = await supabase
        .from('erp_receber')
        .select('id, descricao, cliente_nome, data_vencimento, valor')
        .eq('company_id', companyId)
        .eq('em_renegociacao', true)
        .not('status', 'in', '("pago","recebido","cancelado")')
        .order('data_vencimento')
      if (!ignore) { setLinhas((data ?? []) as ContaSimples[]); setLoading(false) }
    })()
    return () => { ignore = true }
  }, [companyId])
  if (loading) return <div style={emptyBox}>Carregando…</div>
  if (linhas.length === 0) return <div style={emptyBox}>Nenhuma renegociação em andamento.</div>

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto', marginTop: 12 }}>
      <div style={{ padding: '12px 16px', background: '#FAEEDA', borderBottom: '0.5px solid rgba(186,117,23,0.3)', fontSize: 12, color: '#854F0B' }}>
        {count} contas · R$ {fmt(totalValor)} total
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'rgba(61,35,20,0.04)' }}>
            <th style={th}>Cliente</th>
            <th style={th}>Descrição</th>
            <th style={th}>Vencimento</th>
            <th style={{ ...th, textAlign: 'right' }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} style={{ borderTop: '0.5px solid rgba(61,35,20,0.06)' }}>
              <td style={td}>{l.cliente_nome ?? '—'}</td>
              <td style={td}>{l.descricao ?? '—'}</td>
              <td style={td}>{fmtDate(l.data_vencimento)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>R$ {fmt(l.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConteudoResolvidas({ companyId, count, totalValor }: { companyId: string; count: number; totalValor: number }) {
  const [linhas, setLinhas] = useState<ContaSimples[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data } = await supabase
        .from('erp_receber')
        .select('id, descricao, cliente_nome, data_vencimento, data_pagamento, valor_pago, valor')
        .eq('company_id', companyId)
        .in('status', ['pago', 'recebido'])
        .gt('data_pagamento', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('data_pagamento', { ascending: false })
        .limit(200)
      if (ignore) return
      const filtradas = ((data ?? []) as ContaSimples[]).filter((l) => l.data_pagamento && l.data_vencimento && l.data_pagamento > l.data_vencimento)
      setLinhas(filtradas)
      setLoading(false)
    })()
    return () => { ignore = true }
  }, [companyId])
  if (loading) return <div style={emptyBox}>Carregando…</div>
  if (linhas.length === 0) return <div style={emptyBox}>Nenhuma cobrança resolvida nos últimos 90 dias.</div>

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto', marginTop: 12 }}>
      <div style={{ padding: '12px 16px', background: '#EAF3DE', borderBottom: '0.5px solid rgba(59,109,17,0.25)', fontSize: 12, color: '#3B6D11' }}>
        {count} contas · R$ {fmt(totalValor)} recebido total
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'rgba(61,35,20,0.04)' }}>
            <th style={th}>Cliente</th>
            <th style={th}>Descrição</th>
            <th style={th}>Data pago</th>
            <th style={{ ...th, textAlign: 'right' }}>Valor recebido</th>
            <th style={th}>Dias atraso</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const diasAtraso = l.data_pagamento && l.data_vencimento
              ? Math.round((new Date(l.data_pagamento).getTime() - new Date(l.data_vencimento).getTime()) / 86400000)
              : 0
            return (
              <tr key={l.id} style={{ borderTop: '0.5px solid rgba(61,35,20,0.06)' }}>
                <td style={td}>{l.cliente_nome ?? '—'}</td>
                <td style={td}>{l.descricao ?? '—'}</td>
                <td style={td}>{fmtDate(l.data_pagamento ?? '')}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#3B6D11' }}>R$ {fmt(l.valor_pago ?? l.valor)}</td>
                <td style={td}>{diasAtraso} dias</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RenegociarModal({ open, ids, onClose, onSucesso }: { open: boolean; ids: string[]; onClose: () => void; onSucesso: () => void }) {
  const [novaData, setNovaData] = useState('')
  const [novoValor, setNovoValor] = useState('')
  const [obs, setObs] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const d = new Date()
      d.setDate(d.getDate() + 30)
      setNovaData(d.toISOString().split('T')[0])
      setNovoValor('')
      setObs('Renegociado')
      setErro(null)
    }
  }, [open])

  async function confirmar() {
    if (!novaData) { setErro('Defina a nova data de vencimento'); return }
    setLoading(true)
    const { error } = await supabase.rpc('fn_renegociar_inadimplencia', {
      p_receber_ids: ids,
      p_nova_data_vencimento: novaData,
      p_novo_valor_total: novoValor ? Number(novoValor) : null,
      p_observacao: obs || 'Renegociado',
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    onSucesso()
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: 12, padding: '24px', maxWidth: 460, width: '100%' }}>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
          Renegociar {ids.length} {ids.length === 1 ? 'conta' : 'contas'}
        </h2>
        <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginBottom: 16 }}>
          Marca como em renegociação · novo vencimento + observação no histórico.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={fieldLabel}>Nova data vencimento</span>
            <input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} style={input} />
          </label>
          <label>
            <span style={fieldLabel}>Novo valor total (opcional)</span>
            <input type="number" step="0.01" min="0" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} placeholder="Deixe vazio pra manter" style={input} />
          </label>
          <label>
            <span style={fieldLabel}>Observação</span>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} style={input} />
          </label>
          {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>{erro}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtnAtivo}>Cancelar</button>
          <button onClick={confirmar} disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Renegociando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabBtn({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ativa ? '#3D2314' : '#FFFFFF',
        color: ativa ? '#FAF7F2' : '#3D2314',
        border: '0.5px solid rgba(61,35,20,0.2)',
        padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

function clienteHeaderStyle(open: boolean): React.CSSProperties {
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

function smallBtn(bg: string, disabled: boolean, color?: string): React.CSSProperties {
  return {
    background: bg, color: color ?? '#3D2314',
    border: bg === 'transparent' ? '0.5px solid rgba(61,35,20,0.2)' : 'none',
    padding: '4px 10px', borderRadius: 4,
    fontSize: 11, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  }
}

function ordemBtnStyle(ativo: boolean): React.CSSProperties {
  return {
    background: ativo ? '#3D2314' : 'transparent',
    color: ativo ? '#FAF7F2' : '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.25)',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

function contatoBtnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: '#FFFFFF',
    border: 'none',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  }
}

function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}

const secondaryBtnAtivo: React.CSSProperties = {
  background: 'transparent', color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const input: React.CSSProperties = {
  width: '100%', background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6,
  padding: '8px 10px', fontSize: 13, color: '#3D2314',
  fontFamily: 'inherit', boxSizing: 'border-box',
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 10,
  color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase',
  letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 14px', fontSize: 11,
  color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase',
  letterSpacing: 0.8, fontWeight: 600, whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '10px 14px', color: '#3D2314', whiteSpace: 'nowrap',
}

const backLink: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)',
  fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16,
}

const infoBox: React.CSSProperties = {
  padding: 40, background: '#FAF7F2', minHeight: '100vh', color: '#3D2314', textAlign: 'center',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8,
  padding: 48, textAlign: 'center', color: 'rgba(61,35,20,0.65)',
}
