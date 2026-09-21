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

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import {
  Plus, Search, ShoppingCart, BarChart3,
  X, Info, Send, CheckCircle2, ArrowRight,
  AlertTriangle,
  Columns3, Lock,
} from 'lucide-react'
import OrcamentoItensEditor, { type EditorItem } from '@/components/comum/OrcamentoItensEditor'
import BlocoObraFiscal, { type ObraFiscalState, obraFiscalStateInicial, resolverObraFiscal } from '@/components/comum/BlocoObraFiscal'
import ParcelasEditor from '@/components/comum/ParcelasEditor'
import NFSeEmitirGovModal from '@/components/fiscal/NFSeEmitirGovModal'
import { carregarProducaoDisponivel } from '@/lib/fiscal/producaoDisponivel'
import OrdemServicoCard from '@/components/comum/OrdemServicoCard'
import NFeCard from '@/components/comum/NFeCard'

// FEAT-OS-ONDA3B-NFSE-FRONT-v1 · tipos do retorno de fn_pedido_nfse_dados
type NfsePedidoTomador = {
  documento?: string | null
  tipo?: 'cpf' | 'cnpj' | 'indefinido' | null
  nome?: string | null
  email?: string | null
}
type NfsePedidoServico = {
  servico_id?: string | null
  descricao?: string | null
  codigo_servico_municipio?: string | null
  codigo_lc116?: string | null
  aliquota_iss?: number | null
  iss_retido?: boolean | null
  cnae?: string | null
  valor?: number | null
}
type NfsePedidoExistente = {
  id: string
  numero: string | null
  status: string
  pdf_url: string | null
}
type NfsePedidoDados = {
  pedido_id?: string
  pedido_numero?: string | null
  status?: string
  tem_servico: boolean
  valor_servicos?: number | null
  tomador?: NfsePedidoTomador
  servicos: NfsePedidoServico[]
  ja_emitida: boolean
  nfse_existente: NfsePedidoExistente | null
  erro?: string
}

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

