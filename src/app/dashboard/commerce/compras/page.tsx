'use client'

// /dashboard/commerce/compras — Cotação multi-fornecedor + Pedido de compra
// PR M.B.1.4 — Commerce 4/12
//
// Multi-tenant: RD-34 via useCompanyIds.
// Backend pre-existente (90%):
//   - erp_cotacoes (15 cols) + erp_cotacoes_itens (13) + erp_cotacoes_fornecedores (21) + erp_cotacoes_propostas (11)
//   - erp_compras (36) + erp_compras_itens (17)
//   - erp_fornecedores (2.897 cadastros)
//   - RPC fn_aprovar_proposta_cotacao(cotacao_id, fornecedor_vencedor_id, ...) → uuid
//   - RPC fn_resumo_cotacao(cotacao_id) → table

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ProdutoAutocomplete, { type ProdutoSelecionado } from '@/components/comum/ProdutoAutocomplete'
import {
  Plus, Search, FileText, ShoppingCart, BarChart3, X, Info, Trash2,
  CheckCircle2, Send, Award, Truck,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  white: '#FFFFFF',
  cream: '#F0ECE3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  green: '#10B981',
  greenBg: '#ECFDF5',
  amber: '#C88A1A',
  amberBg: '#FFF8E1',
  red: '#EF4444',
  redBg: '#FEE2E2',
  blue: '#3B82F6',
  blueBg: '#DBEAFE',
  purple: '#A855F7',
  purpleBg: '#F3E8FF',
  gray: '#94A3B8',
}

type Tab = 'cotacoes' | 'compras'

type Cotacao = {
  id: string
  company_id: string
  numero: string | null
  descricao: string | null
  observacoes: string | null
  data_abertura: string | null
  data_limite: string | null
  data_fechamento: string | null
  status: string
  fornecedor_vencedor_id: string | null
  compra_gerada_id: string | null
  solicitante: string | null
  created_at: string | null
}

type CotacaoItem = {
  id: string
  cotacao_id: string
  ordem: number | null
  produto_id: string | null
  produto_codigo: string | null
  produto_nome: string
  unidade: string | null
  quantidade: number | null
  observacoes: string | null
}

type CotacaoFornecedor = {
  id: string
  cotacao_id: string
  fornecedor_id: string
  fornecedor_nome: string | null
  fornecedor_cnpj: string | null
  status: string
  data_resposta: string | null
  prazo_entrega_dias: number | null
  condicao_pagamento: string | null
  frete_valor: number | null
  subtotal: number | null
  desconto_valor: number | null
  total: number | null
  motivo_recusa: string | null
}

type CotacaoProposta = {
  id: string
  cotacao_fornecedor_id: string
  cotacao_item_id: string
  preco_unitario: number | null
  desconto_percentual: number | null
  subtotal: number | null
  disponivel: boolean | null
}

type Compra = {
  id: string
  company_id: string
  numero: string | null
  cotacao_origem_id: string | null
  fornecedor_id: string | null
  fornecedor_nome: string | null
  fornecedor_cnpj: string | null
  data_pedido: string | null
  data_prevista: string | null
  data_recebimento: string | null
  status: string
  total: number | null
  nf_numero: string | null
  estoque_baixado: boolean | null
  titulos_gerados: boolean | null
}

type Fornecedor = {
  id: string
  nome_fantasia: string | null
  razao_social: string | null
  cnpj_cpf: string | null
  cpf_cnpj: string | null
  email: string | null
  telefone: string | null
}

const STATUS_COT: Record<string, { label: string; bg: string; fg: string }> = {
  rascunho:     { label: 'Rascunho',    bg: C.cream,    fg: C.espresso },
  enviada:      { label: 'Enviada',     bg: C.goldBg,   fg: C.goldD },
  em_resposta:  { label: 'Em resposta', bg: C.blueBg,   fg: C.blue },
  fechada:      { label: 'Fechada',     bg: C.purpleBg, fg: C.purple },
  aprovada:     { label: 'Aprovada',    bg: C.greenBg,  fg: C.green },
  cancelada:    { label: 'Cancelada',   bg: C.redBg,    fg: C.red },
}

const STATUS_COMP: Record<string, { label: string; bg: string; fg: string }> = {
  aberta:               { label: 'Aberta',              bg: C.cream,    fg: C.espresso },
  aguardando_entrega:   { label: 'Aguardando entrega',  bg: C.goldBg,   fg: C.goldD },
  recebida_parcial:     { label: 'Recebida parcial',    bg: C.blueBg,   fg: C.blue },
  recebida_total:       { label: 'Recebida total',      bg: C.greenBg,  fg: C.green },
  finalizada:           { label: 'Finalizada',          bg: C.purpleBg, fg: C.purple },
  cancelada:            { label: 'Cancelada',           bg: C.redBg,    fg: C.red },
}

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—'

export default function ComprasPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: C.espressoM }}>Carregando…</div>}>
      <ComprasInner />
    </Suspense>
  )
}

