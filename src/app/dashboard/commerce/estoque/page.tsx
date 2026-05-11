'use client'

// /dashboard/commerce/estoque — Multi-deposito + Curva ABC
// PR M.B.1.3 — Commerce 3/12
//
// Multi-tenant: RD-34 via useCompanyIds.
// Backend pre-existente:
//   - erp_produtos (47 cols)
//   - erp_estoque_locais (10 cols)
//   - erp_estoque_movimentacoes (21 cols)
//   - RPC fn_movimentar_estoque(produto, local, tipo, qtd, custo, ...)
//   - RPC fn_curva_abc_estoque(company_ids uuid[])

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import {
  Plus, Search, Boxes, Package, ArrowRightLeft, BarChart3,
  X, Info, Trash2, Pencil,
} from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

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
  gray: '#94A3B8',
}

type Tab = 'locais' | 'produtos' | 'movimentacoes' | 'abc'

type Local = {
  id: string
  company_id: string
  nome: string
  descricao: string | null
  endereco: string | null
  responsavel: string | null
  principal: boolean | null
  ativo: boolean | null
}

type Produto = {
  id: string
  company_id: string
  codigo: string | null
  nome: string
  categoria: string | null
  unidade: string | null
  preco_venda: number | null
  preco_custo: number | null
  preco_custo_medio: number | null
  estoque_atual: number | null
  estoque_minimo: number | null
  estoque_maximo: number | null
  localizacao: string | null
  ativo: boolean | null
}

type Movimentacao = {
  id: string
  company_id: string
  produto_id: string
  local_id: string | null
  tipo: string
  motivo: string | null
  quantidade: number
  quantidade_antes: number | null
  quantidade_depois: number | null
  custo_unitario: number | null
  valor_total: number | null
  ref_tipo: string | null
  ref_numero: string | null
  lote: string | null
  validade: string | null
  observacoes: string | null
  usuario_nome: string | null
  data_movimento: string | null
}

type CurvaABCRow = {
  produto_id: string
  codigo: string | null
  nome: string
  categoria: string | null
  estoque_atual: number
  preco_custo_medio: number
  valor_total: number
  pct_acumulado: number
  classe_abc: 'A' | 'B' | 'C'
}

const TIPOS_MOV: { value: string; label: string; sinal: '+' | '-' | '=' }[] = [
  { value: 'entrada', label: 'Entrada', sinal: '+' },
  { value: 'compra', label: 'Compra', sinal: '+' },
  { value: 'devolucao_entrada', label: 'Devolução (entrada)', sinal: '+' },
  { value: 'producao', label: 'Produção', sinal: '+' },
  { value: 'saida', label: 'Saída', sinal: '-' },
  { value: 'venda', label: 'Venda', sinal: '-' },
  { value: 'devolucao_saida', label: 'Devolução (saída)', sinal: '-' },
  { value: 'perda', label: 'Perda', sinal: '-' },
  { value: 'transferencia_saida', label: 'Transferência (saída)', sinal: '-' },
  { value: 'transferencia_entrada', label: 'Transferência (entrada)', sinal: '+' },
  { value: 'ajuste_positivo', label: 'Ajuste +', sinal: '+' },
  { value: 'ajuste_negativo', label: 'Ajuste -', sinal: '-' },
  { value: 'inventario', label: 'Inventário', sinal: '=' },
]

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtNum = (v: number | null | undefined, dp = 2) =>
  (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: dp, maximumFractionDigits: dp })
const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('pt-BR') : '—'

export default function EstoquePage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: C.espressoM }}>Carregando…</div>}>
      <EstoqueInner />
    </Suspense>
  )
}