type Tab = 'orcamentos' | 'pedidos' | 'kanban' | 'visao'

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
  const searchParams = useSearchParams()
  const { companyIds, selInfo, loading: companiesLoading, sel } = useCompanyIds()
  const companyIdUnico = selInfo.tipo === 'empresa' && sel ? sel : null
  const canCreate = !!companyIdUnico

  // #90 · abas Orçamentos/Pedidos removidas — só Kanban e Visão geral. Normaliza links antigos.
  const rawTab = (searchParams?.get('tab') as Tab) || 'kanban'
  const initialTab: Tab = rawTab === 'visao' ? 'visao' : 'kanban'
  const [tab, setTab] = useState<Tab>(initialTab)

  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [erro, setErro] = useState<string>('')

  const [orcSel, setOrcSel] = useState<Orcamento | null>(null)
  const [orcItens, setOrcItens] = useState<OrcamentoItem[]>([])
  const [pedSel, setPedSel] = useState<Pedido | null>(null)
  const [showNova, setShowNova] = useState(false)
  // ⑨ #90 · confirmação ao arrastar Orçamento → Pedido no Kanban (cria documento fiscal → nunca direto)
  const [confirmConv, setConfirmConv] = useState<Orcamento | null>(null)
  const [convertendo, setConvertendo] = useState(false)
  // #90 · arrastar para Faturado: faturar (pedido) ou converter+faturar (orçamento), com confirmação.
  const [confirmFatura, setConfirmFatura] = useState<{ tipo: 'orcamento'; orc: Orcamento } | { tipo: 'pedido'; ped: Pedido } | null>(null)
  const [faturandoKanban, setFaturandoKanban] = useState(false)

  // FIX-VAZAMENTO-JORDANA (07/07 · defesa em profundidade sobre #541):
  //   1) Gate estrito em companyIdUnico (nunca .in(companyIds))
  //   2) Race guard (alive flag) — troca de empresa cancela write anterior,
  //      impede "flash" de dados stale quando resposta antiga chega depois
  //   3) Assertion runtime — se qualquer linha vier com company_id != esperado
  //      (bug de schema / RPC futuro / RLS mal configurado), dropa antes do
  //      setState. Nunca renderiza tenant errado, mesmo diante de falha DB.
  //   4) recarregar() exposto pra callbacks (post-create, post-fatura)
  //      atraves de ref pra nao criar dependencia estatica.
  const recarregarRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (companiesLoading) return
    let alive = true
    const expected = companyIdUnico
    const run = async () => {
      if (!expected) {
        setOrcamentos([])
        setPedidos([])
        return
      }
      setLoading(true)
      setErro('')
      const [orc, ped] = await Promise.all([
        supabase.from('erp_orcamentos').select('*').eq('company_id', expected).order('created_at', { ascending: false }).limit(200),
        supabase.from('erp_pedidos').select('*').eq('company_id', expected).order('created_at', { ascending: false }).limit(200),
      ])
      if (!alive) return
      // Runtime guard: descarta qualquer linha com company_id divergente
      // (defense-in-depth contra falha em .eq / RPC / RLS).
      const orcSafe = ((orc.data ?? []) as Orcamento[]).filter((o) => o.company_id === expected)
      const pedSafe = ((ped.data ?? []) as Pedido[]).filter((p) => p.company_id === expected)
      if (orc.error) setErro('Falha ao carregar orcamentos: ' + orc.error.message)
      else setOrcamentos(orcSafe)
      if (ped.error) setErro('Falha ao carregar pedidos: ' + ped.error.message)
      else setPedidos(pedSafe)
      setLoading(false)
    }
    recarregarRef.current = () => { void run() }
    void run()
    return () => { alive = false }
  }, [companyIdUnico, companiesLoading])
  const carregar = useCallback(() => recarregarRef.current(), [])

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
    // #90 · abas removidas — abre o pedido recém-criado no drawer (não troca de aba).
    const { data: ped } = await supabase.from('erp_pedidos').select('*').eq('id', pedidoId).single()
    if (ped) setPedSel(ped as Pedido)
  }

  // #90 · arrastar para Faturado. Orçamento: converte e fatura (dois passos, na ordem). Pedido: fatura.
  async function executarFaturaKanban() {
    if (!confirmFatura) return
    setFaturandoKanban(true)
    try {
      let pedidoId: string
      if (confirmFatura.tipo === 'orcamento') {
        const { data, error } = await supabase.rpc('fn_converter_orcamento_em_pedido', { p_orcamento_id: confirmFatura.orc.id })
        if (error) throw new Error(error.message)
        pedidoId = data as string
      } else {
        pedidoId = confirmFatura.ped.id
      }
      const { data: fat, error: errFat } = await supabase.rpc('fn_faturar', { p_pedido_id: pedidoId })
      if (errFat) throw new Error(errFat.message)
      const r = fat as { ok?: boolean; erro?: string } | null
      if (r && r.ok === false) throw new Error(r.erro ?? 'Falha ao faturar')
      flash(confirmFatura.tipo === 'orcamento' ? 'Orçamento convertido e faturado!' : 'Pedido faturado!')
      setConfirmFatura(null)
      await carregar()
    } catch (e) {
      flash('Erro ao faturar: ' + (e instanceof Error ? e.message : 'falha'))
    } finally {
      setFaturandoKanban(false)
    }
  }

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
        {tab === 'kanban' && (
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

      {/* Tabs — #90: só Kanban e Visão geral (Orçamentos/Pedidos viraram colunas do Kanban) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>
        <TabButton ativo={tab === 'kanban'} onClick={() => setTab('kanban')} icon={<Columns3 size={14} />} label="Kanban" />
        <TabButton ativo={tab === 'visao'} onClick={() => setTab('visao')} icon={<BarChart3 size={14} />} label="Visão geral" />
      </div>

      {/* FIX-VAZAMENTO-JORDANA (07/07): telas operacionais NAO consolidam
          multi-empresa. Se consolidado/grupo, mostra apenas prompt. */}
      {selInfo.tipo !== 'empresa' && companyIds.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, color: C.amber, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={14} />
          <span>Selecione uma empresa específica no menu superior. OTC é operacional por empresa — não exibe dados consolidados.</span>
        </div>
      )}

      {/* Toast / erro */}
      {msg && <div onClick={() => setMsg('')} style={{ marginBottom: 12, padding: '10px 14px', background: C.greenBg, border: `1px solid ${C.green}55`, borderRadius: 8, color: C.green, fontSize: 12, cursor: 'pointer' }}>{msg}</div>}
      {erro && <div style={{ marginBottom: 12, padding: '10px 14px', background: C.redBg, border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 12 }}>{erro}</div>}

      {/* Conteúdo */}
      {companiesLoading || loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Carregando…</div>
      ) : companyIds.length === 0 ? (
        <EmptyState titulo="Nenhuma empresa disponível" texto="Você ainda não tem empresas vinculadas. Peça ao administrador para te vincular ou selecione uma no menu superior." />
      ) : !companyIdUnico ? (
        <EmptyState titulo="Selecione uma empresa" texto="OTC é operacional por empresa. Escolha uma empresa específica no menu superior para ver orçamentos e pedidos." />
      ) : tab === 'visao' ? (
        <VisaoGeralKPIs kpis={kpis} />
      ) : (
        <KanbanBoard
          orcamentos={orcamentos}
          pedidos={pedidos}
          onAbrirOrc={setOrcSel}
          onAbrirPed={setPedSel}
          onSoltarEmPedido={(o) => setConfirmConv(o)}
          onFaturarOrc={(o) => setConfirmFatura({ tipo: 'orcamento', orc: o })}
          onFaturarPed={(p) => setConfirmFatura({ tipo: 'pedido', ped: p })}
        />
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

      {/* ⑨ #90 · confirmação Kanban: arrastar Orçamento → Pedido cria documento fiscal */}
      {confirmConv && (
        <ConfirmConverterModal
          orc={confirmConv}
          loading={convertendo}
          onCancel={() => { if (!convertendo) setConfirmConv(null) }}
          onConfirm={async () => {
            setConvertendo(true)
            await converterEmPedido(confirmConv.id)
            setConvertendo(false)
            setConfirmConv(null)
          }}
        />
      )}

      {/* #90 · confirmação Kanban: arrastar para Faturado (fatura; converte antes se for orçamento) */}
      {confirmFatura && (
        <ConfirmFaturarModal
          info={confirmFatura}
          loading={faturandoKanban}
          onCancel={() => { if (!faturandoKanban) setConfirmFatura(null) }}
          onConfirm={() => { void executarFaturaKanban() }}
        />
      )}

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

const DND_MIME = 'application/x-otc-card'

// ⑨ #90 · Kanban "Vender e Faturar". DnD robusto (preventDefault SEMPRE no dragover — habilitar o
// drop nunca depende de estado React defasado). Orçamento arrasta p/ Pedido (converter) ou p/
// Faturado (converter+faturar). Pedido arrasta p/ Faturado (faturar). Tudo com confirmação.
function KanbanBoard({
  orcamentos, pedidos, onAbrirOrc, onAbrirPed, onSoltarEmPedido, onFaturarOrc, onFaturarPed,
}: {
  orcamentos: Orcamento[]
  pedidos: Pedido[]
  onAbrirOrc: (o: Orcamento) => void
  onAbrirPed: (p: Pedido) => void
  onSoltarEmPedido: (o: Orcamento) => void
  onFaturarOrc: (o: Orcamento) => void
  onFaturarPed: (p: Pedido) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<'orc' | 'ped' | null>(null)
  const [dropCol, setDropCol] = useState<'ped' | 'fat' | null>(null)
  const [busca, setBusca] = useState('')
  const q = busca.trim().toLowerCase()

  // Busca migrada da aba removida (nada se perde): filtra por número ou cliente.
  const colOrc = useMemo(
    () => orcamentos.filter((o) => !o.pedido_id && ['rascunho', 'enviado', 'visualizado', 'aprovado'].includes(o.status)
      && (!q || (o.numero ?? '').toLowerCase().includes(q) || (o.cliente_nome ?? '').toLowerCase().includes(q))),
    [orcamentos, q],
  )
  const colPed = useMemo(
    () => pedidos.filter((p) => p.status !== 'faturado' && p.status !== 'cancelado' && !p.nf_emitida
      && (!q || (p.numero ?? '').toLowerCase().includes(q) || (p.cliente_nome ?? '').toLowerCase().includes(q))),
    [pedidos, q],
  )
  const colFat = useMemo(
    () => pedidos.filter((p) => (p.status === 'faturado' || p.nf_emitida)
      && (!q || (p.numero ?? '').toLowerCase().includes(q) || (p.cliente_nome ?? '').toLowerCase().includes(q))),
    [pedidos, q],
  )

  function iniciarDrag(e: React.DragEvent, id: string, kind: 'orc' | 'ped') {
    setDragId(id); setDragKind(kind)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData(DND_MIME, `${kind}:${id}`) } catch { /* alguns browsers travam custom mime */ }
    e.dataTransfer.setData('text/plain', id)
  }
  function fimDrag() { setDragId(null); setDragKind(null); setDropCol(null) }
  // preventDefault SEMPRE (o alvo aceita o drop). Decidir o que fazer fica no onDrop.
  function permitirDrop(e: React.DragEvent, col: 'ped' | 'fat') {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    if (dropCol !== col) setDropCol(col)
  }

  const cardOrc = (o: Orcamento) => (
    <div key={o.id} draggable onDragStart={(e) => iniciarDrag(e, o.id, 'orc')} onDragEnd={fimDrag} onClick={() => onAbrirOrc(o)}
      style={{ cursor: 'grab', opacity: dragId === o.id ? 0.5 : 1, background: C.white, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}
      title="Arraste para Pedido (converter) ou Faturado (converter e faturar); clique para abrir">
      <KanbanCardTopo numero={o.numero} status={o.status} mapa={STATUS_ORC} />
      <div style={{ fontWeight: 600, fontSize: 12 }}>{o.cliente_nome ?? '—'}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: C.espressoM }}>
        <span>{fmtDate(o.data_validade) !== '—' ? `val. ${fmtDate(o.data_validade)}` : fmtDate(o.data_emissao)}</span>
        <strong style={{ color: C.gold }}>{fmtBRL(o.total)}</strong>
      </div>
    </div>
  )
  const cardPed = (p: Pedido) => (
    <div key={p.id} draggable onDragStart={(e) => iniciarDrag(e, p.id, 'ped')} onDragEnd={fimDrag} onClick={() => onAbrirPed(p)}
      style={{ cursor: 'grab', opacity: dragId === p.id ? 0.5 : 1, background: C.white, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}
      title="Arraste para Faturado para faturar, ou clique para abrir">
      <KanbanCardTopo numero={p.numero} status={p.status} mapa={STATUS_PED} />
      <div style={{ fontWeight: 600, fontSize: 12 }}>{p.cliente_nome ?? '—'}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: C.espressoM }}>
        <span>{fmtDate(p.data_pedido)}</span>
        <strong style={{ color: C.blue }}>{fmtBRL(p.total)}</strong>
      </div>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }} />
          <input type="text" placeholder="Buscar por número ou cliente…" value={busca} onChange={(e) => setBusca(e.target.value)}
            style={{ width: '100%', padding: '8px 10px 8px 32px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.white, color: C.espresso, outline: 'none' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: C.espressoM }}>
        <Info size={13} />
        <span>Arraste um <strong>orçamento</strong> para <strong>Pedido</strong> (converter) ou direto para <strong>Faturado</strong> (converter e faturar). Arraste um <strong>pedido</strong> para <strong>Faturado</strong> para faturar. Cada passo pede confirmação.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'start' }}>
        {/* ── Orçamento (arrastável) ── */}
        <KanbanColuna titulo="Orçamento" cor={C.gold} corBg={C.goldBg} qtd={colOrc.length} total={colOrc.reduce((s, o) => s + (Number(o.total) || 0), 0)}>
          {colOrc.length === 0 ? <KanbanVazio texto="Nenhum orçamento em aberto." /> : colOrc.map(cardOrc)}
        </KanbanColuna>

        {/* ── Pedido (drop-target: converter) ── */}
        <div
          onDragOver={(e) => { if (dragKind === 'orc') permitirDrop(e, 'ped') }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol((c) => (c === 'ped' ? null : c)) }}
          onDrop={(e) => {
            e.preventDefault()
            const orc = dragKind === 'orc' && dragId ? colOrc.find((o) => o.id === dragId) ?? null : null
            fimDrag()
            if (orc) onSoltarEmPedido(orc)
          }}
          style={{ borderRadius: 12, outline: dropCol === 'ped' ? `2px dashed ${C.blue}` : '2px dashed transparent', outlineOffset: 2, transition: 'outline-color .12s' }}
        >
          <KanbanColuna titulo="Pedido" cor={C.blue} corBg={C.blueBg} qtd={colPed.length} total={colPed.reduce((s, p) => s + (Number(p.total) || 0), 0)}>
            {dropCol === 'ped' && (
              <div style={{ border: `2px dashed ${C.blue}`, borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 11, color: C.blue, background: C.blueBg, fontWeight: 600 }}>
                Soltar para converter em pedido
              </div>
            )}
            {colPed.length === 0 && dropCol !== 'ped' ? <KanbanVazio texto="Nenhum pedido em aberto. Arraste um orçamento para cá." /> : colPed.map(cardPed)}
          </KanbanColuna>
        </div>

        {/* ── Faturado (drop-target: faturar) ── */}
        <div
          onDragOver={(e) => permitirDrop(e, 'fat')}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol((c) => (c === 'fat' ? null : c)) }}
          onDrop={(e) => {
            e.preventDefault()
            const orc = dragKind === 'orc' && dragId ? colOrc.find((o) => o.id === dragId) ?? null : null
            const ped = dragKind === 'ped' && dragId ? colPed.find((p) => p.id === dragId) ?? null : null
            fimDrag()
            if (orc) onFaturarOrc(orc)
            else if (ped) onFaturarPed(ped)
          }}
          style={{ borderRadius: 12, outline: dropCol === 'fat' ? `2px dashed ${C.purple}` : '2px dashed transparent', outlineOffset: 2, transition: 'outline-color .12s' }}
        >
          <KanbanColuna titulo="Faturado" cor={C.purple} corBg={C.purpleBg} qtd={colFat.length} total={colFat.reduce((s, p) => s + (Number(p.total) || 0), 0)}>
            {dropCol === 'fat' && (
              <div style={{ border: `2px dashed ${C.purple}`, borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 11, color: C.purple, background: C.purpleBg, fontWeight: 600 }}>
                Soltar para faturar
              </div>
            )}
            {colFat.length === 0 && dropCol !== 'fat' ? <KanbanVazio texto="Nada faturado ainda. Arraste um pedido (ou orçamento) para cá." /> : colFat.map((p) => (
              <div key={p.id} onClick={() => onAbrirPed(p)}
                style={{ cursor: 'pointer', background: C.white, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.purple}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <KanbanCardTopo numero={p.numero} status={p.status} mapa={STATUS_PED} />
                <div style={{ fontWeight: 600, fontSize: 12 }}>{p.cliente_nome ?? '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: C.espressoM }}>
                  <span>{p.nf_numero ? <span style={{ color: C.green, fontWeight: 600 }}>NF {p.nf_numero}</span> : fmtDate(p.data_faturamento)}</span>
                  <strong style={{ color: C.purple }}>{fmtBRL(p.total)}</strong>
                </div>
              </div>
            ))}
          </KanbanColuna>
        </div>
      </div>
    </div>
  )
}