function ComprasInner() {
  const { companyIds, selInfo, loading: companiesLoading, sel } = useCompanyIds()
  const companyIdUnico = selInfo.tipo === 'empresa' && sel ? sel : null
  const canCreate = !!companyIdUnico

  const [tab, setTab] = useState<Tab>('cotacoes')
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([])
  const [compras, setCompras] = useState<Compra[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')

  const [cotSel, setCotSel] = useState<Cotacao | null>(null)
  const [compSel, setCompSel] = useState<Compra | null>(null)
  const [showNova, setShowNova] = useState(false)
  const [showNovaCompra, setShowNovaCompra] = useState(false)
  const [showCompare, setShowCompare] = useState<Cotacao | null>(null)

  const companyIdsKey = useMemo(() => [...companyIds].sort().join(','), [companyIds])

  const carregar = useCallback(async () => {
    if (companyIds.length === 0) {
      setCotacoes([]); setCompras([])
      return
    }
    setLoading(true)
    setErro('')
    const [cot, comp] = await Promise.all([
      supabase.from('erp_cotacoes').select('*').in('company_id', companyIds).order('created_at', { ascending: false }).limit(200),
      supabase.from('erp_compras').select('*').in('company_id', companyIds).order('created_at', { ascending: false }).limit(200),
    ])
    if (cot.error) setErro('Cotações: ' + cot.error.message)
    else setCotacoes((cot.data ?? []) as Cotacao[])
    if (comp.error) setErro('Compras: ' + comp.error.message)
    else setCompras((comp.data ?? []) as Compra[])
    setLoading(false)
  }, [companyIds])

  useEffect(() => {
    if (companiesLoading) return
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey, companiesLoading])

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(''), 3500) }
  const flashErr = (m: string) => { setErro(m); window.setTimeout(() => setErro(''), 5000) }

  async function enviarCotacao(id: string) {
    const { error } = await supabase.from('erp_cotacoes').update({ status: 'enviada', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { flashErr('Erro: ' + error.message); return }
    setCotacoes((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'enviada' } : c)))
    if (cotSel?.id === id) setCotSel({ ...cotSel, status: 'enviada' })
    flash('Cotação marcada como enviada.')
  }

  async function cancelarCotacao(id: string) {
    if (!confirm('Cancelar esta cotação?')) return
    const { error } = await supabase.from('erp_cotacoes').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { flashErr('Erro: ' + error.message); return }
    setCotacoes((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'cancelada' } : c)))
    if (cotSel?.id === id) setCotSel(null)
    flash('Cotação cancelada.')
  }

  async function aprovarFornecedor(cotacaoId: string, fornecedorId: string) {
    const { error } = await supabase.rpc('fn_aprovar_proposta_cotacao', {
      p_cotacao_id: cotacaoId,
      p_fornecedor_vencedor_id: fornecedorId,
    })
    if (error) { flashErr('Erro: ' + error.message); return }
    flash('Cotação aprovada e pedido de compra gerado!')
    setShowCompare(null)
    setCotSel(null)
    await carregar()
    setTab('compras')
  }

  async function avancarCompra(compraId: string, novoStatus: string) {
    const patch: { status: string; data_recebimento?: string; updated_at: string } = {
      status: novoStatus,
      updated_at: new Date().toISOString(),
    }
    if (novoStatus === 'recebida_total') patch.data_recebimento = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('erp_compras').update(patch).eq('id', compraId)
    if (error) { flashErr('Erro: ' + error.message); return }
    setCompras((prev) => prev.map((c) => (c.id === compraId ? { ...c, ...patch } : c)))
    if (compSel?.id === compraId) setCompSel({ ...compSel, ...patch })
    flash('Status atualizado.')
  }

  async function receberCompra(compraId: string) {
    if (!confirm('Receber esta compra? O estoque vai ser atualizado e o custo médio recalculado.')) return
    const { data, error } = await supabase.rpc('fn_compra_receber', { p_compra_id: compraId })
    if (error) { flashErr('Erro: ' + error.message); return }
    const resp = data as { ok?: boolean; qtd_itens?: number } | null
    flash(`Mercadoria recebida · estoque atualizado em ${resp?.qtd_itens ?? 0} itens.`)
    await carregar()
    if (compSel?.id === compraId) {
      const fresh = (await supabase.from('erp_compras').select('*').eq('id', compraId).single()).data as Compra | null
      if (fresh) setCompSel(fresh)
    }
  }

  async function gerarTitulosCompra(compraId: string) {
    if (!confirm('Gerar os títulos a pagar a partir desta compra?')) return
    const { data, error } = await supabase.rpc('fn_compra_gerar_titulos', { p_compra_id: compraId })
    if (error) { flashErr('Erro: ' + error.message); return }
    const resp = data as { ok?: boolean; qtd_parcelas?: number } | null
    flash(`Títulos gerados · ${resp?.qtd_parcelas ?? 0} parcela(s) em contas a pagar.`)
    await carregar()
    if (compSel?.id === compraId) {
      const fresh = (await supabase.from('erp_compras').select('*').eq('id', compraId).single()).data as Compra | null
      if (fresh) setCompSel(fresh)
    }
  }

  const cotFiltradas = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase()
    return cotacoes.filter((c) => {
      if (filtroStatus && c.status !== filtroStatus) return false
      if (!q) return true
      return (
        (c.numero ?? '').toLowerCase().includes(q) ||
        (c.descricao ?? '').toLowerCase().includes(q) ||
        (c.solicitante ?? '').toLowerCase().includes(q)
      )
    })
  }, [cotacoes, filtroBusca, filtroStatus])

  const compFiltradas = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase()
    return compras.filter((c) => {
      if (filtroStatus && c.status !== filtroStatus) return false
      if (!q) return true
      return (
        (c.numero ?? '').toLowerCase().includes(q) ||
        (c.fornecedor_nome ?? '').toLowerCase().includes(q) ||
        (c.nf_numero ?? '').toLowerCase().includes(q)
      )
    })
  }, [compras, filtroBusca, filtroStatus])

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 24px)', maxWidth: 1280, margin: '0 auto', color: C.espresso }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShoppingCart size={26} style={{ color: C.gold }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Compras & Cotações</h1>
            <p style={{ margin: 0, fontSize: 12, color: C.espressoM }}>Cotação multi-fornecedor → comparativo → pedido de compra</p>
          </div>
        </div>
        {tab === 'cotacoes' && (
          <button onClick={() => setShowNova(true)} disabled={!canCreate} title={canCreate ? '' : 'Selecione uma empresa específica'}
            style={btnPrincipal(canCreate)}>
            <Plus size={14} /> Nova Cotação
          </button>
        )}
        {tab === 'compras' && (
          <button onClick={() => setShowNovaCompra(true)} disabled={!canCreate} title={canCreate ? '' : 'Selecione uma empresa específica'}
            style={btnPrincipal(canCreate)} data-testid="commerce-nova-compra">
            <Plus size={14} /> Nova compra
          </button>
        )}
      </header>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        <TabBtn ativo={tab === 'cotacoes'} onClick={() => setTab('cotacoes')} icon={<FileText size={14} />} label="Cotações" count={cotacoes.length} />
        <TabBtn ativo={tab === 'compras'} onClick={() => setTab('compras')} icon={<ShoppingCart size={14} />} label="Pedidos de Compra" count={compras.length} />
      </div>

      {selInfo.tipo !== 'empresa' && companyIds.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.goldBg, border: `1px solid ${C.gold}55`, borderRadius: 8, color: C.goldD, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={14} />
          <span>Exibindo dados de <strong>{selInfo.nome}</strong>. Para criar nova cotação, selecione uma empresa específica.</span>
        </div>
      )}

      {msg && <div onClick={() => setMsg('')} style={{ marginBottom: 12, padding: '10px 14px', background: C.greenBg, border: `1px solid ${C.green}55`, borderRadius: 8, color: C.green, fontSize: 12, cursor: 'pointer' }}>{msg}</div>}
      {erro && <div onClick={() => setErro('')} style={{ marginBottom: 12, padding: '10px 14px', background: C.redBg, border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 12, cursor: 'pointer' }}>{erro}</div>}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }} />
          <input type="text" placeholder={tab === 'cotacoes' ? 'Buscar por número, descrição, solicitante…' : 'Buscar por número, fornecedor, NF…'}
            value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)}
            style={{ width: '100%', padding: '8px 10px 8px 32px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.white, color: C.espresso, outline: 'none' }} />
        </div>
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} style={selInpStyle}>
          <option value="">Todos os status</option>
          {Object.keys(tab === 'cotacoes' ? STATUS_COT : STATUS_COMP).map((s) => (
            <option key={s} value={s}>{(tab === 'cotacoes' ? STATUS_COT : STATUS_COMP)[s].label}</option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.espressoM }}>
          {tab === 'cotacoes' ? cotFiltradas.length : compFiltradas.length} de {tab === 'cotacoes' ? cotacoes.length : compras.length}
        </span>
      </div>

      {companiesLoading || loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Carregando…</div>
      ) : companyIds.length === 0 ? (
        <EmptyState titulo="Nenhuma empresa disponível" texto="Selecione uma empresa no menu superior ou peça ao administrador para te vincular." />
      ) : tab === 'cotacoes' ? (
        <TabelaCotacoes rows={cotFiltradas} total={cotacoes.length} onSelect={setCotSel} onCompare={setShowCompare} canCreate={canCreate} onCreate={() => setShowNova(true)} />
      ) : (
        <TabelaCompras rows={compFiltradas} total={compras.length} cotacoes={cotacoes} onSelect={setCompSel} />
      )}

      {cotSel && (
        <DrawerCotacao
          cotacao={cotSel}
          onClose={() => setCotSel(null)}
          onEnviar={() => enviarCotacao(cotSel.id)}
          onCancelar={() => cancelarCotacao(cotSel.id)}
          onCompare={() => setShowCompare(cotSel)}
        />
      )}

      {compSel && (
        <DrawerCompra
          compra={compSel}
          cotacaoOrigem={compSel.cotacao_origem_id ? cotacoes.find((c) => c.id === compSel.cotacao_origem_id) : null}
          onClose={() => setCompSel(null)}
          onAvancar={(novoStatus) => avancarCompra(compSel.id, novoStatus)}
          onReceber={() => receberCompra(compSel.id)}
          onGerarTitulos={() => gerarTitulosCompra(compSel.id)}
        />
      )}

      {showNovaCompra && companyIdUnico && (
        <ModalNovaCompra
          companyId={companyIdUnico}
          onClose={() => setShowNovaCompra(false)}
          onCreated={async (id) => {
            setShowNovaCompra(false)
            await carregar()
            const c = (await supabase.from('erp_compras').select('*').eq('id', id).single()).data as Compra | null
            if (c) { setTab('compras'); setCompSel(c) }
          }}
          flash={flash}
          flashErr={flashErr}
        />
      )}

      {showCompare && (
        <ModalComparativo
          cotacao={showCompare}
          onClose={() => setShowCompare(null)}
          onAprovar={(fornecedorId) => aprovarFornecedor(showCompare.id, fornecedorId)}
        />
      )}

      {showNova && companyIdUnico && (
        <ModalNovaCotacao
          companyId={companyIdUnico}
          onClose={() => setShowNova(false)}
          onCreated={async (id) => {
            setShowNova(false)
            await carregar()
            const c = (await supabase.from('erp_cotacoes').select('*').eq('id', id).single()).data as Cotacao | null
            if (c) setCotSel(c)
          }}
          flash={flash}
          flashErr={flashErr}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Tabelas
// ════════════════════════════════════════════════════════════

function TabelaCotacoes({ rows, total, onSelect, onCompare, canCreate, onCreate }: { rows: Cotacao[]; total: number; onSelect: (c: Cotacao) => void; onCompare: (c: Cotacao) => void; canCreate: boolean; onCreate: () => void }) {
  if (total === 0) return <EmptyState titulo="Nenhuma cotação ainda" texto="Crie uma cotação para solicitar propostas de múltiplos fornecedores e comparar os preços lado a lado." cta={canCreate ? { label: '+ Nova cotação', onClick: onCreate } : undefined} />
  if (rows.length === 0) return <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhuma cotação corresponde aos filtros.</div>
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
          <thead style={{ background: C.cream }}>
            <tr><Th>Número</Th><Th>Descrição</Th><Th>Solicitante</Th><Th>Abertura</Th><Th>Limite</Th><Th>Status</Th><Th align="right">Ações</Th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer', borderTop: `1px solid ${C.borderL}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Td onClick={() => onSelect(c)}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.numero ?? '—'}</span></Td>
                <Td onClick={() => onSelect(c)}>{c.descricao ?? '—'}</Td>
                <Td onClick={() => onSelect(c)}>{c.solicitante ?? '—'}</Td>
                <Td onClick={() => onSelect(c)}>{fmtDate(c.data_abertura)}</Td>
                <Td onClick={() => onSelect(c)}>{fmtDate(c.data_limite)}</Td>
                <Td onClick={() => onSelect(c)}><StatusBadge status={c.status} mapa={STATUS_COT} /></Td>
                <Td align="right">
                  <button onClick={(e) => { e.stopPropagation(); onCompare(c) }} style={btnMini}>
                    <BarChart3 size={12} /> Comparar
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaCompras({ rows, total, cotacoes, onSelect }: { rows: Compra[]; total: number; cotacoes: Cotacao[]; onSelect: (c: Compra) => void }) {
  const cotMap = useMemo(() => Object.fromEntries(cotacoes.map((c) => [c.id, c])), [cotacoes])
  if (total === 0) return <EmptyState titulo="Nenhum pedido de compra" texto="Pedidos de compra são gerados automaticamente ao aprovar uma proposta de cotação." />
  if (rows.length === 0) return <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhum pedido corresponde aos filtros.</div>
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 880 }}>
          <thead style={{ background: C.cream }}>
            <tr><Th>Número</Th><Th>Fornecedor</Th><Th>Pedido</Th><Th>Prev. entrega</Th><Th align="right">Total</Th><Th>Status</Th><Th>NF</Th></tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const cot = p.cotacao_origem_id ? cotMap[p.cotacao_origem_id] : null
              return (
                <tr key={p.id} onClick={() => onSelect(p)} style={{ cursor: 'pointer', borderTop: `1px solid ${C.borderL}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Td>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.numero ?? '—'}</div>
                    {cot && <div style={{ fontSize: 9, color: C.purple }}>📂 Cotação {cot.numero}</div>}
                  </Td>
                  <Td><strong>{p.fornecedor_nome ?? '—'}</strong></Td>
                  <Td>{fmtDate(p.data_pedido)}</Td>
                  <Td>{fmtDate(p.data_prevista)}</Td>
                  <Td align="right"><strong>{fmtBRL(p.total)}</strong></Td>
                  <Td><StatusBadge status={p.status} mapa={STATUS_COMP} /></Td>
                  <Td>{p.nf_numero ? <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{p.nf_numero}</span> : <span style={{ fontSize: 10, color: C.espressoL }}>—</span>}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Drawers
// ════════════════════════════════════════════════════════════

function DrawerCotacao({ cotacao, onClose, onEnviar, onCancelar, onCompare }: {
  cotacao: Cotacao; onClose: () => void; onEnviar: () => void; onCancelar: () => void; onCompare: () => void;
}) {
  const [itens, setItens] = useState<CotacaoItem[]>([])
  const [fornecedores, setFornecedores] = useState<CotacaoFornecedor[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [it, fo] = await Promise.all([
        supabase.from('erp_cotacoes_itens').select('*').eq('cotacao_id', cotacao.id).order('ordem', { nullsFirst: true }),
        supabase.from('erp_cotacoes_fornecedores').select('*').eq('cotacao_id', cotacao.id).order('fornecedor_nome'),
      ])
      if (!alive) return
      setItens((it.data ?? []) as CotacaoItem[])
      setFornecedores((fo.data ?? []) as CotacaoFornecedor[])
    })()
    return () => { alive = false }
  }, [cotacao.id])

  const canEnviar = cotacao.status === 'rascunho'
  const canCancelar = cotacao.status !== 'aprovada' && cotacao.status !== 'cancelada'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', height: '100%', background: C.offWhite, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, zIndex: 1 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Cotação</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{cotacao.numero ?? '—'}</h2>
              <StatusBadge status={cotacao.status} mapa={STATUS_COT} />
            </div>
            {cotacao.descricao && <p style={{ margin: '4px 0 0', fontSize: 12, color: C.espressoM }}>{cotacao.descricao}</p>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}><X size={16} /></button>
        </header>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card titulo="Identificação">
            <Row label="Solicitante" value={cotacao.solicitante ?? '—'} />
            <Row label="Abertura" value={fmtDate(cotacao.data_abertura)} />
            <Row label="Limite" value={fmtDate(cotacao.data_limite)} />
            {cotacao.data_fechamento && <Row label="Fechada em" value={fmtDate(cotacao.data_fechamento)} />}
          </Card>

          <Card titulo={`Itens · ${itens.length}`}>
            {itens.length === 0 ? <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Sem itens.</p> : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Produto</Th><Th align="right">Qtd</Th><Th>Unid.</Th></tr></thead>
                <tbody>
                  {itens.map((it) => (
                    <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                      <Td><strong>{it.produto_nome}</strong>{it.produto_codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace', marginLeft: 6 }}>{it.produto_codigo}</span>}</Td>
                      <Td align="right">{it.quantidade}</Td>
                      <Td>{it.unidade ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card titulo={`Fornecedores convidados · ${fornecedores.length}`}>
            {fornecedores.length === 0 ? <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Sem fornecedores convidados.</p> : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Fornecedor</Th><Th>Status</Th><Th align="right">Total</Th></tr></thead>
                <tbody>
                  {fornecedores.map((f) => (
                    <tr key={f.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                      <Td>
                        <div style={{ fontWeight: 600 }}>{f.fornecedor_nome}</div>
                        {f.fornecedor_cnpj && <span style={{ fontSize: 9, color: C.espressoM }}>{f.fornecedor_cnpj}</span>}
                      </Td>
                      <Td><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: C.cream, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600 }}>{f.status}</span></Td>
                      <Td align="right">{Number(f.total ?? 0) > 0 ? <strong>{fmtBRL(f.total)}</strong> : <span style={{ color: C.espressoL }}>—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            {canEnviar && <button onClick={onEnviar} style={btnSec}><Send size={14} /> Marcar enviada</button>}
            <button onClick={onCompare} style={btnPri}><BarChart3 size={14} /> Comparar propostas</button>
            {canCancelar && <button onClick={onCancelar} style={{ ...btnSec, borderColor: C.red, color: C.red }}><X size={14} /> Cancelar cotação</button>}
            {cotacao.compra_gerada_id && <span style={{ fontSize: 11, color: C.purple, fontWeight: 600, alignSelf: 'center' }}>✓ Compra gerada</span>}
          </div>
        </div>
      </aside>
    </div>
  )
}

function DrawerCompra({ compra, cotacaoOrigem, onClose, onAvancar, onReceber, onGerarTitulos }: { compra: Compra; cotacaoOrigem: Cotacao | null | undefined; onClose: () => void; onAvancar: (s: string) => void; onReceber: () => void; onGerarTitulos: () => void }) {
  const [itens, setItens] = useState<{ id: string; produto_nome: string; produto_codigo: string | null; unidade: string | null; quantidade: number; quantidade_recebida: number | null; preco_unitario: number | null; subtotal: number | null }[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_compras_itens').select('id,produto_nome,produto_codigo,unidade,quantidade,quantidade_recebida,preco_unitario,subtotal').eq('compra_id', compra.id).order('ordem', { nullsFirst: true })
      if (alive) setItens(data ?? [])
    })()
    return () => { alive = false }
  }, [compra.id])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', height: '100%', background: C.offWhite, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600 }}>Pedido de compra</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{compra.numero ?? '—'}</h2>
              <StatusBadge status={compra.status} mapa={STATUS_COMP} />
            </div>
            {cotacaoOrigem && <p style={{ margin: '4px 0 0', fontSize: 11, color: C.purple }}>📂 Originado da cotação <strong>{cotacaoOrigem.numero}</strong></p>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}><X size={16} /></button>
        </header>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card titulo="Fornecedor & Datas">
            <Row label="Fornecedor" value={compra.fornecedor_nome ?? '—'} />
            {compra.fornecedor_cnpj && <Row label="CNPJ" value={compra.fornecedor_cnpj} />}
            <Row label="Data pedido" value={fmtDate(compra.data_pedido)} />
            <Row label="Previsão entrega" value={fmtDate(compra.data_prevista)} />
            {compra.data_recebimento && <Row label="Recebido em" value={fmtDate(compra.data_recebimento)} />}
          </Card>

          <Card titulo={`Itens · ${itens.length}`}>
            {itens.length === 0 ? <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Sem itens.</p> : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Produto</Th><Th align="right">Qtd</Th><Th align="right">Recebido</Th><Th align="right">Subtotal</Th></tr></thead>
                <tbody>
                  {itens.map((it) => (
                    <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                      <Td><strong>{it.produto_nome}</strong>{it.produto_codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace', marginLeft: 6 }}>{it.produto_codigo}</span>}</Td>
                      <Td align="right">{it.quantidade} {it.unidade}</Td>
                      <Td align="right">{Number(it.quantidade_recebida ?? 0)}</Td>
                      <Td align="right"><strong>{fmtBRL(it.subtotal)}</strong></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card titulo="Total">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <strong>Total</strong>
              <strong style={{ color: C.gold }}>{fmtBRL(compra.total)}</strong>
            </div>
          </Card>

          <Card titulo="Recebimento & NF">
            {compra.nf_numero && (
              <Row label="NF do fornecedor" value={<strong style={{ color: C.green }}>{compra.nf_numero}</strong>} />
            )}
            {compra.estoque_baixado && <Row label="Estoque" value={<span style={{ color: C.green, fontWeight: 600 }}>✓ Atualizado pela compra</span>} />}
            {compra.titulos_gerados && <Row label="Financeiro" value={<span style={{ color: C.green, fontWeight: 600 }}>✓ Títulos gerados em Contas a pagar</span>} />}
          </Card>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            {compra.status === 'aberta' && (
              <button onClick={() => onAvancar('aguardando_entrega')} style={btnSec}><Truck size={14} /> Aguardando entrega</button>
            )}
            {!compra.estoque_baixado && ['aberta', 'aguardando_entrega', 'recebida_parcial'].includes(compra.status) && (
              <button onClick={onReceber} data-testid="commerce-receber" style={{ ...btnPri, background: C.green }}><CheckCircle2 size={14} /> Receber (atualiza estoque)</button>
            )}
            {!compra.titulos_gerados && compra.estoque_baixado && (
              <button onClick={onGerarTitulos} data-testid="commerce-gerar-titulos" style={btnPri}><FileText size={14} /> Gerar financeiro</button>
            )}
            {compra.status === 'recebida_total' && compra.estoque_baixado && compra.titulos_gerados && (
              <button onClick={() => onAvancar('finalizada')} style={btnPri}><Award size={14} /> Finalizar</button>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Modal Comparativo
// ════════════════════════════════════════════════════════════

function ModalComparativo({ cotacao, onClose, onAprovar }: { cotacao: Cotacao; onClose: () => void; onAprovar: (fornecedorId: string) => void }) {
  const [itens, setItens] = useState<CotacaoItem[]>([])
  const [fornecedores, setFornecedores] = useState<CotacaoFornecedor[]>([])
  const [propostas, setPropostas] = useState<CotacaoProposta[]>([])
  const [resumo, setResumo] = useState<{ menor_valor_total?: number; maior_valor_total?: number; total_propostas?: number; fornecedor_menor_valor?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const [it, fo, rp] = await Promise.all([
        supabase.from('erp_cotacoes_itens').select('*').eq('cotacao_id', cotacao.id).order('ordem', { nullsFirst: true }),
        supabase.from('erp_cotacoes_fornecedores').select('*').eq('cotacao_id', cotacao.id).order('fornecedor_nome'),
        supabase.rpc('fn_resumo_cotacao', { p_cotacao_id: cotacao.id }),
      ])
      if (!alive) return
      const fornArr = (fo.data ?? []) as CotacaoFornecedor[]
      setItens((it.data ?? []) as CotacaoItem[])
      setFornecedores(fornArr)
      const resumoRow = Array.isArray(rp.data) ? rp.data[0] : null
      setResumo(resumoRow)
      // Carregar propostas
      if (fornArr.length > 0) {
        const { data: props } = await supabase.from('erp_cotacoes_propostas').select('*').in('cotacao_fornecedor_id', fornArr.map((f) => f.id))
        if (alive) setPropostas((props ?? []) as CotacaoProposta[])
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [cotacao.id])

  // Indexar propostas por (item, fornecedor)
  const propostaMap = useMemo(() => {
    const m: Record<string, CotacaoProposta> = {}
    propostas.forEach((p) => { m[`${p.cotacao_item_id}|${p.cotacao_fornecedor_id}`] = p })
    return m
  }, [propostas])

  // Calcular total por fornecedor + identificar menor
  const totaisPorFornecedor = useMemo(() => {
    const t: Record<string, number> = {}
    fornecedores.forEach((f) => {
      let total = 0
      itens.forEach((it) => {
        const p = propostaMap[`${it.id}|${f.id}`]
        if (p && p.disponivel !== false) {
          const qtd = Number(it.quantidade ?? 0)
          const preco = Number(p.preco_unitario ?? 0)
          total += qtd * preco
        }
      })
      t[f.id] = total
    })
    return t
  }, [fornecedores, itens, propostaMap])

  const fornecedorMenor = useMemo(() => {
    const validos = Object.entries(totaisPorFornecedor).filter(([, v]) => v > 0)
    if (validos.length === 0) return null
    return validos.reduce((a, b) => (a[1] < b[1] ? a : b))[0]
  }, [totaisPorFornecedor])

  // Menor preco por item
  function menorFornecedorPorItem(itemId: string): string | null {
    const candidatos = fornecedores
      .map((f) => ({ fid: f.id, p: propostaMap[`${itemId}|${f.id}`] }))
      .filter((x) => x.p && x.p.disponivel !== false && Number(x.p.preco_unitario ?? 0) > 0)
    if (candidatos.length === 0) return null
    return candidatos.reduce((a, b) => (Number(a.p!.preco_unitario) < Number(b.p!.preco_unitario) ? a : b)).fid
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 24, width: '100%', maxWidth: 1100, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Comparativo de propostas</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.espressoM }}>Cotação <strong style={{ fontFamily: 'monospace' }}>{cotacao.numero}</strong> · {cotacao.descricao}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}><X size={16} /></button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: C.espressoM, padding: 30 }}>Carregando…</p>
        ) : itens.length === 0 || fornecedores.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>
            Adicione itens e fornecedores à cotação para comparar propostas.
          </div>
        ) : (
          <>
            {/* KPIs resumo */}
            {resumo && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
                <Kpi label="Itens" valor={String(itens.length)} />
                <Kpi label="Fornecedores" valor={String(fornecedores.length)} />
                <Kpi label="Propostas" valor={String(resumo.total_propostas ?? 0)} />
                <Kpi label="Menor total" valor={resumo.menor_valor_total != null ? fmtBRL(Number(resumo.menor_valor_total)) : '—'} accent={C.green} sub={resumo.fornecedor_menor_valor ?? undefined} />
              </div>
            )}

            {/* Matriz */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '60vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
                <thead style={{ background: C.cream, position: 'sticky', top: 0 }}>
                  <tr>
                    <Th>Item</Th>
                    {fornecedores.map((f) => (
                      <Th key={f.id} align="right">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span>{f.fornecedor_nome}</span>
                          {f.fornecedor_cnpj && <span style={{ fontSize: 9, color: C.espressoL, fontWeight: 400 }}>{f.fornecedor_cnpj}</span>}
                        </div>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it) => {
                    const menorFid = menorFornecedorPorItem(it.id)
                    return (
                      <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                        <Td><strong>{it.produto_nome}</strong><div style={{ fontSize: 10, color: C.espressoM }}>Qtd: {it.quantidade} {it.unidade}</div></Td>
                        {fornecedores.map((f) => {
                          const p = propostaMap[`${it.id}|${f.id}`]
                          const isMenor = menorFid === f.id && p && p.disponivel !== false
                          if (!p) return <Td key={f.id} align="right"><span style={{ color: C.espressoL, fontStyle: 'italic' }}>sem proposta</span></Td>
                          if (p.disponivel === false) return <Td key={f.id} align="right"><span style={{ color: C.red, fontWeight: 600 }}>indisponível</span></Td>
                          return (
                            <Td key={f.id} align="right">
                              <span style={{ fontWeight: isMenor ? 700 : 500, color: isMenor ? C.green : C.espresso, padding: isMenor ? '2px 6px' : 0, borderRadius: 4, background: isMenor ? C.greenBg : 'transparent' }}>
                                {isMenor && '🟢 '}{fmtBRL(p.preco_unitario)}
                              </span>
                            </Td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  <tr style={{ background: C.cream, borderTop: `2px solid ${C.border}`, fontWeight: 700 }}>
                    <Td>TOTAL</Td>
                    {fornecedores.map((f) => {
                      const total = totaisPorFornecedor[f.id] ?? 0
                      const isMenor = f.id === fornecedorMenor
                      return (
                        <Td key={f.id} align="right">
                          <span style={{ color: isMenor ? C.green : C.espresso, fontWeight: 700 }}>
                            {isMenor && '★ '}{fmtBRL(total)}
                          </span>
                        </Td>
                      )
                    })}
                  </tr>
                  <tr style={{ borderTop: `1px solid ${C.borderL}` }}>
                    <Td></Td>
                    {fornecedores.map((f) => {
                      const total = totaisPorFornecedor[f.id] ?? 0
                      const canApprove = cotacao.status !== 'aprovada' && cotacao.status !== 'cancelada' && total > 0
                      return (
                        <Td key={f.id} align="right">
                          {canApprove && (
                            <button onClick={() => onAprovar(f.id)} style={{ ...btnPri, padding: '6px 10px', fontSize: 11 }}>
                              <Award size={12} /> Aprovar
                            </button>
                          )}
                        </Td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Modal Nova Cotação
// ════════════════════════════════════════════════════════════

function ModalNovaCotacao({ companyId, onClose, onCreated, flash, flashErr }: {
  companyId: string; onClose: () => void; onCreated: (id: string) => void;
  flash: (m: string) => void; flashErr: (m: string) => void;
}) {
  const [step, setStep] = useState<'identif' | 'itens' | 'fornec'>('identif')
  const [descricao, setDescricao] = useState('')
  const [solicitante, setSolicitante] = useState('')
  const [dataLimite, setDataLimite] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  // FIX-COTACAO-AUTOCOMPLETE-v1: itens agora carregam produto_id (UUID real)
  const [itens, setItens] = useState<{
    produto_id: string | null;
    produto_nome: string;
    produto_codigo: string | null;
    quantidade: number;
    unidade: string;
    busca: string;
    candidatos: { id: string; codigo: string; nome: string; unidade: string | null }[];
  }[]>([
    { produto_id: null, produto_nome: '', produto_codigo: null, quantidade: 1, unidade: 'un', busca: '', candidatos: [] },
  ])
  const [fornBusca, setFornBusca] = useState('')
  const [fornCandidatos, setFornCandidatos] = useState<Fornecedor[]>([])
  const [fornSelecionados, setFornSelecionados] = useState<Fornecedor[]>([])
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (fornBusca.trim().length < 2) { setFornCandidatos([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('erp_fornecedores')
        .select('id,nome_fantasia,razao_social,cnpj_cpf,cpf_cnpj,email,telefone')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .or(`nome_fantasia.ilike.%${fornBusca}%,razao_social.ilike.%${fornBusca}%,cnpj_cpf.ilike.%${fornBusca}%,cpf_cnpj.ilike.%${fornBusca}%`)
        .limit(15)
      setFornCandidatos((data ?? []) as Fornecedor[])
    }, 280)
    return () => clearTimeout(t)
  }, [fornBusca, companyId])

  // FIX-COTACAO-PRODUTO-AUTOCOMPLETE-v1: busca produto na linha do item.
  //   - Dispara a partir do 1º caractere (era >= 2)
  //   - Prioriza candidatos que COMECAM com o termo (2 queries unidas, dedup)
  //   - Mesmo padrao de cartao do fornecedor (CheckCircle + nome + codigo)
  async function buscarProduto(idx: number, q: string) {
    setItens((prev) => prev.map((it, i) => i === idx ? { ...it, busca: q } : it))
    if (q.trim().length < 1) {
      setItens((prev) => prev.map((it, i) => i === idx ? { ...it, candidatos: [] } : it))
      return
    }
    const t = q.trim()
    const inicia = supabase
      .from('erp_produtos')
      .select('id, codigo, nome, unidade')
      .eq('company_id', companyId).eq('ativo', true)
      .or(`nome.ilike.${t}%,codigo.ilike.${t}%`)
      .order('nome').limit(50)
    const contem = supabase
      .from('erp_produtos')
      .select('id, codigo, nome, unidade')
      .eq('company_id', companyId).eq('ativo', true)
      .ilike('nome', `%${t}%`)
      .order('nome').limit(50)
    const [resInicia, resContem] = await Promise.all([inicia, contem])
    const map = new Map<string, { id: string; codigo: string; nome: string; unidade: string | null }>()
    for (const p of (resInicia.data ?? [])) map.set(p.id, p)
    for (const p of (resContem.data ?? [])) if (!map.has(p.id)) map.set(p.id, p)
    const candidatos = Array.from(map.values()).slice(0, 50)
    setItens((prev) => prev.map((it, i) => i === idx ? { ...it, candidatos } : it))
  }

  function selecionarProduto(idx: number, p: { id: string; codigo: string; nome: string; unidade: string | null }) {
    setItens((prev) => prev.map((it, i) => i === idx ? {
      ...it,
      produto_id: p.id,
      produto_nome: p.nome,
      produto_codigo: p.codigo,
      unidade: p.unidade ?? it.unidade,
      busca: '',
      candidatos: [],
    } : it))
  }

  function limparProduto(idx: number) {
    setItens((prev) => prev.map((it, i) => i === idx ? {
      ...it, produto_id: null, produto_nome: '', produto_codigo: null, busca: '', candidatos: [],
    } : it))
  }

  function toggleFornecedor(f: Fornecedor) {
    setFornSelecionados((prev) => prev.find((x) => x.id === f.id) ? prev.filter((x) => x.id !== f.id) : [...prev, f])
  }

  async function criar(comoRascunho: boolean) {
    setSalvando(true)
    const numero = `COT-${Date.now().toString().slice(-6)}`
    const { data: { user } } = await supabase.auth.getUser()
    const { data: cot, error } = await supabase.from('erp_cotacoes').insert({
      company_id: companyId,
      numero,
      descricao: descricao || null,
      data_abertura: new Date().toISOString().slice(0, 10),
      data_limite: dataLimite,
      status: comoRascunho ? 'rascunho' : 'enviada',
      solicitante: solicitante || null,
      created_by: user?.id,
    }).select().single()
    if (error || !cot) { flashErr('Erro: ' + (error?.message ?? 'desconhecido')); setSalvando(false); return }

    // Itens · FIX-COTACAO-AUTOCOMPLETE-v1: agora exige produto_id
    const itensValidos = itens.filter((i) => i.produto_id && i.produto_nome.trim() && i.quantidade > 0)
    if (itensValidos.length > 0) {
      await supabase.from('erp_cotacoes_itens').insert(itensValidos.map((it, idx) => ({
        cotacao_id: cot.id,
        company_id: companyId,
        ordem: idx + 1,
        produto_id: it.produto_id,
        produto_codigo: it.produto_codigo,
        produto_nome: it.produto_nome.trim(),
        quantidade: it.quantidade,
        unidade: it.unidade,
      })))
    }

    // Fornecedores
    if (fornSelecionados.length > 0) {
      await supabase.from('erp_cotacoes_fornecedores').insert(fornSelecionados.map((f) => ({
        cotacao_id: cot.id,
        company_id: companyId,
        fornecedor_id: f.id,
        fornecedor_nome: f.nome_fantasia ?? f.razao_social,
        fornecedor_cnpj: f.cnpj_cpf ?? f.cpf_cnpj,
        status: 'convidado',
        data_convite: new Date().toISOString(),
      })))
    }

    flash(`Cotação ${numero} criada ${comoRascunho ? 'como rascunho' : 'e marcada como enviada'}.`)
    setSalvando(false)
    onCreated(cot.id)
  }

  const stepNum: Record<typeof step, number> = { identif: 1, itens: 2, fornec: 3 }
  const podeAvancarIdent = !!descricao.trim()
  // FIX-COTACAO-AUTOCOMPLETE-v1: exige produto_id vinculado (UUID real)
  const podeAvancarItens = itens.some((i) => i.produto_id && i.produto_nome.trim() && i.quantidade > 0)
  const podeFinalizar = fornSelecionados.length > 0 && podeAvancarItens

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 24, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Nova cotação</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, fontSize: 11 }}>
          {(['identif', 'itens', 'fornec'] as const).map((s) => (
            <span key={s} style={{ padding: '4px 10px', borderRadius: 999, background: step === s ? C.gold : C.cream, color: step === s ? '#FFF' : C.espressoM, fontWeight: 600 }}>
              {stepNum[s]}. {s === 'identif' ? 'Identificação' : s === 'itens' ? 'Itens' : 'Fornecedores'}
            </span>
          ))}
        </div>

        {step === 'identif' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="Descrição *"><input autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Materiais de drywall para obra centro" style={inp} /></Field>
            <Field label="Solicitante"><input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} placeholder="Ex: João Silva (Compras)" style={inp} /></Field>
            <Field label="Data limite para respostas"><input type="date" value={dataLimite} onChange={(e) => setDataLimite(e.target.value)} style={inp} /></Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={onClose} style={btnSec}>Cancelar</button>
              <button onClick={() => setStep('itens')} disabled={!podeAvancarIdent} style={{ ...btnPri, opacity: podeAvancarIdent ? 1 : 0.5 }}>Próximo →</button>
            </div>
          </div>
        )}

        {step === 'itens' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.espressoM }}>Itens a cotar *</label>
            {itens.map((it, i) => (
              <div key={i} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {it.produto_id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, background: C.goldBg, borderRadius: 6 }}>
                    <CheckCircle2 size={14} style={{ color: C.gold, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{it.produto_nome}</div>
                      {it.produto_codigo && <div style={{ fontSize: 10, color: C.espressoM, fontFamily: 'monospace' }}>{it.produto_codigo}</div>}
                    </div>
                    <button onClick={() => limparProduto(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red }}><Trash2 size={12} /></button>
                  </div>
                ) : (
                  <>
                    <input placeholder="Buscar produto (nome ou código) · escolha da lista" value={it.busca} onChange={(e) => buscarProduto(i, e.target.value)} style={inp} data-testid={`cot-produto-busca-${i}`} />
                    {it.candidatos.length > 0 && (
                      <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff' }}>
                        {it.candidatos.map((p) => (
                          <button key={p.id} type="button" onClick={() => selecionarProduto(i, p)} data-testid={`cot-produto-opt-${p.id}`}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', borderBottom: `1px solid ${C.borderL}`, cursor: 'pointer', fontSize: 12 }}>
                            <strong>{p.nome}</strong>
                            <span style={{ marginLeft: 8, fontSize: 10, color: C.espressoM, fontFamily: 'monospace' }}>{p.codigo}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {it.busca.trim().length >= 2 && it.candidatos.length === 0 && (
                      <div style={{ fontSize: 11, color: C.espressoM, fontStyle: 'italic' }}>Nenhum produto encontrado. Cadastre antes em Produtos.</div>
                    )}
                  </>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.8fr auto', gap: 6, alignItems: 'center' }}>
                  <input type="number" step="0.01" placeholder="Qtd" value={it.quantidade} onChange={(e) => { const copy = [...itens]; copy[i] = { ...copy[i], quantidade: parseFloat(e.target.value) || 0 }; setItens(copy) }} style={{ ...inp, textAlign: 'right' }} />
                  <select value={it.unidade} onChange={(e) => { const copy = [...itens]; copy[i] = { ...copy[i], unidade: e.target.value }; setItens(copy) }} style={inp}>
                    <option value="un">un</option><option value="m">m</option><option value="m²">m²</option><option value="kg">kg</option><option value="L">L</option><option value="pç">pç</option>
                  </select>
                  {itens.length > 1 && <button onClick={() => setItens(itens.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red }}><Trash2 size={14} /></button>}
                </div>
              </div>
            ))}
            <button onClick={() => setItens([...itens, { produto_id: null, produto_nome: '', produto_codigo: null, quantidade: 1, unidade: 'un', busca: '', candidatos: [] }])} style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11, border: `1px solid ${C.gold}`, borderRadius: 6, background: C.goldBg, color: C.goldD, fontWeight: 600, cursor: 'pointer' }}>+ Adicionar item</button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12 }}>
              <button onClick={() => setStep('identif')} style={btnSec}>← Voltar</button>
              <button onClick={() => setStep('fornec')} disabled={!podeAvancarItens} style={{ ...btnPri, opacity: podeAvancarItens ? 1 : 0.5 }}>Próximo →</button>
            </div>
            {!podeAvancarItens && itens.some((i) => i.busca.trim()) && (
              <div style={{ fontSize: 11, color: C.espressoM, fontStyle: 'italic' }}>Escolha o produto na lista (digitar e não selecionar não vincula ao cadastro).</div>
            )}
          </div>
        )}

        {step === 'fornec' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.espressoM }}>Fornecedores convidados *</label>
            <input value={fornBusca} onChange={(e) => setFornBusca(e.target.value)} placeholder="Buscar fornecedor (nome ou CNPJ, mín 2 chars)" style={inp} />
            {fornCandidatos.length > 0 && (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 220, overflowY: 'auto' }}>
                {fornCandidatos.map((f) => {
                  const sel = fornSelecionados.find((x) => x.id === f.id)
                  return (
                    <button key={f.id} onClick={() => toggleFornecedor(f)} style={{ width: '100%', textAlign: 'left', padding: 10, border: 'none', borderBottom: `1px solid ${C.borderL}`, background: sel ? C.goldBg : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{f.nome_fantasia || f.razao_social}</div>
                        <span style={{ fontSize: 10, color: C.espressoM }}>{f.cnpj_cpf || f.cpf_cnpj || '—'}</span>
                      </div>
                      {sel ? <CheckCircle2 size={16} style={{ color: C.gold }} /> : <Plus size={16} style={{ color: C.espressoL }} />}
                    </button>
                  )
                })}
              </div>
            )}
            {fornSelecionados.length > 0 && (
              <div style={{ padding: 10, background: C.goldBg, borderRadius: 8, fontSize: 11 }}>
                <strong>{fornSelecionados.length} fornecedor{fornSelecionados.length === 1 ? '' : 'es'} selecionado{fornSelecionados.length === 1 ? '' : 's'}:</strong>
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {fornSelecionados.map((f) => (
                    <span key={f.id} style={{ padding: '2px 8px', background: C.gold, color: '#FFF', borderRadius: 999, fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {f.nome_fantasia || f.razao_social}
                      <button onClick={() => toggleFornecedor(f)} style={{ background: 'none', border: 'none', color: '#FFF', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => setStep('itens')} style={btnSec}>← Voltar</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => criar(true)} disabled={salvando || !podeFinalizar} style={{ ...btnSec, opacity: salvando || !podeFinalizar ? 0.5 : 1 }}>Salvar rascunho</button>
                <button onClick={() => criar(false)} disabled={salvando || !podeFinalizar} style={{ ...btnPri, opacity: salvando || !podeFinalizar ? 0.5 : 1 }}>{salvando ? 'Salvando…' : 'Criar e enviar'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

function TabBtn({ ativo, onClick, icon, label, count }: { ativo: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} style={{ padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: ativo ? `2px solid ${C.gold}` : '2px solid transparent', color: ativo ? C.goldD : C.espressoM, fontWeight: ativo ? 700 : 500, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      {icon} {label}
      {typeof count === 'number' && <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: ativo ? C.goldBg : C.cream, color: ativo ? C.goldD : C.espressoM, fontWeight: 700 }}>{count}</span>}
    </button>
  )
}

function StatusBadge({ status, mapa }: { status: string; mapa: Record<string, { label: string; bg: string; fg: string }> }) {
  const s = mapa[status] ?? { label: status, bg: C.cream, fg: C.espresso }
  return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.fg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{s.label}</span>
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ padding: '10px 14px', textAlign: align, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoM }}>{children}</th>
}
function Td({ children, align = 'left', onClick }: { children?: React.ReactNode; align?: 'left' | 'right'; onClick?: () => void }) {
  return <td onClick={onClick} style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle', color: C.espresso }}>{children}</td>
}
function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </section>
  )
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
      <span style={{ color: C.espressoM }}>{label}</span>
      <span style={{ color: C.espresso, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  )
}
function EmptyState({ titulo, texto, cta }: { titulo: string; texto: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 48, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <ShoppingCart size={56} style={{ color: C.gold, opacity: 0.8 }} />
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{titulo}</h2>
      <p style={{ margin: 0, fontSize: 13, color: C.espressoM, maxWidth: 460, lineHeight: 1.5 }}>{texto}</p>
      {cta && <button onClick={cta.onClick} style={{ marginTop: 4, padding: '10px 18px', borderRadius: 8, border: 'none', background: C.gold, color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{cta.label}</button>}
    </div>
  )
}
function Kpi({ label, valor, sub, accent }: { label: string; valor: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 9, color: C.espressoL, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: accent ?? C.espresso, lineHeight: 1.1 }}>{valor}</span>
      {sub && <span style={{ fontSize: 10, color: C.espressoM }}>{sub}</span>}
    </div>
  )
}

const inp: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.espresso, background: C.white, outline: 'none', width: '100%',
}
const selInpStyle: React.CSSProperties = {
  padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.white, color: C.espresso, cursor: 'pointer', minWidth: 160,
}
const btnPri: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: C.gold, color: '#FFF', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
}
const btnSec: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.espresso, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
}
const btnMini: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.gold}`, background: C.goldBg, color: C.goldD, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
}
function btnPrincipal(enabled: boolean): React.CSSProperties {
  return { padding: '8px 16px', borderRadius: 8, border: 'none', background: enabled ? C.gold : C.cream, color: enabled ? '#FFF' : C.espressoL, fontSize: 12, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }
}

// ════════════════════════════════════════════════════════════
// Modal Nova Compra — COMMERCE-F1
// ════════════════════════════════════════════════════════════

interface NovaCompraProps {
  companyId: string
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
  flash: (m: string) => void
  flashErr: (m: string) => void
}

type ProdutoBusca = { id: string; codigo: string; nome: string; unidade: string | null; preco_custo: number | null; preco_custo_medio: number | null }
type FornecedorBusca = { id: string; nome_fantasia: string; cnpj_cpf: string | null; cpf_cnpj: string | null }
type ItemForm = { tempId: string; produto_id: string; codigo: string; nome: string; unidade: string | null; quantidade: string; preco: string }

function ModalNovaCompra({ companyId, onClose, onCreated, flash, flashErr }: NovaCompraProps) {
  const hoje = new Date().toISOString().slice(0, 10)
  const [fornecedor, setFornecedor] = useState<FornecedorBusca | null>(null)
  const [forBusca, setForBusca] = useState('')
  const [forOpcoes, setForOpcoes] = useState<FornecedorBusca[]>([])
  const [forCarregando, setForCarregando] = useState(false)
  const [itens, setItens] = useState<ItemForm[]>([])
  const [dataPedido, setDataPedido] = useState(hoje)
  const [condicao, setCondicao] = useState('a_vista')
  const [parcelas, setParcelas] = useState('1')
  const [primeiroVenc, setPrimeiroVenc] = useState(hoje)
  const [nfNumero, setNfNumero] = useState('')
  const [nfChave, setNfChave] = useState('')
  const [nfData, setNfData] = useState('')
  const [nfValor, setNfValor] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroLocal, setErroLocal] = useState<string | null>(null)

  useEffect(() => {
    if (!forBusca.trim() || forBusca.trim().length < 2) { setForOpcoes([]); return }
    const q = forBusca.trim()
    setForCarregando(true)
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from('erp_fornecedores')
        .select('id, nome_fantasia, cnpj_cpf, cpf_cnpj')
        .eq('company_id', companyId)
        .ilike('nome_fantasia', `%${q}%`)
        .order('nome_fantasia').limit(20)
      setForOpcoes((data ?? []) as FornecedorBusca[])
      setForCarregando(false)
    }, 250)
    return () => window.clearTimeout(t)
  }, [forBusca, companyId])

  // FIX-PRODUTO-AUTOCOMPLETE-REUSE-262-v1 · usa ProdutoAutocomplete shared
  function adicionarProduto(p: ProdutoSelecionado) {
    if (itens.some((it) => it.produto_id === p.id)) return
    const precoSugerido = Number(p.preco_custo_medio ?? p.preco_custo ?? 0)
    setItens((prev) => [...prev, {
      tempId: crypto.randomUUID(), produto_id: p.id, codigo: p.codigo ?? '',
      nome: p.nome, unidade: p.unidade ?? 'un', quantidade: '1',
      preco: precoSugerido > 0 ? precoSugerido.toFixed(2).replace('.', ',') : '',
    }])
  }

  function removerItem(tempId: string) { setItens((prev) => prev.filter((i) => i.tempId !== tempId)) }
  function alterarItem(tempId: string, campo: 'quantidade' | 'preco', valor: string) {
    setItens((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [campo]: valor } : i))
  }

  const totalCalc = useMemo(() => itens.reduce((s, it) => {
    const q = Number(it.quantidade.replace(',', '.')) || 0
    const p = Number(it.preco.replace(',', '.')) || 0
    return s + q * p
  }, 0), [itens])

  async function salvar() {
    setErroLocal(null)
    if (!fornecedor) { setErroLocal('Escolha o fornecedor.'); return }
    if (itens.length === 0) { setErroLocal('Adicione pelo menos um item.'); return }
    for (const it of itens) {
      const q = Number(it.quantidade.replace(',', '.')) || 0
      const p = Number(it.preco.replace(',', '.')) || 0
      if (q <= 0) { setErroLocal(`Quantidade inválida em ${it.nome}.`); return }
      if (p < 0) { setErroLocal(`Preço inválido em ${it.nome}.`); return }
    }
    const parcN = Math.max(1, parseInt(parcelas, 10) || 1)
    setSalvando(true)
    try {
      const numero = `C${Date.now().toString().slice(-8)}`
      const { data: compraRow, error: e1 } = await supabase.from('erp_compras').insert({
        company_id: companyId, numero,
        fornecedor_id: fornecedor.id, fornecedor_nome: fornecedor.nome_fantasia,
        fornecedor_cnpj: fornecedor.cnpj_cpf ?? fornecedor.cpf_cnpj,
        data_pedido: dataPedido, status: 'aberta',
        condicao_pagamento: condicao, parcelas: parcN,
        primeiro_vencimento: primeiroVenc || dataPedido,
        subtotal: totalCalc, total: totalCalc,
        nf_numero: nfNumero.trim() || null,
        nf_chave: nfChave.trim() || null,
        nf_data_emissao: nfData || null,
        nf_valor: nfValor.trim() ? Number(nfValor.replace(',', '.')) : null,
        observacoes: observacoes.trim() || null,
      }).select('id').single()
      if (e1 || !compraRow) throw new Error(e1?.message ?? 'Falha ao criar compra')

      const linhas = itens.map((it, i) => {
        const q = Number(it.quantidade.replace(',', '.')) || 0
        const p = Number(it.preco.replace(',', '.')) || 0
        return {
          company_id: companyId, compra_id: compraRow.id, ordem: i + 1,
          produto_id: it.produto_id, produto_codigo: it.codigo, produto_nome: it.nome,
          unidade: it.unidade, quantidade: q, preco_unitario: p, subtotal: q * p,
        }
      })
      const { error: e2 } = await supabase.from('erp_compras_itens').insert(linhas)
      if (e2) throw new Error(e2.message)

      flash('Compra criada.')
      await onCreated(compraRow.id)
    } catch (err) {
      flashErr(err instanceof Error ? err.message : 'Erro ao salvar')
      setErroLocal(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !salvando) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto', background: C.offWhite, borderRadius: 14, boxShadow: '0 12px 32px rgba(0,0,0,0.2)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Nova compra</h3>
          <button onClick={onClose} disabled={salvando} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </header>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card titulo="Fornecedor">
            {fornecedor ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: C.cream, borderRadius: 8 }}>
                <CheckCircle2 size={16} style={{ color: C.gold }} />
                <div style={{ flex: 1 }}>
                  <strong>{fornecedor.nome_fantasia}</strong>
                  {(fornecedor.cnpj_cpf ?? fornecedor.cpf_cnpj) && <div style={{ fontSize: 11, color: C.espressoM }}>{fornecedor.cnpj_cpf ?? fornecedor.cpf_cnpj}</div>}
                </div>
                <button onClick={() => setFornecedor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red }}><Trash2 size={14} /></button>
              </div>
            ) : (
              <>
                <input value={forBusca} onChange={(e) => setForBusca(e.target.value)} placeholder="Buscar fornecedor (mín. 2 caracteres)..."
                  style={{ width: '100%', padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }} />
                {forCarregando && <div style={{ fontSize: 11, color: C.espressoM, marginTop: 6 }}>Buscando...</div>}
                {forOpcoes.length > 0 && (
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff' }}>
                    {forOpcoes.map((f) => (
                      <button key={f.id} type="button" onClick={() => { setFornecedor(f); setForBusca(''); setForOpcoes([]) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: `1px solid ${C.borderL}`, cursor: 'pointer', fontSize: 12 }}>
                        <strong>{f.nome_fantasia}</strong>
                        {(f.cnpj_cpf ?? f.cpf_cnpj) && <span style={{ marginLeft: 8, color: C.espressoM, fontSize: 11 }}>{f.cnpj_cpf ?? f.cpf_cnpj}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card titulo={`Itens · ${itens.length}`}>
            {/* FIX-PRODUTO-AUTOCOMPLETE-REUSE-262-v1 · componente compartilhado */}
            <div style={{ marginBottom: 10 }}>
              <ProdutoAutocomplete
                companyId={companyId}
                selecionado={null}
                onSelect={adicionarProduto}
                placeholder="Buscar produto (nome ou código) · adicione ao pedido"
                testId="compra-prod"
              />
            </div>
            {itens.length === 0 ? (
              <div style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', padding: '8px 0' }}>Busque e adicione produtos acima.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Produto</Th><Th>Qtd</Th><Th>Preço un.</Th><Th align="right">Subtotal</Th><Th></Th></tr></thead>
                <tbody>
                  {itens.map((it) => {
                    const q = Number(it.quantidade.replace(',', '.')) || 0
                    const p = Number(it.preco.replace(',', '.')) || 0
                    return (
                      <tr key={it.tempId} style={{ borderTop: `1px solid ${C.borderL}` }}>
                        <Td>
                          <strong>{it.nome}</strong>
                          <div style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace' }}>{it.codigo}</div>
                        </Td>
                        <Td>
                          <input value={it.quantidade} onChange={(e) => alterarItem(it.tempId, 'quantidade', e.target.value)}
                            style={{ width: 60, padding: 4, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }} />
                          <span style={{ fontSize: 10, color: C.espressoM, marginLeft: 4 }}>{it.unidade}</span>
                        </Td>
                        <Td>
                          <input value={it.preco} onChange={(e) => alterarItem(it.tempId, 'preco', e.target.value)} placeholder="0,00"
                            style={{ width: 80, padding: 4, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }} />
                        </Td>
                        <Td align="right"><strong>{fmtBRL(q * p)}</strong></Td>
                        <Td align="right">
                          <button type="button" onClick={() => removerItem(it.tempId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red }}><Trash2 size={12} /></button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <div style={{ marginTop: 10, padding: 10, background: C.goldBg, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Total</strong>
              <strong style={{ color: C.goldD, fontSize: 16 }}>{fmtBRL(totalCalc)}</strong>
            </div>
          </Card>

          <Card titulo="Pagamento">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 11, color: C.espressoM }}>Condição
                <select value={condicao} onChange={(e) => setCondicao(e.target.value)} style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: '#fff' }}>
                  <option value="a_vista">À vista</option>
                  <option value="30">30 dias</option>
                  <option value="30_60">30/60</option>
                  <option value="30_60_90">30/60/90</option>
                  <option value="parcelado">Parcelado custom</option>
                </select>
              </label>
              <label style={{ fontSize: 11, color: C.espressoM }}>Parcelas
                <input type="number" min="1" value={parcelas} onChange={(e) => setParcelas(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: C.espressoM, gridColumn: '1 / -1' }}>Primeiro vencimento
                <input type="date" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              </label>
            </div>
          </Card>

          <Card titulo="NF do fornecedor (opcional)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 11, color: C.espressoM }}>Número
                <input value={nfNumero} onChange={(e) => setNfNumero(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: C.espressoM }}>Data emissão
                <input type="date" value={nfData} onChange={(e) => setNfData(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: C.espressoM, gridColumn: '1 / -1' }}>Chave (44 dígitos)
                <input value={nfChave} onChange={(e) => setNfChave(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }} />
              </label>
              <label style={{ fontSize: 11, color: C.espressoM }}>Valor NF
                <input value={nfValor} onChange={(e) => setNfValor(e.target.value)} placeholder="0,00"
                  style={{ width: '100%', marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              </label>
            </div>
          </Card>

          <Card titulo="Observações">
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2}
              style={{ width: '100%', padding: 8, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, resize: 'vertical' }} />
          </Card>

          {erroLocal && (
            <div style={{ padding: 10, background: C.redBg, border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 12 }}>{erroLocal}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            <button type="button" onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
            <button type="button" onClick={salvar} disabled={salvando || itens.length === 0 || !fornecedor} data-testid="commerce-nova-compra-salvar"
              style={btnPrincipal(!salvando && itens.length > 0 && !!fornecedor)}>
              {salvando ? 'Salvando…' : 'Criar compra'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
