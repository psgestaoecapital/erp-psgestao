'use client'

// /dashboard/commerce/otc — Order-to-Cash
// PR M.B.1.2 — Commerce 2/12: Orcamento → Pedido → Faturamento (placeholder)
//
// Backend reutilizado (ja existente, 70% pronto):
//   - erp_orcamentos (49 cols) + erp_orcamentos_itens (19 cols)
//   - erp_pedidos (46 cols) + erp_pedidos_itens (20 cols)
//   - erp_orcamento_historico (10 cols)
//   - RPC fn_converter_orcamento_em_pedido (criada neste PR)
//   - erp_clientes (3.514 cadastros existentes) + erp_produtos
//
// Multi-tenant: RD-34 → useCompanyIds (admin / consolidado / grupo / unica)

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import {
  Plus, Search, FileText, ShoppingCart, BarChart3,
  X, Info, Send, CheckCircle2, ArrowRight, Trash2,
} from 'lucide-react'
import OrcamentoItensEditor, { type EditorItem } from '@/components/comum/OrcamentoItensEditor'
import ParcelasEditor from '@/components/comum/ParcelasEditor'

// useSearchParams exige Suspense boundary em pages prerenderizadas (Next 16)
export const dynamic = 'force-dynamic'

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  white: '#FFFFFF',
  cream: '#F0ECE3',
  creamD: '#E8E1D3',
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
}

type Tab = 'orcamentos' | 'pedidos' | 'visao'

type Orcamento = {
  id: string
  company_id: string
  numero: string | null
  versao: number | null
  cliente_id: string | null
  cliente_nome: string | null
  cliente_cnpj: string | null
  cliente_email: string | null
  cliente_telefone: string | null
  data_emissao: string | null
  data_validade: string | null
  data_aprovacao: string | null
  status: string
  vendedor_nome: string | null
  condicao_pagamento: string | null
  subtotal: number | null
  desconto_valor: number | null
  acrescimo_valor: number | null
  frete_valor: number | null
  total: number | null
  qtd_visualizacoes: number | null
  pedido_id: string | null
  observacoes: string | null
  observacoes_internas: string | null
  created_at: string | null
}

type Pedido = {
  id: string
  company_id: string
  numero: string | null
  orcamento_origem_id: string | null
  cliente_id: string | null
  cliente_nome: string | null
  data_pedido: string | null
  data_prevista_entrega: string | null
  data_faturamento: string | null
  status: string
  vendedor_nome: string | null
  subtotal: number | null
  total: number | null
  total_pago: number | null
  nf_numero: string | null
  nf_emitida: boolean | null
  transportadora: string | null
  created_at: string | null
}

type OrcamentoItem = {
  id: string
  orcamento_id: string
  ordem: number | null
  produto_id: string | null
  produto_codigo: string | null
  produto_nome: string
  unidade: string | null
  quantidade: number | null
  preco_unitario: number | null
  preco_custo: number | null
  desconto_percentual: number | null
  subtotal: number | null
  margem_percentual: number | null
}

type Cliente = { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj_cpf: string | null; email: string | null; telefone: string | null }

const STATUS_ORC: Record<string, { label: string; bg: string; fg: string }> = {
  rascunho:    { label: 'Rascunho',     bg: C.cream,    fg: C.espresso },
  enviado:     { label: 'Enviado',      bg: C.goldBg,   fg: C.goldD },
  visualizado: { label: 'Visualizado',  bg: C.blueBg,   fg: C.blue },
  aprovado:    { label: 'Aprovado',     bg: C.greenBg,  fg: C.green },
  recusado:    { label: 'Recusado',     bg: C.redBg,    fg: C.red },
  expirado:    { label: 'Expirado',     bg: C.redBg,    fg: C.red },
  cancelado:   { label: 'Cancelado',    bg: C.redBg,    fg: C.red },
  convertido:  { label: 'Convertido',   bg: C.purpleBg, fg: C.purple },
}

const STATUS_PED: Record<string, { label: string; bg: string; fg: string }> = {
  aberto:        { label: 'Aberto',        bg: C.cream,    fg: C.espresso },
  em_separacao:  { label: 'Em separação',  bg: C.goldBg,   fg: C.goldD },
  expedido:      { label: 'Expedido',      bg: C.blueBg,   fg: C.blue },
  entregue:      { label: 'Entregue',      bg: C.greenBg,  fg: C.green },
  faturado:      { label: 'Faturado',      bg: C.purpleBg, fg: C.purple },
  cancelado:     { label: 'Cancelado',     bg: C.redBg,    fg: C.red },
}

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—'

export default function OTCPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: C.espressoM }}>Carregando…</div>}>
      <OTCPageInner />
    </Suspense>
  )
}

function OTCPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { companyIds, selInfo, loading: companiesLoading, sel } = useCompanyIds()
  const companyIdUnico = selInfo.tipo === 'empresa' && sel ? sel : null
  const canCreate = !!companyIdUnico

  const initialTab = (searchParams?.get('tab') as Tab) || 'orcamentos'
  const [tab, setTab] = useState<Tab>(initialTab)

  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [erro, setErro] = useState<string>('')

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('')

  const [orcSel, setOrcSel] = useState<Orcamento | null>(null)
  const [orcItens, setOrcItens] = useState<OrcamentoItem[]>([])
  const [pedSel, setPedSel] = useState<Pedido | null>(null)
  const [showNova, setShowNova] = useState(false)

  const companyIdsKey = useMemo(() => [...companyIds].sort().join(','), [companyIds])

  // Carrega orcamentos + pedidos quando empresas mudam
  const carregar = useCallback(async () => {
    if (companyIds.length === 0) {
      setOrcamentos([])
      setPedidos([])
      return
    }
    setLoading(true)
    setErro('')
    const [orc, ped] = await Promise.all([
      supabase.from('erp_orcamentos').select('*').in('company_id', companyIds).order('created_at', { ascending: false }).limit(200),
      supabase.from('erp_pedidos').select('*').in('company_id', companyIds).order('created_at', { ascending: false }).limit(200),
    ])
    if (orc.error) setErro('Falha ao carregar orcamentos: ' + orc.error.message)
    else setOrcamentos((orc.data ?? []) as Orcamento[])
    if (ped.error) setErro('Falha ao carregar pedidos: ' + ped.error.message)
    else setPedidos((ped.data ?? []) as Pedido[])
    setLoading(false)
  }, [companyIds])

  useEffect(() => {
    if (companiesLoading) return
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey, companiesLoading])

  // Carrega itens quando orcamento eh selecionado
  useEffect(() => {
    if (!orcSel) {
      setOrcItens([])
      return
    }
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('erp_orcamentos_itens')
        .select('*')
        .eq('orcamento_id', orcSel.id)
        .order('ordem', { ascending: true, nullsFirst: true })
      if (alive) setOrcItens((data ?? []) as OrcamentoItem[])
    })()
    return () => { alive = false }
  }, [orcSel])

  const flash = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(''), 3500)
  }

  // ────────────────────────────────────────────────────────
  // Açoes
  // ────────────────────────────────────────────────────────

  async function enviarOrcamento(id: string) {
    const { error } = await supabase
      .from('erp_orcamentos')
      .update({ status: 'enviado', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { flash('Erro: ' + error.message); return }
    setOrcamentos((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'enviado' } : o)))
    if (orcSel?.id === id) setOrcSel({ ...orcSel, status: 'enviado' })
    flash('Orcamento marcado como enviado.')
  }

  async function aprovarOrcamento(id: string) {
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('erp_orcamentos')
      .update({ status: 'aprovado', data_aprovacao: now, updated_at: now })
      .eq('id', id)
    if (error) { flash('Erro: ' + error.message); return }
    setOrcamentos((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'aprovado', data_aprovacao: now } : o)))
    if (orcSel?.id === id) setOrcSel({ ...orcSel, status: 'aprovado', data_aprovacao: now })
    flash('Orcamento aprovado!')
  }

  async function converterEmPedido(id: string) {
    const { data, error } = await supabase.rpc('fn_converter_orcamento_em_pedido', { p_orcamento_id: id })
    if (error) { flash('Erro: ' + error.message); return }
    const pedidoId = data as string
    flash('Pedido criado com sucesso!')
    setOrcSel(null)
    await carregar()
    router.push(`/dashboard/commerce/otc?tab=pedidos&id=${pedidoId}`)
    setTab('pedidos')
  }

  // ────────────────────────────────────────────────────────
  // Listas filtradas
  // ────────────────────────────────────────────────────────

  const orcFiltrados = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase()
    return orcamentos.filter((o) => {
      if (filtroStatus && o.status !== filtroStatus) return false
      if (!q) return true
      return (
        (o.numero ?? '').toLowerCase().includes(q) ||
        (o.cliente_nome ?? '').toLowerCase().includes(q) ||
        (o.cliente_cnpj ?? '').toLowerCase().includes(q) ||
        (o.vendedor_nome ?? '').toLowerCase().includes(q)
      )
    })
  }, [orcamentos, filtroBusca, filtroStatus])

  const pedFiltrados = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase()
    return pedidos.filter((p) => {
      if (filtroStatus && p.status !== filtroStatus) return false
      if (!q) return true
      return (
        (p.numero ?? '').toLowerCase().includes(q) ||
        (p.cliente_nome ?? '').toLowerCase().includes(q) ||
        (p.nf_numero ?? '').toLowerCase().includes(q)
      )
    })
  }, [pedidos, filtroBusca, filtroStatus])

  // KPIs Visao Geral
  const kpis = useMemo(() => {
    const agora = new Date()
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString().slice(0, 10)
    const orcMes = orcamentos.filter((o) => (o.data_emissao ?? o.created_at ?? '') >= inicioMes)
    const orcMesTotal = orcMes.reduce((s, o) => s + (Number(o.total) || 0), 0)
    const aprovados = orcamentos.filter((o) => o.status === 'aprovado' || o.status === 'convertido')
    const convertidos = orcamentos.filter((o) => o.status === 'convertido').length
    const conversao = orcamentos.length > 0 ? (convertidos / orcamentos.length) * 100 : 0
    const ticketMedio = aprovados.length > 0 ? aprovados.reduce((s, o) => s + (Number(o.total) || 0), 0) / aprovados.length : 0
    const pipelineAberto = orcamentos
      .filter((o) => ['rascunho', 'enviado', 'visualizado', 'aprovado'].includes(o.status))
      .reduce((s, o) => s + (Number(o.total) || 0), 0)
    const distribuicaoStatus = orcamentos.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
    return { orcMesQtd: orcMes.length, orcMesTotal, conversao, ticketMedio, pipelineAberto, distribuicaoStatus }
  }, [orcamentos])

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 24px)', maxWidth: 1280, margin: '0 auto', color: C.espresso }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShoppingCart size={26} style={{ color: C.gold }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>OTC — Order-to-Cash</h1>
            <p style={{ margin: 0, fontSize: 12, color: C.espressoM }}>Orçamento → Pedido → Faturamento</p>
          </div>
        </div>
        {tab === 'orcamentos' && (
          <button
            onClick={() => setShowNova(true)}
            disabled={!canCreate}
            title={canCreate ? 'Criar orçamento' : 'Selecione uma empresa específica no menu superior'}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: canCreate ? C.gold : C.cream,
              color: canCreate ? '#FFF' : C.espressoL,
              fontSize: 12, fontWeight: 600, cursor: canCreate ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Plus size={14} /> Novo Orçamento
          </button>
        )}
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        <TabButton ativo={tab === 'orcamentos'} onClick={() => setTab('orcamentos')} icon={<FileText size={14} />} label="Orçamentos" count={orcamentos.length} />
        <TabButton ativo={tab === 'pedidos'} onClick={() => setTab('pedidos')} icon={<ShoppingCart size={14} />} label="Pedidos" count={pedidos.length} />
        <TabButton ativo={tab === 'visao'} onClick={() => setTab('visao')} icon={<BarChart3 size={14} />} label="Visão geral" />
      </div>

      {/* Hint multi-empresa */}
      {selInfo.tipo !== 'empresa' && companyIds.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.goldBg, border: `1px solid ${C.gold}55`, borderRadius: 8, color: C.goldD, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={14} />
          <span>Exibindo dados de <strong>{selInfo.nome}</strong> ({selInfo.count} {selInfo.count === 1 ? 'empresa' : 'empresas'}). Para criar novos registros, selecione uma empresa específica no menu superior.</span>
        </div>
      )}

      {/* Toast / erro */}
      {msg && <div onClick={() => setMsg('')} style={{ marginBottom: 12, padding: '10px 14px', background: C.greenBg, border: `1px solid ${C.green}55`, borderRadius: 8, color: C.green, fontSize: 12, cursor: 'pointer' }}>{msg}</div>}
      {erro && <div style={{ marginBottom: 12, padding: '10px 14px', background: C.redBg, border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 12 }}>{erro}</div>}

      {/* Filtros (orcamentos + pedidos) */}
      {tab !== 'visao' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }} />
            <input
              type="text" placeholder={`Buscar por número, cliente${tab === 'pedidos' ? ', NF' : ''}…`}
              value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)}
              style={{ width: '100%', padding: '8px 10px 8px 32px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.white, color: C.espresso, outline: 'none' }}
            />
          </div>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.white, color: C.espresso, minWidth: 160 }}>
            <option value="">Todos os status</option>
            {Object.keys(tab === 'orcamentos' ? STATUS_ORC : STATUS_PED).map((s) => (
              <option key={s} value={s}>{(tab === 'orcamentos' ? STATUS_ORC : STATUS_PED)[s].label}</option>
            ))}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.espressoM }}>
            {tab === 'orcamentos' ? orcFiltrados.length : pedFiltrados.length} de {tab === 'orcamentos' ? orcamentos.length : pedidos.length}
          </span>
        </div>
      )}

      {/* Conteúdo */}
      {companiesLoading || loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Carregando…</div>
      ) : companyIds.length === 0 ? (
        <EmptyState titulo="Nenhuma empresa disponível" texto="Você ainda não tem empresas vinculadas. Peça ao administrador para te vincular ou selecione uma no menu superior." />
      ) : tab === 'orcamentos' ? (
        <TabelaOrcamentos rows={orcFiltrados} total={orcamentos.length} onSelect={setOrcSel} canCreate={canCreate} onCreate={() => setShowNova(true)} />
      ) : tab === 'pedidos' ? (
        <TabelaPedidos rows={pedFiltrados} total={pedidos.length} orcamentos={orcamentos} onSelect={setPedSel} />
      ) : (
        <VisaoGeralKPIs kpis={kpis} />
      )}

      {/* Drawer detalhe orcamento */}
      {orcSel && (
        <DrawerOrcamento
          orc={orcSel}
          itens={orcItens}
          onClose={() => setOrcSel(null)}
          onEnviar={() => enviarOrcamento(orcSel.id)}
          onAprovar={() => aprovarOrcamento(orcSel.id)}
          onConverter={() => converterEmPedido(orcSel.id)}
        />
      )}

      {/* Drawer detalhe pedido */}
      {pedSel && <DrawerPedido ped={pedSel} orcamentos={orcamentos} onClose={() => setPedSel(null)} onFaturado={() => carregar()} />}

      {/* Modal novo orcamento */}
      {showNova && companyIdUnico && (
        <ModalNovoOrcamento
          companyId={companyIdUnico}
          onClose={() => setShowNova(false)}
          onCreated={async (id) => { setShowNova(false); await carregar(); const o = (await supabase.from('erp_orcamentos').select('*').eq('id', id).single()).data as Orcamento | null; if (o) setOrcSel(o) }}
          flash={flash}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// Sub-componentes
// ────────────────────────────────────────────────────────

function TabButton({ ativo, onClick, icon, label, count }: { ativo: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: ativo ? `2px solid ${C.gold}` : '2px solid transparent',
        color: ativo ? C.goldD : C.espressoM, fontWeight: ativo ? 700 : 500, fontSize: 13, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}
    >
      {icon} {label}
      {typeof count === 'number' && (
        <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: ativo ? C.goldBg : C.cream, color: ativo ? C.goldD : C.espressoM, fontWeight: 700 }}>{count}</span>
      )}
    </button>
  )
}