function KanbanColuna({ titulo, cor, corBg, qtd, total, soLeitura, children }: {
  titulo: string; cor: string; corBg: string; qtd: number; total: number; soLeitura?: boolean; children: React.ReactNode
}) {
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, minHeight: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: cor }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.espresso }}>{titulo}</span>
          <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: corBg, color: cor, fontWeight: 700 }}>{qtd}</span>
          {soLeitura && <span title="Somente leitura — emissão de nota é feita no pedido"><Lock size={11} style={{ color: C.espressoL }} /></span>}
        </div>
        <span style={{ fontSize: 10, color: C.espressoM }}>{fmtBRL(total)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function KanbanCardTopo({ numero, status, mapa }: { numero: string | null; status: string; mapa: Record<string, { label: string; bg: string; fg: string }> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: C.espressoM }}>{numero ?? '—'}</span>
      <StatusBadge status={status} mapa={mapa} />
    </div>
  )
}

function KanbanVazio({ texto }: { texto: string }) {
  return <div style={{ fontSize: 11, color: C.espressoL, fontStyle: 'italic', padding: '10px 4px', textAlign: 'center' }}>{texto}</div>
}

function ConfirmConverterModal({ orc, loading, onCancel, onConfirm }: {
  orc: Orcamento; loading: boolean; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ArrowRight size={18} style={{ color: C.blue }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Converter orçamento em pedido?</h3>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: C.espresso }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            O orçamento <strong style={{ fontFamily: 'monospace' }}>{orc.numero ?? '—'}</strong> de <strong>{orc.cliente_nome ?? '—'}</strong> ({fmtBRL(orc.total)}) vai gerar um <strong>pedido</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: 10, fontSize: 12, color: C.amber }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Esta ação cria um documento e não é desfeita por arrastar de volta. Confirme para prosseguir.</span>
          </div>
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={loading} style={{ ...btnSec, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>Cancelar</button>
          <button onClick={onConfirm} disabled={loading} style={{ ...btnPri, background: C.blue, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            <ArrowRight size={14} /> {loading ? 'Convertendo…' : 'Converter em pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}

// #90 · confirmação ao arrastar para Faturado. Orçamento → "converter em pedido e faturar?"
// (dois passos, na ordem). Pedido → "faturar pedido?". Emitir/faturar é ação séria, nunca por gesto só.
function ConfirmFaturarModal({ info, loading, onCancel, onConfirm }: {
  info: { tipo: 'orcamento'; orc: Orcamento } | { tipo: 'pedido'; ped: Pedido }
  loading: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const ehOrc = info.tipo === 'orcamento'
  const doc = ehOrc ? info.orc : info.ped
  const titulo = ehOrc ? 'Converter em pedido e faturar?' : 'Faturar pedido?'
  const acao = ehOrc ? 'Converter e faturar' : 'Faturar'
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ArrowRight size={18} style={{ color: C.purple }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{titulo}</h3>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: C.espresso }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            {ehOrc ? 'O orçamento ' : 'O pedido '}
            <strong style={{ fontFamily: 'monospace' }}>{doc.numero ?? '—'}</strong> de <strong>{doc.cliente_nome ?? '—'}</strong> ({fmtBRL(doc.total)})
            {ehOrc
              ? <> vai <strong>virar pedido</strong> e depois ser <strong>faturado</strong> (baixa estoque e gera as contas a receber).</>
              : <> vai ser <strong>faturado</strong> (baixa estoque e gera as contas a receber).</>}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: 10, fontSize: 12, color: C.amber }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Cria documentos (pedido{ehOrc ? ' e ' : ' já existe; gera '}títulos) e não é desfeito por arrastar de volta. Confirme para prosseguir.</span>
          </div>
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={loading} style={{ ...btnSec, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>Cancelar</button>
          <button onClick={onConfirm} disabled={loading} style={{ ...btnPri, background: C.purple, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            <ArrowRight size={14} /> {loading ? 'Processando…' : acao}
          </button>
        </div>
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
  // FEAT-OS-ONDA3B-NFSE-FRONT-v1 · dados pra emitir NFS-e do pedido faturado
  const [nfseDados, setNfseDados] = useState<NfsePedidoDados | null>(null)
  const [nfseModalAberto, setNfseModalAberto] = useState(false)
  const [nfseProducaoDisponivel, setNfseProducaoDisponivel] = useState(false)
  // FIX-O3B-NFSE-VINCULO-PROCESSANDO-v1 · ultima NFS-e do pedido (inclui rejeitada)
  const [nfseUltima, setNfseUltima] = useState<{ id: string; numero: string | null; status: string; pdf_url: string | null; motivo_rejeicao: string | null } | null>(null)
  const [nfseAtualizando, setNfseAtualizando] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_pedidos_itens').select('id,produto_nome,produto_codigo,unidade,quantidade,preco_unitario,subtotal').eq('pedido_id', ped.id).order('ordem', { ascending: true, nullsFirst: true })
      if (alive) setItens(data ?? [])
    })()
    return () => { alive = false }
  }, [ped.id])

  // FIX-NFSE-PRODUCAO-PROVIDER-v2 · lê a config fiscal ATIVA (helper compartilhado). Antes filtrava por
  // provider='gov_nfse_nacional' (legado, inativo) e travava Produção pra todo mundo — chamado #16.
  useEffect(() => {
    if (!ped.company_id) return
    let alive = true
    void carregarProducaoDisponivel(ped.company_id).then((v) => { if (alive) setNfseProducaoDisponivel(v) })
    return () => { alive = false }
  }, [ped.company_id])

  // FEAT-OS-ONDA3B-NFSE-FRONT-v1 · dados pro card NFS-e
  // FIX-O3B-NFSE-VINCULO-PROCESSANDO-v1 · tambem busca a ultima NFS-e (qualquer status)
  // direto da tabela pra cobrir rejeitada · ordena por criado_em DESC.
  const carregarNfseDados = useCallback(async () => {
    if (statusLocal !== 'faturado') return
    setNfseAtualizando(true)
    const [dadosRes, ultimaRes] = await Promise.all([
      supabase.rpc('fn_pedido_nfse_dados', { p_pedido_id: ped.id }),
      supabase
        .from('erp_nfse_emitidas')
        .select('id,numero,status,pdf_url,motivo_rejeicao')
        .eq('pedido_id', ped.id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    setNfseDados(dadosRes.data as NfsePedidoDados | null)
    setNfseUltima(ultimaRes.data as typeof nfseUltima)
    setNfseAtualizando(false)
  }, [ped.id, statusLocal])

  useEffect(() => { void carregarNfseDados() }, [carregarNfseDados])

  // HOTFIX-NFSE-PROCESSANDO-v1 · "Atualizar status" precisa CONSULTAR a Focus (a rota grava número/chave/
  // XML/PDF ou o motivo da recusa), não só reler o banco — sem webhook a nota fica presa em 'processando'.
  const consultarERecarregar = useCallback(async () => {
    const id = nfseUltima?.id
    if (id) {
      setNfseAtualizando(true)
      try { await authFetch(`/api/fiscal/nfse/consultar/${id}`) } catch { /* a rota loga a tentativa; recarrega abaixo */ }
    }
    await carregarNfseDados()
  }, [nfseUltima?.id, carregarNfseDados])

  // Após emitir pelo pedido, consulta a Focus algumas vezes (3× a cada 5s), como o NFSePreviewModal faz:
  // a autorização costuma sair em segundos, então o número aparece sozinho sem depender de webhook.
  const pollAposEmitir = useCallback(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      const { data } = await supabase
        .from('erp_nfse_emitidas')
        .select('id,status')
        .eq('pedido_id', ped.id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nota = data as { id: string; status: string } | null
      if (!nota?.id || nota.status !== 'processando') { await carregarNfseDados(); break }
      try { await authFetch(`/api/fiscal/nfse/consultar/${nota.id}`) } catch { /* segue tentando */ }
      await carregarNfseDados()
    }
  }, [ped.id, carregarNfseDados])

  // Consolidacao multi-servico: junta descricoes + soma valor + usa servicos[0] pra LC116/codigo/aliquota
  const nfseSeed = useMemo(() => {
    if (!nfseDados || !nfseDados.tem_servico || nfseDados.servicos.length === 0) return null
    const descricoes = Array.from(new Set(nfseDados.servicos.map((s) => s.descricao).filter(Boolean))).join(' · ')
    const primeiro = nfseDados.servicos[0]
    return {
      descricao: descricoes || primeiro.descricao || '',
      codigoServicoMunicipio: primeiro.codigo_servico_municipio ?? undefined,
      codigoLC116: primeiro.codigo_lc116 ?? undefined,
      aliquotaIss: Number(primeiro.aliquota_iss ?? 0),
      valorServicos: Number(nfseDados.valor_servicos ?? 0),
      servicoId: primeiro.servico_id ?? undefined,
    }
  }, [nfseDados])

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

          {/* FEAT-OS-ONDA4-O41-FICHA-GENERICA-v1 · Ordem de Serviço */}
          <Card titulo="ORDEM DE SERVIÇO">
            <OrdemServicoCard pedidoId={ped.id} />
          </Card>

          <Card titulo="Parcelas">
            <ParcelasEditor pedidoId={ped.id} total={Number(ped.total ?? 0)} />
          </Card>

          {/* FEAT-OS-ONDA3B-NFSE-FRONT-v1 · NFS-e do serviço · 4 estados */}
          {statusLocal === 'faturado' && nfseDados && nfseDados.tem_servico && (() => {
            const ultStatus = nfseUltima?.status
            const eAutorizada = ultStatus === 'autorizada'
            const eProcessando = ultStatus === 'processando'
            const eRejeitada = ultStatus === 'rejeitada' || ultStatus === 'erro' || ultStatus === 'cancelada'
            const semNota = !nfseUltima
            const btnAtualizar = (
              <button
                type="button"
                onClick={() => void consultarERecarregar()}
                disabled={nfseAtualizando}
                data-testid="nfse-atualizar-status"
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.espressoM, cursor: nfseAtualizando ? 'not-allowed' : 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                {nfseAtualizando ? 'Atualizando…' : '↻ Atualizar status'}
              </button>
            )
            return (
              <Card titulo="NFS-e do serviço">
                {eAutorizada && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>
                      ✅ NFS-e emitida — nº {nfseUltima?.numero ?? '—'}
                    </p>
                    {nfseUltima?.pdf_url && (
                      <a
                        href={nfseUltima.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="nfse-ver-pdf"
                        style={{
                          alignSelf: 'flex-start',
                          padding: '8px 14px', borderRadius: 8,
                          border: `1px solid ${C.gold}`, background: C.goldBg, color: C.goldD,
                          fontSize: 12, fontWeight: 600, textDecoration: 'none',
                        }}
                      >
                        Ver PDF
                      </a>
                    )}
                    {btnAtualizar}
                  </div>
                )}

                {eProcessando && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 12, color: C.amber, fontWeight: 600, margin: 0 }}>
                      ⏳ NFS-e em processamento na prefeitura
                    </p>
                    <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>
                      O número sai assim que a prefeitura autorizar.
                    </p>
                    {btnAtualizar}
                  </div>
                )}

                {eRejeitada && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p style={{ fontSize: 12, color: C.red, fontWeight: 600, margin: 0 }}>
                      ❌ NFS-e rejeitada
                    </p>
                    {nfseUltima?.motivo_rejeicao && (
                      <p style={{ fontSize: 11, color: C.espressoM, margin: 0, padding: 8, background: '#FCEBEB', borderRadius: 6 }}>
                        {nfseUltima.motivo_rejeicao}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setNfseModalAberto(true)}
                      data-testid="nfse-reemitir"
                      style={{
                        minHeight: 44, padding: '10px 16px', borderRadius: 8,
                        border: 'none', background: C.gold, color: '#fff',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
                      }}
                    >
                      📄 Emitir novamente
                    </button>
                    {btnAtualizar}
                  </div>
                )}

                {semNota && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>
                      Valor: <strong style={{ color: C.gold }}>{fmtBRL(nfseDados.valor_servicos)}</strong>
                      {nfseDados.servicos.length > 1 && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: C.espressoL }}>
                          ({nfseDados.servicos.length} serviços consolidados)
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => setNfseModalAberto(true)}
                      data-testid="nfse-emitir-abrir"
                      style={{
                        minHeight: 44, padding: '10px 16px', borderRadius: 8,
                        border: 'none', background: C.gold, color: '#fff',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
                      }}
                    >
                      📄 Emitir NFS-e
                    </button>
                  </div>
                )}
              </Card>
            )
          })()}

          {/* FEAT-NFE-PRODUTO-3-PRODUCAO-v1 · NF-e do produto · ambiente vem da config (producao) */}
          {statusLocal === 'faturado' && (
            <Card titulo="NF-E DO PRODUTO">
              <NFeCard companyId={ped.company_id} pedidoId={ped.id} />
            </Card>
          )}

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
      {/* FEAT-OS-ONDA3B-NFSE-FRONT-v1 · modal de emissao pre-preenchido.
          HOTFIX (print Rodrigo 21/09): o modal é irmão do <aside> DENTRO do wrapper que fecha no onClick.
          Todo clique no modal (escolher obra, digitar) borbulhava pela árvore React até o wrapper → onClose
          → o painel do pedido fechava. O stopPropagation aqui contém o clique: o overlay do próprio modal
          fecha só o modal; o fundo do painel (sem modal) continua fechando o painel. O modal fica ACIMA do
          <aside> (fixed z-50 dentro do contexto de empilhamento do wrapper z-90). */}
      <div onClick={(e) => e.stopPropagation()}>
      <NFSeEmitirGovModal
        companyId={ped.company_id}
        aberto={nfseModalAberto}
        pedidoId={ped.id}
        pedidoNumero={ped.numero ?? undefined}
        producaoDisponivel={nfseProducaoDisponivel}
        tomadorDocumento={nfseDados?.tomador?.documento ?? undefined}
        tomadorTipo={nfseDados?.tomador?.tipo ?? undefined}
        tomadorNome={nfseDados?.tomador?.nome ?? undefined}
        tomadorEmail={nfseDados?.tomador?.email ?? undefined}
        descricaoServico={nfseSeed?.descricao}
        codigoServicoMunicipio={nfseSeed?.codigoServicoMunicipio}
        codigoLC116={nfseSeed?.codigoLC116}
        aliquotaIss={nfseSeed?.aliquotaIss}
        valorServicos={nfseSeed?.valorServicos}
        servicoId={nfseSeed?.servicoId}
        onFechar={() => setNfseModalAberto(false)}
        onEmitida={async (providerReference?: string) => {
          setNfseModalAberto(false)
          if (providerReference) {
            await supabase.rpc('fn_pedido_nfse_marcar_emitida', {
              p_pedido_id: ped.id,
              p_provider_reference: providerReference,
            })
          }
          await carregarNfseDados()
          // HOTFIX-NFSE-PROCESSANDO-v1: sem webhook, a nota fica em 'processando' — consulta a Focus
          // algumas vezes logo após emitir para o número/recusa aparecer sozinho.
          void pollAposEmitir()
        }}
      />
      </div>
    </div>
  )
}

// #82② / A③ · obra migrada para o componente único BlocoObraFiscal (tipos/regras lá).

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

  // #82② cluster obra · Parte 3 — bloco de obra quando algum serviço é E0370 (construção civil).
  // A obra vira CAMPOS congelados no orçamento (autossuficiência fiscal) + obra_id (rastreio #82.3).
  const [exigeObra, setExigeObra] = useState(false)
  const [checandoObra, setChecandoObra] = useState(false)
  // #82② / A③ · obra via componente ÚNICO BlocoObraFiscal (mesmo do reenvio de NFS-e).
  const [obraFiscal, setObraFiscal] = useState<ObraFiscalState>(obraFiscalStateInicial)

  // Detecção do E0370 ANTES de salvar (a tela só tem os servico_id; fn_orcamento_exige_obra exige
  // orçamento já gravado). Mesma regra da emissão (fn_servicos_exigem_obra → fn_fiscal_exige_obra).
  useEffect(() => {
    const ids = itens.filter((i) => i.tipo_item === 'servico' && i.servico_id).map((i) => i.servico_id as string)
    if (ids.length === 0) { setExigeObra(false); return }
    let cancel = false
    setChecandoObra(true)
    supabase.rpc('fn_servicos_exigem_obra', { p_company_id: companyId, p_servico_ids: ids })
      .then(({ data }) => { if (!cancel) { setExigeObra(data === true); setChecandoObra(false) } })
    return () => { cancel = true }
  }, [itens, companyId])

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
    // Numeração oficial e sequencial (config por empresa). Antes gerava ORC-<timestamp> aleatório
    // (fonte dos números órfãos tipo ORC-346035). O trigger BEFORE INSERT é a rede de segurança.
    const { data: numData } = await supabase.rpc('next_orcamento_numero', { p_company_id: companyId })
    const numero = (numData as string | null) || `ORC-${new Date().getFullYear()}-0001`
    const validade = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user

    // #82② / A③ — obra congelada no orçamento (autossuficiência fiscal) + obra_id (rastreio), resolvida
    // pelo helper ÚNICO (mesmo do reenvio de NFS-e). Não bloqueia o rascunho: sem obra, grava tudo nulo
    // e a trava fica na emissão. Só aborta se falhar ao criar a obra no Hub.
    let obraFields: Record<string, unknown> = {}
    if (exigeObra) {
      const rObra = await resolverObraFiscal(obraFiscal, {
        companyId, clienteId: clienteSel.id, clienteNome: clienteSel.nome_fantasia || clienteSel.razao_social,
      })
      if (!rObra.ok) { flash(rObra.erro); setSalvando(false); return }
      obraFields = rObra.obra as unknown as Record<string, unknown>
    }

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
        ...obraFields,
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

            {/* #82② — bloco de obra: só aparece quando um serviço é de construção civil (E0370) */}
            {checandoObra && !exigeObra && (
              <p style={{ margin: 0, fontSize: 11, color: C.espressoL }}>Verificando se algum serviço exige obra…</p>
            )}
            {exigeObra && (
              <BlocoObraFiscal companyId={companyId} value={obraFiscal} onChange={setObraFiscal} />
            )}

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