function EstoqueInner() {
  const { companyIds, selInfo, loading: companiesLoading, sel } = useCompanyIds()
  const companyIdUnico = selInfo.tipo === 'empresa' && sel ? sel : null
  const canCreate = !!companyIdUnico

  const [tab, setTab] = useState<Tab>('produtos')
  const [locais, setLocais] = useState<Local[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([])
  const [curva, setCurva] = useState<CurvaABCRow[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  // Filtros produtos
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroEstoque, setFiltroEstoque] = useState<'todos' | 'baixo' | 'zero' | 'excedente'>('todos')

  // Filtros movimentacoes
  const [filtroTipo, setFiltroTipo] = useState('')

  const [produtoSel, setProdutoSel] = useState<Produto | null>(null)
  const [localEdit, setLocalEdit] = useState<Local | 'new' | null>(null)
  const [showMovimentar, setShowMovimentar] = useState<{ produto?: Produto } | null>(null)

  const companyIdsKey = useMemo(() => [...companyIds].sort().join(','), [companyIds])

  const carregar = useCallback(async () => {
    if (companyIds.length === 0) {
      setLocais([]); setProdutos([]); setMovimentacoes([]); setCurva([])
      return
    }
    setLoading(true)
    setErro('')
    const [loc, prod, mov, abc] = await Promise.all([
      supabase.from('erp_estoque_locais').select('*').in('company_id', companyIds).order('principal', { ascending: false }).order('nome'),
      supabase.from('erp_produtos').select('id,company_id,codigo,nome,categoria,unidade,preco_venda,preco_custo,preco_custo_medio,estoque_atual,estoque_minimo,estoque_maximo,localizacao,ativo')
        .in('company_id', companyIds).eq('ativo', true).order('nome').limit(500),
      supabase.from('erp_estoque_movimentacoes').select('*').in('company_id', companyIds).order('data_movimento', { ascending: false }).limit(300),
      supabase.rpc('fn_curva_abc_estoque', { p_company_ids: companyIds }),
    ])
    if (loc.error) setErro('Locais: ' + loc.error.message)
    else setLocais((loc.data ?? []) as Local[])
    if (prod.error) setErro('Produtos: ' + prod.error.message)
    else setProdutos((prod.data ?? []) as Produto[])
    if (mov.error) setErro('Movimentações: ' + mov.error.message)
    else setMovimentacoes((mov.data ?? []) as Movimentacao[])
    if (abc.error) setErro('Curva ABC: ' + abc.error.message)
    else setCurva((abc.data ?? []) as CurvaABCRow[])
    setLoading(false)
  }, [companyIds])

  useEffect(() => {
    if (companiesLoading) return
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdsKey, companiesLoading])

  const flash = (m: string) => {
    setMsg(m); window.setTimeout(() => setMsg(''), 3500)
  }
  const flashErr = (m: string) => {
    setErro(m); window.setTimeout(() => setErro(''), 5000)
  }

  // ────────────────────────────────────────────────────────
  // Lógicas (CRUD locais + movimentação)
  // ────────────────────────────────────────────────────────

  async function salvarLocal(payload: Partial<Local> & { id?: string }) {
    if (!companyIdUnico) { flashErr('Selecione uma empresa específica.'); return }
    if (payload.id) {
      const { error } = await supabase.from('erp_estoque_locais').update({
        nome: payload.nome, descricao: payload.descricao, endereco: payload.endereco,
        responsavel: payload.responsavel, principal: payload.principal, ativo: payload.ativo,
        updated_at: new Date().toISOString(),
      }).eq('id', payload.id)
      if (error) { flashErr('Erro: ' + error.message); return }
      flash('Local atualizado.')
    } else {
      const { error } = await supabase.from('erp_estoque_locais').insert({
        company_id: companyIdUnico,
        nome: payload.nome, descricao: payload.descricao, endereco: payload.endereco,
        responsavel: payload.responsavel, principal: payload.principal ?? false, ativo: true,
      })
      if (error) { flashErr('Erro: ' + error.message); return }
      flash('Local criado.')
    }
    setLocalEdit(null)
    void carregar()
  }

  async function deletarLocal(id: string) {
    if (!confirm('Excluir este local? Movimentações já registradas serão preservadas.')) return
    const { error } = await supabase.from('erp_estoque_locais').delete().eq('id', id)
    if (error) { flashErr('Erro: ' + error.message); return }
    flash('Local excluído.')
    void carregar()
  }

  async function movimentar(args: {
    produto_id: string; local_id: string | null; tipo: string;
    quantidade: number; custo_unitario: number; motivo: string | null;
    observacoes: string | null; lote: string | null; validade: string | null;
  }) {
    const { error } = await supabase.rpc('fn_movimentar_estoque', {
      p_produto_id: args.produto_id,
      p_local_id: args.local_id,
      p_tipo: args.tipo,
      p_quantidade: args.quantidade,
      p_custo_unitario: args.custo_unitario || 0,
      p_motivo: args.motivo,
      p_observacoes: args.observacoes,
      p_lote: args.lote,
      p_validade: args.validade,
    })
    if (error) {
      flashErr('Falha na movimentação: ' + error.message)
      return false
    }
    flash('Movimentação registrada.')
    setShowMovimentar(null)
    void carregar()
    return true
  }

  // ────────────────────────────────────────────────────────
  // Listas filtradas
  // ────────────────────────────────────────────────────────

  const categoriasUnicas = useMemo(() => {
    const set = new Set<string>()
    produtos.forEach((p) => { if (p.categoria) set.add(p.categoria) })
    return [...set].sort()
  }, [produtos])

  const produtosFiltrados = useMemo(() => {
    const q = filtroBusca.trim().toLowerCase()
    return produtos.filter((p) => {
      if (filtroCategoria && p.categoria !== filtroCategoria) return false
      if (q && !((p.nome ?? '').toLowerCase().includes(q) || (p.codigo ?? '').toLowerCase().includes(q))) return false
      const atual = Number(p.estoque_atual ?? 0)
      const min = Number(p.estoque_minimo ?? 0)
      const max = Number(p.estoque_maximo ?? 0)
      if (filtroEstoque === 'baixo' && atual >= min) return false
      if (filtroEstoque === 'zero' && atual !== 0) return false
      if (filtroEstoque === 'excedente' && (max === 0 || atual <= max)) return false
      return true
    })
  }, [produtos, filtroBusca, filtroCategoria, filtroEstoque])

  const movFiltradas = useMemo(() => {
    return movimentacoes.filter((m) => {
      if (filtroTipo && m.tipo !== filtroTipo) return false
      return true
    })
  }, [movimentacoes, filtroTipo])

  const produtosPorId = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos])
  const locaisPorId = useMemo(() => Object.fromEntries(locais.map((l) => [l.id, l])), [locais])

  const movimentacoesDoProduto = useMemo(() => {
    if (!produtoSel) return []
    return movimentacoes.filter((m) => m.produto_id === produtoSel.id).slice(0, 50)
  }, [movimentacoes, produtoSel])

  // ────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 24px)', maxWidth: 1280, margin: '0 auto', color: C.espresso }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Boxes size={26} style={{ color: C.gold }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Estoque & Curva ABC</h1>
            <p style={{ margin: 0, fontSize: 12, color: C.espressoM }}>Multi-depósito, movimentações e classificação ABC</p>
          </div>
        </div>
        {tab === 'locais' && (
          <button onClick={() => setLocalEdit('new')} disabled={!canCreate} title={canCreate ? '' : 'Selecione uma empresa específica'} style={btnPrincipal(canCreate)}>
            <Plus size={14} /> Novo Local
          </button>
        )}
        {tab === 'movimentacoes' && (
          <button onClick={() => setShowMovimentar({})} disabled={!canCreate || locais.length === 0 || produtos.length === 0} title={!canCreate ? 'Selecione uma empresa específica' : (locais.length === 0 ? 'Cadastre um local primeiro' : '')} style={btnPrincipal(canCreate && locais.length > 0 && produtos.length > 0)}>
            <Plus size={14} /> Nova Movimentação
          </button>
        )}
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
        <TabBtn ativo={tab === 'locais'} onClick={() => setTab('locais')} icon={<Boxes size={14} />} label="Locais" count={locais.length} />
        <TabBtn ativo={tab === 'produtos'} onClick={() => setTab('produtos')} icon={<Package size={14} />} label="Produtos" count={produtos.length} />
        <TabBtn ativo={tab === 'movimentacoes'} onClick={() => setTab('movimentacoes')} icon={<ArrowRightLeft size={14} />} label="Movimentações" count={movimentacoes.length} />
        <TabBtn ativo={tab === 'abc'} onClick={() => setTab('abc')} icon={<BarChart3 size={14} />} label="Curva ABC" />
      </div>

      {/* Hint multi-empresa */}
      {selInfo.tipo !== 'empresa' && companyIds.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.goldBg, border: `1px solid ${C.gold}55`, borderRadius: 8, color: C.goldD, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={14} />
          <span>Exibindo dados de <strong>{selInfo.nome}</strong> ({selInfo.count} {selInfo.count === 1 ? 'empresa' : 'empresas'}). Para criar/movimentar, selecione uma empresa específica.</span>
        </div>
      )}

      {/* Toast */}
      {msg && <div onClick={() => setMsg('')} style={{ marginBottom: 12, padding: '10px 14px', background: C.greenBg, border: `1px solid ${C.green}55`, borderRadius: 8, color: C.green, fontSize: 12, cursor: 'pointer' }}>{msg}</div>}
      {erro && <div onClick={() => setErro('')} style={{ marginBottom: 12, padding: '10px 14px', background: C.redBg, border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 12, cursor: 'pointer' }}>{erro}</div>}

      {/* Conteúdo */}
      {companiesLoading || loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Carregando…</div>
      ) : companyIds.length === 0 ? (
        <EmptyState titulo="Nenhuma empresa disponível" texto="Selecione uma empresa no menu superior ou peça ao administrador para te vincular." />
      ) : tab === 'locais' ? (
        <TabLocais locais={locais} onEdit={(l) => setLocalEdit(l)} onDelete={deletarLocal} canCreate={canCreate} onCreate={() => setLocalEdit('new')} />
      ) : tab === 'produtos' ? (
        <TabProdutos
          rows={produtosFiltrados} total={produtos.length}
          categorias={categoriasUnicas}
          filtroBusca={filtroBusca} setFiltroBusca={setFiltroBusca}
          filtroCategoria={filtroCategoria} setFiltroCategoria={setFiltroCategoria}
          filtroEstoque={filtroEstoque} setFiltroEstoque={setFiltroEstoque}
          onSelect={setProdutoSel}
        />
      ) : tab === 'movimentacoes' ? (
        <TabMovimentacoes
          rows={movFiltradas} total={movimentacoes.length}
          filtroTipo={filtroTipo} setFiltroTipo={setFiltroTipo}
          produtosPorId={produtosPorId} locaisPorId={locaisPorId}
        />
      ) : (
        <TabCurvaABC rows={curva} />
      )}

      {/* Drawer produto */}
      {produtoSel && (
        <DrawerProduto
          produto={produtoSel}
          movimentacoes={movimentacoesDoProduto}
          locaisPorId={locaisPorId}
          onClose={() => setProdutoSel(null)}
          onMovimentar={() => setShowMovimentar({ produto: produtoSel })}
        />
      )}

      {/* Drawer/Modal Local */}
      {localEdit && (
        <ModalLocal
          local={localEdit === 'new' ? null : localEdit}
          onClose={() => setLocalEdit(null)}
          onSave={salvarLocal}
        />
      )}

      {/* Modal Movimentar */}
      {showMovimentar && canCreate && (
        <ModalMovimentar
          produtos={produtos}
          locais={locais}
          produtoInicial={showMovimentar.produto ?? null}
          onClose={() => setShowMovimentar(null)}
          onSubmit={movimentar}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Tabs
// ════════════════════════════════════════════════════════════

function TabLocais({ locais, onEdit, onDelete, canCreate, onCreate }: { locais: Local[]; onEdit: (l: Local) => void; onDelete: (id: string) => void; canCreate: boolean; onCreate: () => void }) {
  if (locais.length === 0) {
    return <EmptyState titulo="Nenhum local de estoque" texto="Cadastre seu primeiro local (depósito, loja, almoxarifado) para começar a movimentar estoque." cta={canCreate ? { label: '+ Novo local', onClick: onCreate } : undefined} />
  }
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: C.cream }}>
          <tr><Th>Nome</Th><Th>Endereço</Th><Th>Responsável</Th><Th>Status</Th><Th align="right">Ações</Th></tr>
        </thead>
        <tbody>
          {locais.map((l) => (
            <tr key={l.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
              <Td>
                <div style={{ fontWeight: 600 }}>{l.nome}</div>
                {l.descricao && <div style={{ fontSize: 10, color: C.espressoM }}>{l.descricao}</div>}
                {l.principal && <span style={{ fontSize: 9, color: C.goldD, fontWeight: 600 }}>★ PRINCIPAL</span>}
              </Td>
              <Td>{l.endereco ?? '—'}</Td>
              <Td>{l.responsavel ?? '—'}</Td>
              <Td>{l.ativo ? <Badge cor={C.green}>Ativo</Badge> : <Badge cor={C.gray}>Inativo</Badge>}</Td>
              <Td align="right">
                <button onClick={() => onEdit(l)} style={btnIcon}><Pencil size={14} /></button>
                <button onClick={() => onDelete(l.id)} style={{ ...btnIcon, color: C.red }}><Trash2 size={14} /></button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TabProdutos({ rows, total, categorias, filtroBusca, setFiltroBusca, filtroCategoria, setFiltroCategoria, filtroEstoque, setFiltroEstoque, onSelect }: {
  rows: Produto[]; total: number; categorias: string[];
  filtroBusca: string; setFiltroBusca: (v: string) => void;
  filtroCategoria: string; setFiltroCategoria: (v: string) => void;
  filtroEstoque: 'todos' | 'baixo' | 'zero' | 'excedente'; setFiltroEstoque: (v: 'todos' | 'baixo' | 'zero' | 'excedente') => void;
  onSelect: (p: Produto) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }} />
          <input type="text" placeholder="Buscar por nome ou código…" value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)} style={{ width: '100%', padding: '8px 10px 8px 32px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.white, color: C.espresso, outline: 'none' }} />
        </div>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} style={selInpStyle}>
          <option value="">Todas as categorias</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtroEstoque} onChange={(e) => setFiltroEstoque(e.target.value as 'todos' | 'baixo' | 'zero' | 'excedente')} style={selInpStyle}>
          <option value="todos">Todos os estoques</option>
          <option value="baixo">Abaixo do mínimo</option>
          <option value="zero">Estoque zerado</option>
          <option value="excedente">Acima do máximo</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.espressoM }}>{rows.length} de {total}</span>
      </div>

      {rows.length === 0 ? (
        total === 0
          ? <EmptyState titulo="Nenhum produto cadastrado" texto="Os produtos vêm de erp_produtos (cadastro fiscal completo). Importe via Importar Dados ou cadastre manualmente." />
          : <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhum produto corresponde aos filtros.</div>
      ) : (
        <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead style={{ background: C.cream }}>
                <tr><Th>Código</Th><Th>Nome</Th><Th>Categoria</Th><Th>Unid.</Th><Th align="right">Estoque</Th><Th align="right">Mín/Máx</Th><Th align="right">Custo médio</Th><Th align="right">Valor estoque</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const atual = Number(p.estoque_atual ?? 0)
                  const min = Number(p.estoque_minimo ?? 0)
                  const max = Number(p.estoque_maximo ?? 0)
                  const custo = Number(p.preco_custo_medio ?? p.preco_custo ?? 0)
                  const valor = atual * custo
                  const status = atual === 0 ? 'zero' : atual < min ? 'baixo' : (max > 0 && atual > max) ? 'excedente' : 'ok'
                  return (
                    <tr key={p.id} onClick={() => onSelect(p)} style={{ cursor: 'pointer', borderTop: `1px solid ${C.borderL}` }} onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <Td><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.codigo ?? '—'}</span></Td>
                      <Td><span style={{ fontWeight: 600 }}>{p.nome}</span></Td>
                      <Td>{p.categoria ?? '—'}</Td>
                      <Td>{p.unidade ?? '—'}</Td>
                      <Td align="right"><strong>{fmtNum(atual)}</strong></Td>
                      <Td align="right"><span style={{ fontSize: 11, color: C.espressoM }}>{fmtNum(min, 0)} / {max > 0 ? fmtNum(max, 0) : '∞'}</span></Td>
                      <Td align="right">{fmtBRL(custo)}</Td>
                      <Td align="right"><strong>{fmtBRL(valor)}</strong></Td>
                      <Td>
                        {status === 'zero' ? <Badge cor={C.red}>Zerado</Badge> :
                          status === 'baixo' ? <Badge cor={C.red}>Abaixo mín</Badge> :
                            status === 'excedente' ? <Badge cor={C.amber}>Excedente</Badge> :
                              <Badge cor={C.green}>OK</Badge>}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TabMovimentacoes({ rows, total, filtroTipo, setFiltroTipo, produtosPorId, locaisPorId }: {
  rows: Movimentacao[]; total: number;
  filtroTipo: string; setFiltroTipo: (v: string) => void;
  produtosPorId: Record<string, Produto>; locaisPorId: Record<string, Local>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={selInpStyle}>
          <option value="">Todos os tipos</option>
          {TIPOS_MOV.map((t) => <option key={t.value} value={t.value}>{t.sinal} {t.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.espressoM }}>{rows.length} de {total}</span>
      </div>

      {rows.length === 0 ? (
        total === 0
          ? <EmptyState titulo="Nenhuma movimentação registrada" texto="Use o botão Nova Movimentação para registrar entradas, saídas, ajustes e inventários." />
          : <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Sem movimentações neste filtro.</div>
      ) : (
        <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
              <thead style={{ background: C.cream }}>
                <tr><Th>Data</Th><Th>Tipo</Th><Th>Produto</Th><Th>Local</Th><Th align="right">Quantidade</Th><Th align="right">Antes → Depois</Th><Th align="right">Valor</Th><Th>Motivo</Th></tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const t = TIPOS_MOV.find((x) => x.value === m.tipo)
                  const sinal = t?.sinal ?? '='
                  const cor = sinal === '+' ? C.green : sinal === '-' ? C.red : C.blue
                  const prod = produtosPorId[m.produto_id]
                  const local = m.local_id ? locaisPorId[m.local_id] : null
                  return (
                    <tr key={m.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                      <Td>{fmtDateTime(m.data_movimento)}</Td>
                      <Td>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: cor + '20', color: cor, fontWeight: 700, textTransform: 'uppercase' }}>
                          {sinal} {t?.label ?? m.tipo}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 600 }}>{prod?.nome ?? '—'}</div>
                        {prod?.codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace' }}>{prod.codigo}</span>}
                      </Td>
                      <Td>{local?.nome ?? '—'}</Td>
                      <Td align="right"><strong style={{ color: cor }}>{sinal} {fmtNum(Math.abs(Number(m.quantidade)))}</strong></Td>
                      <Td align="right"><span style={{ fontSize: 11, color: C.espressoM }}>{fmtNum(Number(m.quantidade_antes))} → <strong style={{ color: C.espresso }}>{fmtNum(Number(m.quantidade_depois))}</strong></span></Td>
                      <Td align="right">{Number(m.valor_total) > 0 ? fmtBRL(Number(m.valor_total)) : '—'}</Td>
                      <Td>{m.motivo ?? m.ref_numero ?? '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TabCurvaABC({ rows }: { rows: CurvaABCRow[] }) {
  if (rows.length === 0) {
    return <EmptyState titulo="Sem dados para Curva ABC" texto="A curva ABC classifica produtos por valor acumulado em estoque. Cadastre produtos e movimente estoque para gerar dados." />
  }
  const totalValor = rows.reduce((s, r) => s + Number(r.valor_total), 0)
  const counts = { A: 0, B: 0, C: 0 }
  rows.forEach((r) => { counts[r.classe_abc] += 1 })
  const valuesByClass = { A: 0, B: 0, C: 0 } as Record<'A' | 'B' | 'C', number>
  rows.forEach((r) => { valuesByClass[r.classe_abc] += Number(r.valor_total) })

  // Top 20 para chart
  const chartData = rows.slice(0, 20).map((r, idx) => ({
    nome: r.nome.length > 20 ? r.nome.slice(0, 18) + '…' : r.nome,
    valor: Number(r.valor_total),
    pct: Number(r.pct_acumulado),
    idx: idx + 1,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Cards resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Kpi label="Produtos" valor={String(rows.length)} sub={`Classe A: ${counts.A} · B: ${counts.B} · C: ${counts.C}`} />
        <Kpi label="Valor total" valor={fmtBRL(totalValor)} sub="em estoque" />
        <Kpi label="Classe A (top 80%)" valor={fmtBRL(valuesByClass.A)} sub={`${((valuesByClass.A / Math.max(totalValor, 1)) * 100).toFixed(0)}% do valor`} accent={C.green} />
        <Kpi label="Classe B (15%)" valor={fmtBRL(valuesByClass.B)} sub={`${((valuesByClass.B / Math.max(totalValor, 1)) * 100).toFixed(0)}% do valor`} accent={C.amber} />
      </div>

      {/* Pareto chart */}
      <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700 }}>Pareto — Top 20 produtos</h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 12, right: 24, bottom: 60, left: 8 }}>
              <CartesianGrid stroke={C.borderL} strokeDasharray="3 3" />
              <XAxis dataKey="nome" tick={{ fontSize: 10, fill: C.espressoM }} angle={-35} textAnchor="end" interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: C.espressoM }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: C.espressoM }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const v = Number(value)
                  return name === 'Valor estoque' ? fmtBRL(v) : `${v.toFixed(1)}%`
                }}
                labelStyle={{ color: C.espresso, fontWeight: 700 }}
                contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="valor" name="Valor estoque" fill={C.gold} />
              <Line yAxisId="right" type="monotone" dataKey="pct" name="% acumulado" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela completa */}
      <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
            <thead style={{ background: C.cream }}>
              <tr><Th>#</Th><Th>Classe</Th><Th>Código</Th><Th>Nome</Th><Th>Categoria</Th><Th align="right">Estoque</Th><Th align="right">Custo médio</Th><Th align="right">Valor</Th><Th align="right">% Acum.</Th></tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const cor = r.classe_abc === 'A' ? C.green : r.classe_abc === 'B' ? C.amber : C.gray
                return (
                  <tr key={r.produto_id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                    <Td><span style={{ color: C.espressoM, fontSize: 11 }}>{idx + 1}</span></Td>
                    <Td><span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: cor + '22', color: cor, fontWeight: 700 }}>{r.classe_abc}</span></Td>
                    <Td><span style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.codigo ?? '—'}</span></Td>
                    <Td><strong>{r.nome}</strong></Td>
                    <Td>{r.categoria ?? '—'}</Td>
                    <Td align="right">{fmtNum(r.estoque_atual)}</Td>
                    <Td align="right">{fmtBRL(r.preco_custo_medio)}</Td>
                    <Td align="right"><strong>{fmtBRL(r.valor_total)}</strong></Td>
                    <Td align="right"><span style={{ color: cor, fontWeight: 600 }}>{r.pct_acumulado.toFixed(1)}%</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Drawer/Modal
// ════════════════════════════════════════════════════════════

function DrawerProduto({ produto, movimentacoes, locaisPorId, onClose, onMovimentar }: { produto: Produto; movimentacoes: Movimentacao[]; locaisPorId: Record<string, Local>; onClose: () => void; onMovimentar: () => void }) {
  const atual = Number(produto.estoque_atual ?? 0)
  const min = Number(produto.estoque_minimo ?? 0)
  const custo = Number(produto.preco_custo_medio ?? produto.preco_custo ?? 0)
  const valor = atual * custo

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)', height: '100%', background: C.offWhite, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, zIndex: 1 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600 }}>Produto</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>{produto.nome}</h2>
            {produto.codigo && <p style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', color: C.espressoM }}>{produto.codigo}</p>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}><X size={16} /></button>
        </header>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card titulo="Geral">
            <Row label="Categoria" value={produto.categoria ?? '—'} />
            <Row label="Unidade" value={produto.unidade ?? '—'} />
            <Row label="Preço venda" value={fmtBRL(produto.preco_venda)} />
            <Row label="Preço custo" value={fmtBRL(produto.preco_custo)} />
            <Row label="Custo médio" value={fmtBRL(produto.preco_custo_medio)} />
          </Card>

          <Card titulo="Estoque">
            <Row label="Atual" value={<strong style={{ fontSize: 16, color: atual < min ? C.red : C.green }}>{fmtNum(atual)} {produto.unidade}</strong>} />
            <Row label="Mínimo" value={fmtNum(min, 0)} />
            <Row label="Máximo" value={produto.estoque_maximo ? fmtNum(Number(produto.estoque_maximo), 0) : '∞'} />
            <Row label="Valor em estoque" value={<strong style={{ color: C.gold }}>{fmtBRL(valor)}</strong>} />
            {produto.localizacao && <Row label="Localização" value={produto.localizacao} />}
            <div style={{ marginTop: 8 }}>
              <button onClick={onMovimentar} style={btnPri}><ArrowRightLeft size={14} /> Movimentar</button>
            </div>
          </Card>

          <Card titulo={`Últimas ${movimentacoes.length} movimentações`}>
            {movimentacoes.length === 0 ? (
              <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Sem movimentações.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: C.cream }}><Th>Data</Th><Th>Tipo</Th><Th>Local</Th><Th align="right">Qtd</Th><Th align="right">Depois</Th></tr></thead>
                <tbody>
                  {movimentacoes.map((m) => {
                    const t = TIPOS_MOV.find((x) => x.value === m.tipo)
                    const sinal = t?.sinal ?? '='
                    const cor = sinal === '+' ? C.green : sinal === '-' ? C.red : C.blue
                    return (
                      <tr key={m.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                        <Td>{fmtDateTime(m.data_movimento)}</Td>
                        <Td><span style={{ color: cor, fontWeight: 600, fontSize: 10 }}>{sinal} {t?.label ?? m.tipo}</span></Td>
                        <Td>{m.local_id ? locaisPorId[m.local_id]?.nome ?? '—' : '—'}</Td>
                        <Td align="right">{fmtNum(Math.abs(Number(m.quantidade)))}</Td>
                        <Td align="right"><strong>{fmtNum(Number(m.quantidade_depois))}</strong></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </aside>
    </div>
  )
}

function ModalLocal({ local, onClose, onSave }: { local: Local | null; onClose: () => void; onSave: (payload: Partial<Local> & { id?: string }) => void }) {
  const [form, setForm] = useState<Partial<Local>>({
    nome: local?.nome ?? '',
    descricao: local?.descricao ?? '',
    endereco: local?.endereco ?? '',
    responsavel: local?.responsavel ?? '',
    principal: local?.principal ?? false,
    ativo: local?.ativo ?? true,
  })
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 24, width: '100%', maxWidth: 480, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{local ? 'Editar local' : 'Novo local'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Nome *"><input autoFocus value={form.nome ?? ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} /></Field>
          <Field label="Descrição"><input value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} style={inp} /></Field>
          <Field label="Endereço"><input value={form.endereco ?? ''} onChange={(e) => setForm({ ...form, endereco: e.target.value })} style={inp} /></Field>
          <Field label="Responsável"><input value={form.responsavel ?? ''} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} style={inp} /></Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.espresso, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.principal} onChange={(e) => setForm({ ...form, principal: e.target.checked })} />
            Local principal (padrão para movimentações)
          </label>
          {local && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.espresso, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              Ativo
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnSec}>Cancelar</button>
          <button onClick={() => form.nome?.trim() && onSave({ ...form, id: local?.id })} disabled={!form.nome?.trim()} style={{ ...btnPri, opacity: form.nome?.trim() ? 1 : 0.5 }}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalMovimentar({ produtos, locais, produtoInicial, onClose, onSubmit }: {
  produtos: Produto[]; locais: Local[];
  produtoInicial: Produto | null;
  onClose: () => void;
  onSubmit: (args: {
    produto_id: string; local_id: string | null; tipo: string;
    quantidade: number; custo_unitario: number; motivo: string | null;
    observacoes: string | null; lote: string | null; validade: string | null;
  }) => Promise<boolean>;
}) {
  const localPrincipal = locais.find((l) => l.principal) ?? locais[0] ?? null
  const [produtoId, setProdutoId] = useState<string>(produtoInicial?.id ?? '')
  const [busca, setBusca] = useState<string>(produtoInicial?.nome ?? '')
  const [localId, setLocalId] = useState<string>(localPrincipal?.id ?? '')
  const [tipo, setTipo] = useState<string>('entrada')
  const [quantidade, setQuantidade] = useState<string>('')
  const [custo, setCusto] = useState<string>('')
  const [motivo, setMotivo] = useState<string>('')
  const [observacoes, setObservacoes] = useState<string>('')
  const [lote, setLote] = useState<string>('')
  const [validade, setValidade] = useState<string>('')
  const [salvando, setSalvando] = useState(false)

  const tipoCfg = TIPOS_MOV.find((t) => t.value === tipo)
  const isEntrada = tipoCfg?.sinal === '+'
  const produtosFiltrados = busca.trim().length >= 2
    ? produtos.filter((p) => (p.nome ?? '').toLowerCase().includes(busca.toLowerCase()) || (p.codigo ?? '').toLowerCase().includes(busca.toLowerCase())).slice(0, 20)
    : []
  const produtoSel = produtos.find((p) => p.id === produtoId) ?? null

  async function submit() {
    if (!produtoId || !tipo || !quantidade) return
    setSalvando(true)
    const ok = await onSubmit({
      produto_id: produtoId,
      local_id: localId || null,
      tipo,
      quantidade: parseFloat(quantidade) || 0,
      custo_unitario: parseFloat(custo) || 0,
      motivo: motivo || null,
      observacoes: observacoes || null,
      lote: lote || null,
      validade: validade || null,
    })
    setSalvando(false)
    if (ok) {
      // reset
      setQuantidade(''); setCusto(''); setMotivo(''); setObservacoes(''); setLote(''); setValidade('')
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Nova movimentação</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Tipo *">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inp}>
              {TIPOS_MOV.map((t) => <option key={t.value} value={t.value}>{t.sinal} {t.label}</option>)}
            </select>
          </Field>
          <Field label="Produto *">
            {produtoSel ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.goldBg }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{produtoSel.nome}</span>
                <span style={{ fontSize: 10, color: C.espressoM, fontFamily: 'monospace' }}>{produtoSel.codigo}</span>
                <button onClick={() => { setProdutoId(''); setBusca('') }} style={{ background: 'transparent', border: 'none', color: C.espressoM, cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            ) : (
              <>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite nome ou código (mín 2 chars)" style={inp} />
                {produtosFiltrados.length > 0 && (
                  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
                    {produtosFiltrados.map((p) => (
                      <button key={p.id} onClick={() => { setProdutoId(p.id); setBusca(p.nome) }} style={{ width: '100%', textAlign: 'left', padding: 8, border: 'none', borderBottom: `1px solid ${C.borderL}`, background: 'transparent', cursor: 'pointer', fontSize: 12 }} onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        <strong>{p.nome}</strong> {p.codigo && <span style={{ fontSize: 10, color: C.espressoM, fontFamily: 'monospace' }}>· {p.codigo}</span>}
                        <span style={{ float: 'right', fontSize: 11, color: C.espressoM }}>{fmtNum(Number(p.estoque_atual ?? 0))} {p.unidade}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Field>
          {locais.length > 0 && (
            <Field label="Local">
              <select value={localId} onChange={(e) => setLocalId(e.target.value)} style={inp}>
                <option value="">— Sem local específico —</option>
                {locais.filter((l) => l.ativo !== false).map((l) => <option key={l.id} value={l.id}>{l.nome}{l.principal ? ' ★' : ''}</option>)}
              </select>
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Quantidade *"><input type="number" step="0.01" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} style={inp} /></Field>
            {isEntrada && <Field label="Custo unitário"><input type="number" step="0.01" value={custo} onChange={(e) => setCusto(e.target.value)} style={inp} /></Field>}
          </div>
          <Field label="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={isEntrada ? 'Ex: Compra fornecedor X' : 'Ex: Venda balcão #4521'} style={inp} /></Field>
          {isEntrada && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Lote (opcional)"><input value={lote} onChange={(e) => setLote(e.target.value)} style={inp} /></Field>
              <Field label="Validade (opcional)"><input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} style={inp} /></Field>
            </div>
          )}
          <Field label="Observações"><textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} style={{ ...inp, resize: 'vertical' }} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnSec}>Cancelar</button>
          <button onClick={submit} disabled={salvando || !produtoId || !quantidade} style={{ ...btnPri, opacity: (salvando || !produtoId || !quantidade) ? 0.5 : 1 }}>
            {salvando ? 'Salvando…' : 'Confirmar movimentação'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Helpers visuais
// ════════════════════════════════════════════════════════════

function TabBtn({ ativo, onClick, icon, label, count }: { ativo: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} style={{ padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: ativo ? `2px solid ${C.gold}` : '2px solid transparent', color: ativo ? C.goldD : C.espressoM, fontWeight: ativo ? 700 : 500, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      {icon} {label}
      {typeof count === 'number' && <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: ativo ? C.goldBg : C.cream, color: ativo ? C.goldD : C.espressoM, fontWeight: 700 }}>{count}</span>}
    </button>
  )
}

function Badge({ cor, children }: { cor: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: cor + '22', color: cor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</span>
}

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
      <Boxes size={56} style={{ color: C.gold, opacity: 0.8 }} />
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{titulo}</h2>
      <p style={{ margin: 0, fontSize: 13, color: C.espressoM, maxWidth: 440, lineHeight: 1.5 }}>{texto}</p>
      {cta && <button onClick={cta.onClick} style={{ marginTop: 4, padding: '10px 18px', borderRadius: 8, border: 'none', background: C.gold, color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{cta.label}</button>}
    </div>
  )
}

function Kpi({ label, valor, sub, accent }: { label: string; valor: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: C.espressoL, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: accent ?? C.espresso, lineHeight: 1.1 }}>{valor}</span>
      {sub && <span style={{ fontSize: 11, color: C.espressoM }}>{sub}</span>}
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
  padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.espresso, fontSize: 12, fontWeight: 500, cursor: 'pointer',
}
const btnIcon: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer', color: C.espressoM, padding: 6, marginLeft: 4,
}
function btnPrincipal(enabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 8, border: 'none',
    background: enabled ? C.gold : C.cream,
    color: enabled ? '#FFF' : C.espressoL,
    fontSize: 12, fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
}