function StatusBadge({ status, mapa }: { status: string; mapa: Record<string, { label: string; bg: string; fg: string }> }) {
  const s = mapa[status] ?? { label: status, bg: C.cream, fg: C.espresso }
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.fg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function EmptyState({ titulo, texto, cta }: { titulo: string; texto: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 48, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden>
        <rect x="14" y="14" width="44" height="52" rx="6" fill={C.goldBg} stroke={C.gold} strokeWidth="2" />
        <line x1="22" y1="28" x2="48" y2="28" stroke={C.gold} strokeWidth="2" strokeLinecap="round" />
        <line x1="22" y1="38" x2="42" y2="38" stroke={C.gold} strokeWidth="2" strokeLinecap="round" />
        <line x1="22" y1="48" x2="46" y2="48" stroke={C.gold} strokeWidth="2" strokeLinecap="round" />
        <circle cx="60" cy="58" r="12" fill={C.gold} />
        <path d="M55 58 l4 4 l7 -7" stroke="#FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.espresso }}>{titulo}</h2>
      <p style={{ margin: 0, fontSize: 13, color: C.espressoM, maxWidth: 440, lineHeight: 1.5 }}>{texto}</p>
      {cta && (
        <button onClick={cta.onClick} style={{ marginTop: 4, padding: '10px 18px', borderRadius: 8, border: 'none', background: C.gold, color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {cta.label}
        </button>
      )}
    </div>
  )
}

function TabelaOrcamentos({ rows, total, onSelect, canCreate, onCreate }: { rows: Orcamento[]; total: number; onSelect: (o: Orcamento) => void; canCreate: boolean; onCreate: () => void }) {
  if (total === 0) {
    return <EmptyState titulo="Nenhum orçamento ainda" texto="Crie seu primeiro orçamento para iniciar o ciclo Order-to-Cash." cta={canCreate ? { label: '+ Novo orçamento', onClick: onCreate } : undefined} />
  }
  if (rows.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhum orçamento corresponde aos filtros.</div>
  }
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
          <thead style={{ background: C.cream }}>
            <tr>
              <Th>Número</Th>
              <Th>Cliente</Th>
              <Th>Emissão</Th>
              <Th>Validade</Th>
              <Th align="right">Total</Th>
              <Th>Status</Th>
              <Th align="right">Views</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} onClick={() => onSelect(o)} style={{ cursor: 'pointer', borderTop: `1px solid ${C.borderL}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Td>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>{o.numero ?? '—'}</div>
                  {(o.versao ?? 0) > 1 && <span style={{ fontSize: 9, color: C.espressoM }}>v{o.versao}</span>}
                </Td>
                <Td>
                  <div style={{ fontWeight: 600 }}>{o.cliente_nome ?? '—'}</div>
                  {o.cliente_cnpj && <div style={{ fontSize: 10, color: C.espressoM }}>{o.cliente_cnpj}</div>}
                </Td>
                <Td>{fmtDate(o.data_emissao)}</Td>
                <Td>{fmtDate(o.data_validade)}</Td>
                <Td align="right"><strong>{fmtBRL(o.total)}</strong></Td>
                <Td><StatusBadge status={o.status} mapa={STATUS_ORC} /></Td>
                <Td align="right"><span style={{ color: C.espressoM }}>{o.qtd_visualizacoes ?? 0}</span></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaPedidos({ rows, total, orcamentos, onSelect }: { rows: Pedido[]; total: number; orcamentos: Orcamento[]; onSelect: (p: Pedido) => void }) {
  const orcMap = useMemo(() => Object.fromEntries(orcamentos.map((o) => [o.id, o])), [orcamentos])
  if (total === 0) {
    return <EmptyState titulo="Nenhum pedido ainda" texto="Pedidos são criados ao converter orçamentos aprovados. Aprovação manual ou via cliente público." />
  }
  if (rows.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhum pedido corresponde aos filtros.</div>
  }
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
          <thead style={{ background: C.cream }}>
            <tr>
              <Th>Número</Th>
              <Th>Cliente</Th>
              <Th>Data pedido</Th>
              <Th>Prev. entrega</Th>
              <Th align="right">Total</Th>
              <Th>Status</Th>
              <Th>NF-e</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const orcOrigem = p.orcamento_origem_id ? orcMap[p.orcamento_origem_id] : null
              return (
                <tr key={p.id} onClick={() => onSelect(p)} style={{ cursor: 'pointer', borderTop: `1px solid ${C.borderL}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Td>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>{p.numero ?? '—'}</div>
                    {orcOrigem && <div style={{ fontSize: 9, color: C.purple }} title="Originado de orçamento">📂 {orcOrigem.numero}</div>}
                  </Td>
                  <Td><div style={{ fontWeight: 600 }}>{p.cliente_nome ?? '—'}</div></Td>
                  <Td>{fmtDate(p.data_pedido)}</Td>
                  <Td>{fmtDate(p.data_prevista_entrega)}</Td>
                  <Td align="right"><strong>{fmtBRL(p.total)}</strong></Td>
                  <Td><StatusBadge status={p.status} mapa={STATUS_PED} /></Td>
                  <Td>{p.nf_emitida && p.nf_numero ? <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{p.nf_numero}</span> : <span style={{ fontSize: 10, color: C.espressoL }}>—</span>}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VisaoGeralKPIs({ kpis }: { kpis: { orcMesQtd: number; orcMesTotal: number; conversao: number; ticketMedio: number; pipelineAberto: number; distribuicaoStatus: Record<string, number> } }) {
  const total = Object.values(kpis.distribuicaoStatus).reduce((s, v) => s + v, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiCard label="Orçamentos no mês" valor={String(kpis.orcMesQtd)} sub={fmtBRL(kpis.orcMesTotal)} />
        <KpiCard label="Taxa de conversão" valor={kpis.conversao.toFixed(1) + '%'} sub="orçamentos → pedidos" accent={kpis.conversao >= 30 ? C.green : C.amber} />
        <KpiCard label="Ticket médio" valor={fmtBRL(kpis.ticketMedio)} sub="orçamentos aprovados" />
        <KpiCard label="Pipeline aberto" valor={fmtBRL(kpis.pipelineAberto)} sub="não convertidos" accent={C.gold} />
      </div>

      <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.espresso }}>Distribuição por status</h3>
        {total === 0 ? (
          <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>Sem orçamentos.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(kpis.distribuicaoStatus).sort((a, b) => b[1] - a[1]).map(([s, qty]) => {
              const cfg = STATUS_ORC[s] ?? { label: s, bg: C.cream, fg: C.espresso }
              const pct = (qty / total) * 100
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                  <span style={{ width: 110, fontWeight: 600, color: cfg.fg }}>{cfg.label}</span>
                  <div style={{ flex: 1, height: 14, background: C.cream, borderRadius: 7, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: cfg.fg }} />
                  </div>
                  <span style={{ width: 80, textAlign: 'right', color: C.espressoM }}>{qty} ({pct.toFixed(0)}%)</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, valor, sub, accent }: { label: string; valor: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: C.espressoL, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent ?? C.espresso, lineHeight: 1.1 }}>{valor}</span>
      {sub && <span style={{ fontSize: 11, color: C.espressoM }}>{sub}</span>}
    </div>
  )
}

function DrawerOrcamento({ orc, itens, onClose, onEnviar, onAprovar, onConverter }: {
  orc: Orcamento; itens: OrcamentoItem[]; onClose: () => void;
  onEnviar: () => void; onAprovar: () => void; onConverter: () => void;
}) {
  const canEnviar = orc.status === 'rascunho'
  const canAprovar = ['enviado', 'visualizado'].includes(orc.status)
  const canConverter = ['aprovado', 'enviado', 'visualizado'].includes(orc.status) && !orc.pedido_id

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', height: '100%', background: C.offWhite, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Orçamento</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{orc.numero ?? '—'}</h2>
              <StatusBadge status={orc.status} mapa={STATUS_ORC} />
              {(orc.versao ?? 0) > 1 && <span style={{ fontSize: 11, color: C.espressoM }}>v{orc.versao}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}>
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Cliente + datas */}
          <Card titulo="Cliente & Datas">
            <Row label="Cliente" value={orc.cliente_nome || '—'} />
            {orc.cliente_cnpj && <Row label="CNPJ/CPF" value={orc.cliente_cnpj} />}
            {orc.cliente_email && <Row label="Email" value={orc.cliente_email ?? '—'} />}
            <Row label="Vendedor" value={orc.vendedor_nome ?? '—'} />
            <Row label="Emissão" value={fmtDate(orc.data_emissao)} />
            <Row label="Validade" value={fmtDate(orc.data_validade)} />
            {orc.data_aprovacao && <Row label="Aprovado em" value={fmtDate(orc.data_aprovacao)} />}
          </Card>

          {/* Itens */}
          <Card titulo={`Itens · ${itens.length}`}>
            {itens.length === 0 ? (
              <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Sem itens.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Produto</Th><Th align="right">Qtd</Th><Th align="right">Preço un.</Th><Th align="right">Subtotal</Th></tr></thead>
                <tbody>
                  {itens.map((it) => (
                    <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                      <Td><div>{it.produto_nome}</div>{it.produto_codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace' }}>{it.produto_codigo}</span>}</Td>
                      <Td align="right">{it.quantidade} {it.unidade}</Td>
                      <Td align="right">{fmtBRL(it.preco_unitario)}</Td>
                      <Td align="right"><strong>{fmtBRL(it.subtotal)}</strong></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Totais */}
          <Card titulo="Totais">
            <Row label="Subtotal" value={fmtBRL(orc.subtotal)} />
            {Number(orc.desconto_valor ?? 0) > 0 && <Row label="Desconto" value={'- ' + fmtBRL(orc.desconto_valor)} />}
            {Number(orc.acrescimo_valor ?? 0) > 0 && <Row label="Acréscimo" value={'+ ' + fmtBRL(orc.acrescimo_valor)} />}
            {Number(orc.frete_valor ?? 0) > 0 && <Row label="Frete" value={fmtBRL(orc.frete_valor)} />}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <strong>Total</strong>
              <strong style={{ color: C.gold }}>{fmtBRL(orc.total)}</strong>
            </div>
          </Card>

          {orc.observacoes && (
            <Card titulo="Observações ao cliente">
              <p style={{ fontSize: 12, color: C.espresso, whiteSpace: 'pre-wrap', margin: 0 }}>{orc.observacoes}</p>
            </Card>
          )}

          {/* Açoes */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            {canEnviar && (
              <button onClick={onEnviar} style={btnSec}><Send size={14} /> Marcar enviado</button>
            )}
            {canAprovar && (
              <button onClick={onAprovar} style={{ ...btnPri, background: C.green }}><CheckCircle2 size={14} /> Aprovar</button>
            )}
            {canConverter && (
              <button onClick={onConverter} style={btnPri}><ArrowRight size={14} /> Converter em Pedido</button>
            )}
            {orc.pedido_id && (
              <span style={{ fontSize: 11, color: C.purple, fontWeight: 600, alignSelf: 'center' }}>✓ Já convertido em pedido</span>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function DrawerPedido({ ped, orcamentos, onClose, onFaturado }: { ped: Pedido; orcamentos: Orcamento[]; onClose: () => void; onFaturado?: () => void | Promise<void> }) {
  const [itens, setItens] = useState<{ id: string; produto_nome: string; produto_codigo: string | null; unidade: string | null; quantidade: number | null; preco_unitario: number | null; subtotal: number | null }[]>([])
  const orcOrigem = ped.orcamento_origem_id ? orcamentos.find((o) => o.id === ped.orcamento_origem_id) : null
  // FEAT-OS-ONDA3A-FATURAMENTO-v1 · status local pra refletir faturamento sem reload
  const [statusLocal, setStatusLocal] = useState(ped.status)
  const [faturando, setFaturando] = useState(false)
  const [faturaResult, setFaturaResult] = useState<{ ok: boolean; cmv?: number; qtd_movimentos_estoque?: number; qtd_titulos_receber?: number; numero?: string | null; erro?: string } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_pedidos_itens').select('id,produto_nome,produto_codigo,unidade,quantidade,preco_unitario,subtotal').eq('pedido_id', ped.id).order('ordem', { ascending: true, nullsFirst: true })
      if (alive) setItens(data ?? [])
    })()
    return () => { alive = false }
  }, [ped.id])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', height: '100%', background: C.offWhite, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Pedido</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{ped.numero ?? '—'}</h2>
              <StatusBadge status={statusLocal} mapa={STATUS_PED} />
            </div>
            {orcOrigem && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: C.purple }}>📂 Originado do orçamento <strong>{orcOrigem.numero}</strong></p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}><X size={16} /></button>
        </header>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card titulo="Cliente & Datas">
            <Row label="Cliente" value={ped.cliente_nome || '—'} />
            <Row label="Vendedor" value={ped.vendedor_nome ?? '—'} />
            <Row label="Data pedido" value={fmtDate(ped.data_pedido)} />
            <Row label="Previsão entrega" value={fmtDate(ped.data_prevista_entrega)} />
            {ped.data_faturamento && <Row label="Faturado em" value={fmtDate(ped.data_faturamento)} />}
            {ped.transportadora && <Row label="Transportadora" value={ped.transportadora} />}
          </Card>

          <Card titulo={`Itens · ${itens.length}`}>
            {itens.length === 0 ? (
              <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Sem itens.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Produto</Th><Th align="right">Qtd</Th><Th align="right">Preço un.</Th><Th align="right">Subtotal</Th></tr></thead>
                <tbody>
                  {itens.map((it) => (
                    <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                      <Td><div>{it.produto_nome}</div>{it.produto_codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace' }}>{it.produto_codigo}</span>}</Td>
                      <Td align="right">{it.quantidade} {it.unidade}</Td>
                      <Td align="right">{fmtBRL(it.preco_unitario)}</Td>
                      <Td align="right"><strong>{fmtBRL(it.subtotal)}</strong></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card titulo="Totais">
            <Row label="Subtotal" value={fmtBRL(ped.subtotal)} />
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <strong>Total</strong>
              <strong style={{ color: C.gold }}>{fmtBRL(ped.total)}</strong>
            </div>
          </Card>

          <Card titulo="Parcelas">
            <ParcelasEditor pedidoId={ped.id} total={Number(ped.total ?? 0)} />
          </Card>

          <Card titulo="Faturamento">
            {/* FEAT-OS-ONDA3A-FATURAMENTO-v1 */}
            {statusLocal === 'faturado' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>✓ Pedido FATURADO</p>
                {faturaResult?.ok && (
                  <div style={{ fontSize: 12, color: C.espresso, lineHeight: 1.5 }}>
                    CRIOU <strong>{faturaResult.qtd_titulos_receber}</strong> título(s) a receber<br />
                    BAIXOU <strong>{faturaResult.qtd_movimentos_estoque}</strong> item(ns) do estoque<br />
                    CMV: <strong>{fmtBRL(faturaResult.cmv)}</strong>
                  </div>
                )}
              </div>
            ) : statusLocal === 'cancelado' ? (
              <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>Pedido cancelado · não pode ser faturado.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>
                  Gere os títulos a receber + baixa de estoque (produtos + BOM dos serviços) em 1 clique.
                </p>
                {faturaResult?.erro && (
                  <p style={{ fontSize: 12, color: C.red, margin: 0 }}>❌ {faturaResult.erro}</p>
                )}
                <button
                  type="button"
                  disabled={faturando}
                  onClick={async () => {
                    if (!confirm('Vai gerar os recebíveis e baixar o estoque. Confirma?')) return
                    setFaturando(true)
                    setFaturaResult(null)
                    const { data, error } = await supabase.rpc('fn_faturar', { p_pedido_id: ped.id })
                    setFaturando(false)
                    if (error) {
                      setFaturaResult({ ok: false, erro: error.message })
                      return
                    }
                    const r = data as { ok: boolean; cmv?: number; qtd_movimentos_estoque?: number; qtd_titulos_receber?: number; numero?: string | null }
                    setFaturaResult(r)
                    if (r?.ok) {
                      setStatusLocal('faturado')
                      await onFaturado?.()
                    }
                  }}
                  data-testid="pedido-faturar"
                  style={{
                    minHeight: 44, padding: '10px 16px', borderRadius: 8,
                    border: 'none', background: faturando ? C.cream : C.gold,
                    color: faturando ? C.espressoL : '#fff',
                    fontSize: 13, fontWeight: 700,
                    cursor: faturando ? 'not-allowed' : 'pointer',
                  }}
                >
                  {faturando ? 'Faturando…' : '💰 Faturar pedido'}
                </button>
                <hr style={{ border: 'none', borderTop: `1px solid ${C.borderL}`, margin: '4px 0' }} />
                <p style={{ fontSize: 11, color: C.espressoL, margin: 0 }}>NF-e fica pra próxima onda.</p>
                <button
                  type="button"
                  disabled
                  title="Em desenvolvimento (Onda 3c)"
                  style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.cream, color: C.espressoL, fontSize: 12, fontWeight: 600, cursor: 'not-allowed', alignSelf: 'flex-start' }}
                >
                  Emitir NF-e (em breve)
                </button>
              </div>
            )}
          </Card>
        </div>
      </aside>
    </div>
  )
}

function ModalNovoOrcamento({ companyId, onClose, onCreated, flash }: {
  companyId: string; onClose: () => void; onCreated: (id: string) => void; flash: (m: string) => void;
}) {
  const [step, setStep] = useState<'cliente' | 'itens'>('cliente')
  const [clienteBusca, setClienteBusca] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null)
  const [searchingClientes, setSearchingClientes] = useState(false)
  // FEAT-OS-ONDA1B-EDITOR-NO-OTC-v1 · itens polimorficos via shared editor
  const [itens, setItens] = useState<EditorItem[]>([])
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Busca clientes (debounced)
  useEffect(() => {
    if (clienteBusca.trim().length < 2) {
      setClientes([])
      return
    }
    const handle = setTimeout(async () => {
      setSearchingClientes(true)
      const { data } = await supabase
        .from('erp_clientes')
        .select('id,nome_fantasia,razao_social,cnpj_cpf,email,telefone')
        .eq('company_id', companyId)
        .or(`nome_fantasia.ilike.%${clienteBusca}%,razao_social.ilike.%${clienteBusca}%,cnpj_cpf.ilike.%${clienteBusca}%`)
        .limit(10)
      setClientes((data ?? []) as Cliente[])
      setSearchingClientes(false)
    }, 280)
    return () => clearTimeout(handle)
  }, [clienteBusca, companyId])

  const subtotal = itens.reduce((s, i) => s + (i.subtotal || 0), 0)

  async function criar() {
    if (!clienteSel) return
    setSalvando(true)
    const numero = `ORC-${Date.now().toString().slice(-6)}`
    const validade = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: orc, error } = await supabase
      .from('erp_orcamentos')
      .insert({
        company_id: companyId,
        numero,
        versao: 1,
        cliente_id: clienteSel.id,
        cliente_nome: clienteSel.nome_fantasia || clienteSel.razao_social,
        cliente_cnpj: clienteSel.cnpj_cpf,
        cliente_email: clienteSel.email,
        cliente_telefone: clienteSel.telefone,
        data_emissao: new Date().toISOString().slice(0, 10),
        data_validade: validade,
        status: 'rascunho',
        subtotal,
        total: subtotal,
        observacoes: observacoes || null,
        created_by: user?.id,
      })
      .select()
      .single()
    if (error || !orc) {
      flash('Erro ao criar: ' + (error?.message ?? 'desconhecido'))
      setSalvando(false)
      return
    }
    // Inserir itens polimorficos · usa IDs reais do autocomplete
    const validos = itens.filter((i) =>
      i.quantidade > 0 && (i.tipo_item === 'servico' ? !!i.servico_id : !!i.produto_id)
    )
    if (validos.length > 0) {
      await supabase.from('erp_orcamentos_itens').insert(validos.map((it, idx) => ({
        orcamento_id: orc.id,
        company_id: companyId,
        ordem: idx + 1,
        tipo_item: it.tipo_item,
        produto_id: it.tipo_item === 'produto' ? it.produto_id : null,
        produto_codigo: it.tipo_item === 'produto' ? it.produto_codigo : null,
        produto_nome: it.tipo_item === 'produto' ? it.produto_nome : null,
        produto_descricao: it.tipo_item === 'produto' ? it.produto_descricao : null,
        servico_id: it.tipo_item === 'servico' ? it.servico_id : null,
        servico_codigo: it.tipo_item === 'servico' ? it.servico_codigo : null,
        servico_descricao: it.tipo_item === 'servico' ? it.servico_descricao : null,
        unidade: it.unidade,
        quantidade: it.quantidade,
        preco_unitario: it.preco_unitario,
        preco_custo: it.preco_custo ?? null,
        subtotal: it.subtotal,
      })))
    }
    // Historico
    await supabase.from('erp_orcamento_historico').insert({
      orcamento_id: orc.id, company_id: companyId,
      evento: 'criado', detalhe: 'Orcamento criado via UI OTC', usuario_id: user?.id,
    })
    flash(`Orçamento ${numero} criado!`)
    setSalvando(false)
    onCreated(orc.id)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${C.border}`, boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.espresso }}>Novo orçamento</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>

        {/* Steps indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, fontSize: 11 }}>
          <span style={{ padding: '4px 10px', borderRadius: 999, background: step === 'cliente' ? C.gold : C.cream, color: step === 'cliente' ? '#FFF' : C.espressoM, fontWeight: 600 }}>1. Cliente</span>
          <span style={{ padding: '4px 10px', borderRadius: 999, background: step === 'itens' ? C.gold : C.cream, color: step === 'itens' ? '#FFF' : C.espressoM, fontWeight: 600 }}>2. Itens & confirmação</span>
        </div>

        {step === 'cliente' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.espressoM }}>Buscar cliente *</label>
            <input
              autoFocus
              value={clienteBusca}
              onChange={(e) => setClienteBusca(e.target.value)}
              placeholder="Nome, razão social ou CNPJ"
              style={inp}
            />
            {searchingClientes && <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>Buscando…</p>}
            {clientes.length > 0 && (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
                {clientes.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setClienteSel(c); setStep('itens') }}
                    style={{ width: '100%', textAlign: 'left', padding: 12, border: 'none', borderBottom: `1px solid ${C.borderL}`, background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.nome_fantasia || c.razao_social}</span>
                    <span style={{ fontSize: 11, color: C.espressoM }}>{c.cnpj_cpf || '—'} {c.email ? `· ${c.email}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
            {clienteBusca.trim().length >= 2 && !searchingClientes && clientes.length === 0 && (
              <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>Nenhum cliente encontrado. Verifique o termo de busca.</p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 10, background: C.goldBg, borderRadius: 8, border: `1px solid ${C.gold}55`, fontSize: 12 }}>
              Cliente: <strong>{clienteSel?.nome_fantasia || clienteSel?.razao_social}</strong>
              <button onClick={() => setStep('cliente')} style={{ marginLeft: 8, padding: '2px 8px', fontSize: 10, border: `1px solid ${C.gold}`, borderRadius: 4, background: 'transparent', color: C.goldD, cursor: 'pointer' }}>Trocar</button>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: C.espressoM }}>Itens</label>
            <OrcamentoItensEditor companyId={companyId} itens={itens} onChange={setItens} />

            <label style={{ fontSize: 12, fontWeight: 600, color: C.espressoM, marginTop: 8 }}>Observações ao cliente</label>
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} placeholder="Opcional — texto que aparece no orçamento" style={{ ...inp, resize: 'vertical' }} />

            <div style={{ marginTop: 8, padding: 12, background: C.cream, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 13 }}>Total estimado</strong>
              <strong style={{ fontSize: 16, color: C.gold }}>{fmtBRL(subtotal)}</strong>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={onClose} style={btnSec}>Cancelar</button>
              <button onClick={criar} disabled={salvando || subtotal <= 0} style={{ ...btnPri, opacity: salvando || subtotal <= 0 ? 0.6 : 1 }}>
                {salvando ? 'Salvando…' : 'Criar orçamento'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// Helpers visuais
// ────────────────────────────────────────────────────────
function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ padding: '10px 14px', textAlign: align, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoM }}>{children}</th>
}
function Td({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle', color: C.espresso }}>{children}</td>
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

const inp: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.espresso, background: C.white, outline: 'none', width: '100%',
}
const btnPri: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: C.gold, color: '#FFF', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
}
const btnSec: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.espresso, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
}
