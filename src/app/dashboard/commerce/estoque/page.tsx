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
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ProdutoAutocomplete, { type ProdutoSelecionado } from '@/components/comum/ProdutoAutocomplete'
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

type Tab = 'saldo' | 'locais' | 'produtos' | 'movimentacoes' | 'inventario' | 'abc'

// F2.2 · Inventarios
type Inventario = {
  id: string
  company_id: string
  numero: string | null
  local_id: string | null
  status: string | null
  data_inicio: string | null
  data_fim: string | null
  responsavel: string | null
  total_produtos: number | null
  total_contados: number | null
  total_divergencias: number | null
  valor_divergencia: number | null
  observacoes: string | null
  created_by: string | null
  fechado_por: string | null
  created_at: string | null
}

type InventarioItem = {
  id: string
  inventario_id: string
  company_id: string
  produto_id: string
  quantidade_sistema: number | null
  quantidade_contada: number | null
  diferenca: number | null
  custo_unitario: number | null
  valor_diferenca: number | null
  contado_em: string | null
  observacoes: string | null
}

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
  ref_id: string | null
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

  // FIX-ESTOQUE-DEEPLINK-ABAS-v1 · deep-link de aba via ?tab=
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const tabUrl = sp?.get('tab') ?? null
  const TAB_KEYS: Tab[] = ['saldo', 'movimentacoes', 'inventario', 'produtos', 'locais', 'abc']
  const initialTab: Tab = (TAB_KEYS as string[]).includes(tabUrl ?? '') ? (tabUrl as Tab) : 'saldo'
  const [tab, setTabState] = useState<Tab>(initialTab)

  // Sync state -> URL (preserva area= e demais query params)
  function setTab(nextTab: Tab) {
    setTabState(nextTab)
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(sp?.toString() ?? '')
    if (nextTab === 'saldo') params.delete('tab')
    else params.set('tab', nextTab)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // Sync URL -> state (back/forward + click no menu lateral com ?tab=)
  useEffect(() => {
    if (tabUrl && (TAB_KEYS as string[]).includes(tabUrl) && tabUrl !== tab) {
      setTabState(tabUrl as Tab)
    }
    if (!tabUrl && tab !== 'saldo') {
      setTabState('saldo')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabUrl])

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

  // F2.1 · Filtros saldo
  const [filtroSaldoProduto, setFiltroSaldoProduto] = useState('')
  const [filtroSaldoLocal, setFiltroSaldoLocal] = useState('')
  const [filtroSaldoSomenteComSaldo, setFiltroSaldoSomenteComSaldo] = useState(true)

  // Filtros movimentacoes
  const [filtroTipo, setFiltroTipo] = useState('')
  // F2.1 · novos filtros
  const hojeIso = new Date().toISOString().slice(0, 10)
  const trintaDiasAtrasIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [filtroMovInicio, setFiltroMovInicio] = useState(trintaDiasAtrasIso)
  const [filtroMovFim, setFiltroMovFim] = useState(hojeIso)
  const [filtroMovProduto, setFiltroMovProduto] = useState('')
  const [filtroMovLocal, setFiltroMovLocal] = useState('')
  const [filtroMovRefTipo, setFiltroMovRefTipo] = useState('')

  const [produtoSel, setProdutoSel] = useState<Produto | null>(null)
  const [localEdit, setLocalEdit] = useState<Local | 'new' | null>(null)
  const [showMovimentar, setShowMovimentar] = useState<{ produto?: Produto } | null>(null)
  // F2.2 · estados de ajuste/inventario
  const [showAjuste, setShowAjuste] = useState(false)
  const [showNovoInventario, setShowNovoInventario] = useState(false)
  const [inventarios, setInventarios] = useState<Inventario[]>([])
  const [inventarioSel, setInventarioSel] = useState<Inventario | null>(null)

  // FIX-VAZAMENTO-JORDANA (07/07): tela operacional — nunca consolida
  // multi-empresa. Gate estrito em companyIdUnico + .eq (era .in(companyIds)).
  const carregar = useCallback(async () => {
    if (!companyIdUnico) {
      setLocais([]); setProdutos([]); setMovimentacoes([]); setCurva([]); setInventarios([])
      return
    }
    setLoading(true)
    setErro('')
    const [loc, prod, mov, abc, inv] = await Promise.all([
      supabase.from('erp_estoque_locais').select('*').eq('company_id', companyIdUnico).order('principal', { ascending: false }).order('nome'),
      supabase.from('erp_produtos').select('id,company_id,codigo,nome,categoria,unidade,preco_venda,preco_custo,preco_custo_medio,estoque_atual,estoque_minimo,estoque_maximo,localizacao,ativo')
        .eq('company_id', companyIdUnico).eq('ativo', true).order('nome').limit(5000),
      supabase.from('erp_estoque_movimentacoes').select('*').eq('company_id', companyIdUnico).order('data_movimento', { ascending: false }).limit(300),
      supabase.rpc('fn_curva_abc_estoque', { p_company_ids: [companyIdUnico] }),
      supabase.from('erp_inventarios').select('*').eq('company_id', companyIdUnico).order('created_at', { ascending: false }).limit(50),
    ])
    if (loc.error) setErro('Locais: ' + loc.error.message)
    else setLocais((loc.data ?? []) as Local[])
    if (prod.error) setErro('Produtos: ' + prod.error.message)
    else setProdutos((prod.data ?? []) as Produto[])
    if (mov.error) setErro('Movimentações: ' + mov.error.message)
    else setMovimentacoes((mov.data ?? []) as Movimentacao[])
    if (abc.error) setErro('Curva ABC: ' + abc.error.message)
    else setCurva((abc.data ?? []) as CurvaABCRow[])
    if (inv.error) setErro('Inventários: ' + inv.error.message)
    else setInventarios((inv.data ?? []) as Inventario[])
    setLoading(false)
  }, [companyIdUnico])

  useEffect(() => {
    if (companiesLoading) return
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdUnico, companiesLoading])

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
    // F2.2 · usa RPC eleita (com usuario_id pra rastreio LGPD).
    // fn_movimentar_estoque ficou [DEPRECATED]. Lote/validade nao sao
    // passados aqui ainda (gap conhecido F2.3).
    if (!companyIdUnico) { flashErr('Selecione uma empresa específica.'); return false }
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.rpc('registrar_movimento_estoque', {
      p_company_id: companyIdUnico,
      p_produto_id: args.produto_id,
      p_tipo: args.tipo,
      p_quantidade: args.quantidade,
      p_custo_unitario: args.custo_unitario || 0,
      p_motivo: args.motivo,
      p_observacoes: args.observacoes,
      p_usuario_id: user?.id ?? null,
      p_local_id: args.local_id,
    })
    if (error) {
      flashErr('Não foi possível registrar a movimentação: ' + error.message)
      return false
    }
    flash('Movimentação criada · estoque atualizado.')
    setShowMovimentar(null)
    void carregar()
    return true
  }

  // F2.2 · cria ajuste de estoque via RPC eleita
  async function criarAjuste(args: {
    produto_id: string; local_id: string | null; positivo: boolean;
    quantidade: number; custo_unitario: number; motivo: string; observacoes: string | null;
  }) {
    if (!companyIdUnico) { flashErr('Selecione uma empresa específica.'); return false }
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.rpc('registrar_movimento_estoque', {
      p_company_id: companyIdUnico,
      p_produto_id: args.produto_id,
      p_tipo: args.positivo ? 'ajuste_positivo' : 'ajuste_negativo',
      p_quantidade: args.quantidade,
      p_custo_unitario: args.custo_unitario || 0,
      p_motivo: args.motivo,
      p_observacoes: args.observacoes,
      p_usuario_id: user?.id ?? null,
      p_local_id: args.local_id,
    })
    if (error) {
      flashErr('Não foi possível criar o ajuste: ' + error.message)
      return false
    }
    flash('Ajuste CRIADO · saldo atualizado.')
    setShowAjuste(false)
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

  // FIX-PRODUTOS-BUSCA-SERVERSIDE-v1 · server-side pagination + search pra TabProdutos
  // Reusa pattern do PR #262 (2 queries paralelas nome/codigo + dedup).
  // KGF tem 1725 produtos · cliente-side 500 perdia 1225 · OLEO codigo 576 (pos 1074)
  // ficava invisivel.
  const PRODUTOS_PAGE_SIZE = 100
  const [produtosSrv, setProdutosSrv] = useState<Produto[]>([])
  const [produtosSrvTotal, setProdutosSrvTotal] = useState(0)
  const [produtosSrvLoading, setProdutosSrvLoading] = useState(false)
  const [produtosSrvPage, setProdutosSrvPage] = useState(1)

  // Reset pagina quando filtros mudam
  useEffect(() => { setProdutosSrvPage(1) }, [filtroBusca, filtroCategoria, companyIdUnico])

  // Debounce 300ms · busca server-side
  useEffect(() => {
    if (!companyIdUnico) {
      setProdutosSrv([]); setProdutosSrvTotal(0)
      return
    }
    setProdutosSrvLoading(true)
    const handle = window.setTimeout(async () => {
      const t = filtroBusca.trim().replace(/[%,()]/g, '')
      const cols = 'id,company_id,codigo,nome,categoria,unidade,preco_venda,preco_custo,preco_custo_medio,estoque_atual,estoque_minimo,estoque_maximo,localizacao,ativo'
      function baseQuery() {
        // FIX-VAZAMENTO-JORDANA (07/07): busca de produtos idem — só empresa unica.
        // Caller garante companyIdUnico != null antes de disparar essa busca.
        let q = supabase.from('erp_produtos').select(cols, { count: 'exact' })
          .eq('company_id', companyIdUnico!).eq('ativo', true)
        if (filtroCategoria) q = q.eq('categoria', filtroCategoria)
        return q
      }
      try {
        if (t.length < 2) {
          // Sem termo · paginado por nome ASC com count exact
          const from = (produtosSrvPage - 1) * PRODUTOS_PAGE_SIZE
          const to = from + PRODUTOS_PAGE_SIZE - 1
          const res = await baseQuery().order('nome', { ascending: true }).range(from, to)
          if (res.error) throw res.error
          setProdutosSrv((res.data ?? []) as Produto[])
          setProdutosSrvTotal(res.count ?? 0)
        } else {
          // Com termo · 2 queries paralelas (nome / codigo) + dedup + top 100
          const [porNome, porCodigo] = await Promise.all([
            baseQuery().ilike('nome', `%${t}%`).order('nome').limit(PRODUTOS_PAGE_SIZE),
            baseQuery().ilike('codigo', `%${t}%`).order('nome').limit(PRODUTOS_PAGE_SIZE),
          ])
          if (porNome.error) throw porNome.error
          if (porCodigo.error) throw porCodigo.error
          const map = new Map<string, Produto>()
          for (const p of ((porNome.data ?? []) as Produto[])) map.set(p.id, p)
          for (const p of ((porCodigo.data ?? []) as Produto[])) if (!map.has(p.id)) map.set(p.id, p)
          const merged = Array.from(map.values()).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '')).slice(0, PRODUTOS_PAGE_SIZE)
          setProdutosSrv(merged)
          // total real = soma dos counts unicos (aprox) · usa maior dos dois pra estimativa
          setProdutosSrvTotal(Math.max(porNome.count ?? 0, porCodigo.count ?? 0, merged.length))
        }
      } catch (err) {
        setErro(err instanceof Error ? `Produtos: ${err.message}` : 'Erro ao buscar produtos')
      } finally {
        setProdutosSrvLoading(false)
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [companyIdUnico, filtroBusca, filtroCategoria, produtosSrvPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtro estoque aplicado client-side na pagina exibida
  const produtosSrvFiltradosEstoque = useMemo(() => {
    if (filtroEstoque === 'todos') return produtosSrv
    return produtosSrv.filter((p) => {
      const atual = Number(p.estoque_atual ?? 0)
      const min = Number(p.estoque_minimo ?? 0)
      const max = Number(p.estoque_maximo ?? 0)
      if (filtroEstoque === 'baixo' && atual >= min) return false
      if (filtroEstoque === 'zero' && atual !== 0) return false
      if (filtroEstoque === 'excedente' && (max === 0 || atual <= max)) return false
      return true
    })
  }, [produtosSrv, filtroEstoque])

  const movFiltradas = useMemo(() => {
    return movimentacoes.filter((m) => {
      if (filtroTipo && m.tipo !== filtroTipo) return false
      if (filtroMovProduto && m.produto_id !== filtroMovProduto) return false
      if (filtroMovLocal && m.local_id !== filtroMovLocal) return false
      if (filtroMovRefTipo && m.ref_tipo !== filtroMovRefTipo) return false
      if (m.data_movimento) {
        const d = (m.data_movimento ?? '').slice(0, 10)
        if (filtroMovInicio && d < filtroMovInicio) return false
        if (filtroMovFim && d > filtroMovFim) return false
      }
      return true
    })
  }, [movimentacoes, filtroTipo, filtroMovProduto, filtroMovLocal, filtroMovRefTipo, filtroMovInicio, filtroMovFim])

  const produtosPorId = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos])
  const locaisPorId = useMemo(() => Object.fromEntries(locais.map((l) => [l.id, l])), [locais])

  // FIX-F2.1-ABA-SALDO-v1 · usa RPC fn_curva_abc_estoque (ja carregada
  // em `curva`) como fonte unica de saldo. Antes derivava de movs+produtos
  // e dava 0/0/0 em prod. Tabela perdeu granularidade por local · RPC
  // nao retorna por local (gap conhecido · cf. F2.3 com fn_estoque_saldo_por_local).
  type SaldoRow = {
    produto_id: string; produto_nome: string; produto_codigo: string | null
    local_id: string | null; local_nome: string
    saldo: number; custo_medio: number; valor_total: number
    classe_abc: 'A' | 'B' | 'C' | null
  }
  const saldoRows = useMemo<SaldoRow[]>(() => {
    const principal = locais.find((l) => l.principal) ?? locais[0] ?? null
    return curva.map((r) => ({
      produto_id: r.produto_id,
      produto_nome: r.nome,
      produto_codigo: r.codigo,
      local_id: principal?.id ?? null,
      local_nome: principal?.nome ?? 'Estoque Principal',
      saldo: Number(r.estoque_atual ?? 0),
      custo_medio: Number(r.preco_custo_medio ?? 0),
      valor_total: Number(r.valor_total ?? 0),
      classe_abc: r.classe_abc ?? null,
    }))
  }, [curva, locais])

  const saldoFiltrado = useMemo(() => {
    const q = filtroSaldoProduto.trim().toLowerCase()
    return saldoRows.filter((r) => {
      if (filtroSaldoSomenteComSaldo && r.saldo <= 0) return false
      if (filtroSaldoLocal && r.local_id !== filtroSaldoLocal) return false
      if (q) {
        const hay = `${r.produto_nome} ${r.produto_codigo ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [saldoRows, filtroSaldoProduto, filtroSaldoLocal, filtroSaldoSomenteComSaldo])

  const saldoKpis = useMemo(() => {
    const totalSku = saldoRows.length
    const skusComSaldo = saldoRows.filter((r) => r.saldo > 0).length
    const skusZerados = saldoRows.filter((r) => r.saldo <= 0).length
    const valorImobilizado = saldoRows.reduce((s, r) => s + r.valor_total, 0)
    return { totalSku, skusComSaldo, skusZerados, valorImobilizado }
  }, [saldoRows])

  // F2.1 · ref_tipos unicos pro filtro de movimentacoes
  const refTiposUnicos = useMemo(() => {
    const set = new Set<string>()
    movimentacoes.forEach((m) => { if (m.ref_tipo) set.add(m.ref_tipo) })
    return Array.from(set).sort()
  }, [movimentacoes])

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
        {(tab === 'saldo' || tab === 'movimentacoes') && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowAjuste(true)}
              disabled={!canCreate || locais.length === 0 || produtos.length === 0}
              title={!canCreate ? 'Selecione uma empresa específica' : (locais.length === 0 ? 'Cadastre um local primeiro' : '')}
              data-testid="estoque-nova-mov-btn"
              style={btnPrincipal(canCreate && locais.length > 0 && produtos.length > 0)}>
              <Plus size={14} /> Nova Movimentação
            </button>
          </div>
        )}
        {tab === 'inventario' && (
          <button
            onClick={() => setShowNovoInventario(true)}
            disabled={!canCreate || locais.length === 0 || produtos.length === 0}
            title={!canCreate ? 'Selecione uma empresa específica' : (locais.length === 0 ? 'Cadastre um local primeiro' : '')}
            data-testid="estoque-inventario-btn"
            style={btnPrincipal(canCreate && locais.length > 0 && produtos.length > 0)}>
            📋 Iniciar inventário
          </button>
        )}
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
        <TabBtn ativo={tab === 'saldo'} onClick={() => setTab('saldo')} icon={<Boxes size={14} />} label="Saldo" count={saldoRows.length} />
        <TabBtn ativo={tab === 'movimentacoes'} onClick={() => setTab('movimentacoes')} icon={<ArrowRightLeft size={14} />} label="Movimentações" count={movimentacoes.length} />
        <TabBtn ativo={tab === 'inventario'} onClick={() => setTab('inventario')} icon={<Package size={14} />} label="Inventário" count={inventarios.length} />
        <TabBtn ativo={tab === 'produtos'} onClick={() => setTab('produtos')} icon={<Package size={14} />} label="Produtos" count={produtos.length} />
        <TabBtn ativo={tab === 'locais'} onClick={() => setTab('locais')} icon={<Boxes size={14} />} label="Locais" count={locais.length} />
        <TabBtn ativo={tab === 'abc'} onClick={() => setTab('abc')} icon={<BarChart3 size={14} />} label="Curva ABC" />
      </div>

      {/* FIX-VAZAMENTO-JORDANA (07/07): NAO consolida multi-empresa */}
      {selInfo.tipo !== 'empresa' && companyIds.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, color: C.amber, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={14} />
          <span>Selecione uma empresa específica no menu superior. Estoque é operacional por empresa — não exibe dados consolidados.</span>
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
      ) : !companyIdUnico ? (
        <EmptyState titulo="Selecione uma empresa" texto="Estoque é operacional por empresa. Escolha uma empresa específica no menu superior." />
      ) : tab === 'saldo' ? (
        <TabSaldo
          rows={saldoFiltrado} total={saldoRows.length} kpis={saldoKpis}
          locais={locais} produtos={produtos}
          filtroSaldoProduto={filtroSaldoProduto} setFiltroSaldoProduto={setFiltroSaldoProduto}
          filtroSaldoLocal={filtroSaldoLocal} setFiltroSaldoLocal={setFiltroSaldoLocal}
          filtroSaldoSomenteComSaldo={filtroSaldoSomenteComSaldo} setFiltroSaldoSomenteComSaldo={setFiltroSaldoSomenteComSaldo}
        />
      ) : tab === 'locais' ? (
        <TabLocais locais={locais} onEdit={(l) => setLocalEdit(l)} onDelete={deletarLocal} canCreate={canCreate} onCreate={() => setLocalEdit('new')} />
      ) : tab === 'produtos' ? (
        <TabProdutos
          rows={produtosSrvFiltradosEstoque}
          total={produtosSrvTotal}
          loading={produtosSrvLoading}
          categorias={categoriasUnicas}
          filtroBusca={filtroBusca} setFiltroBusca={setFiltroBusca}
          filtroCategoria={filtroCategoria} setFiltroCategoria={setFiltroCategoria}
          filtroEstoque={filtroEstoque} setFiltroEstoque={setFiltroEstoque}
          page={produtosSrvPage} setPage={setProdutosSrvPage} pageSize={PRODUTOS_PAGE_SIZE}
          buscando={filtroBusca.trim().length >= 2}
          onSelect={setProdutoSel}
        />
      ) : tab === 'movimentacoes' ? (
        <TabMovimentacoes
          rows={movFiltradas} total={movimentacoes.length}
          filtroTipo={filtroTipo} setFiltroTipo={setFiltroTipo}
          locais={locais} produtos={produtos}
          refTiposUnicos={refTiposUnicos}
          filtroMovProduto={filtroMovProduto} setFiltroMovProduto={setFiltroMovProduto}
          filtroMovLocal={filtroMovLocal} setFiltroMovLocal={setFiltroMovLocal}
          filtroMovRefTipo={filtroMovRefTipo} setFiltroMovRefTipo={setFiltroMovRefTipo}
          filtroMovInicio={filtroMovInicio} setFiltroMovInicio={setFiltroMovInicio}
          filtroMovFim={filtroMovFim} setFiltroMovFim={setFiltroMovFim}
          produtosPorId={produtosPorId} locaisPorId={locaisPorId}
        />
      ) : tab === 'inventario' ? (
        <TabInventario rows={inventarios} locaisPorId={locaisPorId} onSelect={setInventarioSel} />
      ) : (
        <TabCurvaABC rows={curva} />
      )}

      {/* F2.2 · Modal Ajuste */}
      {showAjuste && companyIdUnico && (
        <ModalAjuste
          companyId={companyIdUnico}
          locais={locais}
          movimentacoes={movimentacoes}
          onClose={() => setShowAjuste(false)}
          onSubmit={criarAjuste}
        />
      )}

      {/* F2.2 · Modal Novo Inventario */}
      {showNovoInventario && companyIdUnico && (
        <ModalNovoInventario
          companyId={companyIdUnico}
          locais={locais}
          onClose={() => setShowNovoInventario(false)}
          onCreated={async (inventarioId) => {
            setShowNovoInventario(false)
            await carregar()
            const inv = inventarios.find((x) => x.id === inventarioId)
            if (inv) setInventarioSel(inv)
            else {
              const r = (await supabase.from('erp_inventarios').select('*').eq('id', inventarioId).single()).data as Inventario | null
              if (r) setInventarioSel(r)
            }
            flash('Inventário CRIADO.')
            setTab('inventario')
          }}
          flashErr={flashErr}
        />
      )}

      {/* F2.2 · Drawer Inventario (contar + fechar) */}
      {inventarioSel && (
        <DrawerInventario
          inventario={inventarioSel}
          produtos={produtos}
          locaisPorId={locaisPorId}
          onClose={() => setInventarioSel(null)}
          onFechado={async () => {
            await carregar()
            setInventarioSel(null)
            flash('Inventário FECHADO · ajustes gerados.')
          }}
          flash={flash}
          flashErr={flashErr}
        />
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

function TabProdutos({ rows, total, loading, categorias, filtroBusca, setFiltroBusca, filtroCategoria, setFiltroCategoria, filtroEstoque, setFiltroEstoque, page, setPage, pageSize, buscando, onSelect }: {
  rows: Produto[]; total: number; loading: boolean; categorias: string[];
  filtroBusca: string; setFiltroBusca: (v: string) => void;
  filtroCategoria: string; setFiltroCategoria: (v: string) => void;
  filtroEstoque: 'todos' | 'baixo' | 'zero' | 'excedente'; setFiltroEstoque: (v: 'todos' | 'baixo' | 'zero' | 'excedente') => void;
  page: number; setPage: (n: number) => void; pageSize: number;
  buscando: boolean;
  onSelect: (p: Produto) => void;
}) {
  // FIX-PRODUTOS-BUSCA-SERVERSIDE-v1 · paginacao real (sem teto cego de 500)
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))
  const inicio = buscando ? 1 : (page - 1) * pageSize + 1
  const fim = buscando ? rows.length : Math.min(page * pageSize, total)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }} />
          <input type="text" placeholder="Buscar por nome ou código (busca em todo cadastro)…" value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)}
            data-testid="produtos-busca" style={{ width: '100%', padding: '8px 10px 8px 32px', minHeight: 44, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.white, color: C.espresso, outline: 'none' }} />
        </div>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} style={{ ...selInpStyle, minHeight: 44 }}>
          <option value="">Todas as categorias</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtroEstoque} onChange={(e) => setFiltroEstoque(e.target.value as 'todos' | 'baixo' | 'zero' | 'excedente')} style={{ ...selInpStyle, minHeight: 44 }}>
          <option value="todos">Todos os estoques</option>
          <option value="baixo">Abaixo do mínimo</option>
          <option value="zero">Estoque zerado</option>
          <option value="excedente">Acima do máximo</option>
        </select>
        <span data-testid="produtos-contador" style={{ marginLeft: 'auto', fontSize: 11, color: C.espressoM, fontWeight: 600 }}>
          {loading ? 'Buscando…' : buscando
            ? `${rows.length} resultado(s) de busca`
            : `${inicio}–${fim} de ${total}`}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: C.gold, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Buscando produtos…</div>
      ) : rows.length === 0 ? (
        total === 0 && !buscando
          ? <EmptyState titulo="Nenhum produto cadastrado" texto="Os produtos vêm de erp_produtos (cadastro fiscal completo). Importe via Importar Dados ou cadastre manualmente." />
          : <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>
              {buscando ? `Nenhum produto encontrado para "${filtroBusca.trim()}".` : 'Nenhum produto corresponde aos filtros.'}
            </div>
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
          {!buscando && totalPaginas > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderTop: `1px solid ${C.borderL}`, background: C.cream, fontSize: 12 }}>
              <div style={{ color: C.espressoM }}>Página <strong>{page}</strong> de <strong>{totalPaginas}</strong></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))} data-testid="produtos-pag-anterior"
                  style={{ ...btnSec, padding: '6px 12px', opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>← Anterior</button>
                <button type="button" disabled={page >= totalPaginas} onClick={() => setPage(Math.min(totalPaginas, page + 1))} data-testid="produtos-pag-proximo"
                  style={{ ...btnSec, padding: '6px 12px', opacity: page >= totalPaginas ? 0.4 : 1, cursor: page >= totalPaginas ? 'not-allowed' : 'pointer' }}>Próximo →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TabMovimentacoes({ rows, total, filtroTipo, setFiltroTipo, produtosPorId, locaisPorId,
  locais, produtos, refTiposUnicos,
  filtroMovProduto, setFiltroMovProduto, filtroMovLocal, setFiltroMovLocal,
  filtroMovRefTipo, setFiltroMovRefTipo,
  filtroMovInicio, setFiltroMovInicio, filtroMovFim, setFiltroMovFim,
}: {
  rows: Movimentacao[]; total: number;
  filtroTipo: string; setFiltroTipo: (v: string) => void;
  locais: Local[]; produtos: Produto[];
  refTiposUnicos: string[];
  filtroMovProduto: string; setFiltroMovProduto: (v: string) => void;
  filtroMovLocal: string; setFiltroMovLocal: (v: string) => void;
  filtroMovRefTipo: string; setFiltroMovRefTipo: (v: string) => void;
  filtroMovInicio: string; setFiltroMovInicio: (v: string) => void;
  filtroMovFim: string; setFiltroMovFim: (v: string) => void;
  produtosPorId: Record<string, Produto>; locaisPorId: Record<string, Local>;
}) {
  function refHref(ref_tipo: string | null, ref_id: string | null): string | null {
    if (!ref_id) return null
    if (ref_tipo === 'compra') return `/dashboard/commerce/compras?area=gestao_empresarial`
    if (ref_tipo === 'venda') return `/dashboard/commerce/otc?area=gestao_empresarial`
    return null
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          De
          <input type="date" value={filtroMovInicio} onChange={(e) => setFiltroMovInicio(e.target.value)} style={selInpStyle} />
        </label>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Até
          <input type="date" value={filtroMovFim} onChange={(e) => setFiltroMovFim(e.target.value)} style={selInpStyle} />
        </label>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Tipo
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={selInpStyle}>
            <option value="">Todos</option>
            {TIPOS_MOV.map((t) => <option key={t.value} value={t.value}>{t.sinal} {t.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Produto
          <select value={filtroMovProduto} onChange={(e) => setFiltroMovProduto(e.target.value)} style={selInpStyle}>
            <option value="">Todos</option>
            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Local
          <select value={filtroMovLocal} onChange={(e) => setFiltroMovLocal(e.target.value)} style={selInpStyle}>
            <option value="">Todos</option>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Origem
          <select value={filtroMovRefTipo} onChange={(e) => setFiltroMovRefTipo(e.target.value)} style={selInpStyle}>
            <option value="">Todas</option>
            {refTiposUnicos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div style={{ fontSize: 11, color: C.espressoM, paddingLeft: 4 }}>{rows.length} de {total} movimento(s)</div>

      {rows.length === 0 ? (
        total === 0
          ? <EmptyState titulo="Nenhuma movimentação registrada" texto="Movimentações chegam aqui automaticamente quando você cria compras, vendas ou ajustes." />
          : <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhuma movimentação no período.</div>
      ) : (
        <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
              <thead style={{ background: C.cream }}>
                <tr><Th>Data</Th><Th>Tipo</Th><Th>Produto</Th><Th>Local</Th><Th align="right">Quantidade</Th><Th align="right">Custo un.</Th><Th align="right">Valor total</Th><Th>Origem</Th></tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const t = TIPOS_MOV.find((x) => x.value === m.tipo)
                  const sinal = t?.sinal ?? '='
                  const cor = sinal === '+' ? C.green : sinal === '-' ? C.red : C.amber
                  const prod = produtosPorId[m.produto_id]
                  const local = m.local_id ? locaisPorId[m.local_id] : null
                  const origemHref = refHref(m.ref_tipo ?? null, m.ref_id ?? null)
                  const origemLabel = m.ref_tipo ? `${m.ref_tipo} ${m.ref_numero ?? ''}`.trim() : (m.motivo ?? '—')
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
                      <Td align="right">{Number(m.custo_unitario) > 0 ? fmtBRL(Number(m.custo_unitario)) : '—'}</Td>
                      <Td align="right">{Number(m.valor_total) > 0 ? fmtBRL(Number(m.valor_total)) : '—'}</Td>
                      <Td>
                        {origemHref ? (
                          <a href={origemHref} style={{ color: C.gold, textDecoration: 'underline', fontSize: 11 }}>{origemLabel}</a>
                        ) : (
                          <span style={{ fontSize: 11, color: C.espressoM }}>{origemLabel}</span>
                        )}
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

// F2.1 · Tab Saldo · KPIs + filtros + tabela
function TabSaldo({
  rows, total, kpis, locais, produtos,
  filtroSaldoProduto, setFiltroSaldoProduto,
  filtroSaldoLocal, setFiltroSaldoLocal,
  filtroSaldoSomenteComSaldo, setFiltroSaldoSomenteComSaldo,
}: {
  rows: { produto_id: string; produto_nome: string; produto_codigo: string | null;
    local_id: string | null; local_nome: string; saldo: number; custo_medio: number; valor_total: number;
    classe_abc?: 'A' | 'B' | 'C' | null }[];
  total: number;
  kpis: { totalSku: number; skusComSaldo: number; skusZerados: number; valorImobilizado: number };
  locais: Local[]; produtos: Produto[];
  filtroSaldoProduto: string; setFiltroSaldoProduto: (v: string) => void;
  filtroSaldoLocal: string; setFiltroSaldoLocal: (v: string) => void;
  filtroSaldoSomenteComSaldo: boolean; setFiltroSaldoSomenteComSaldo: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <KpiCard label="Valor imobilizado" valor={fmtBRL(kpis.valorImobilizado)} cor={C.gold} destaque />
        <KpiCard label="SKUs com saldo" valor={String(kpis.skusComSaldo)} cor={C.green} />
        <KpiCard label="SKUs zerados" valor={String(kpis.skusZerados)} cor={C.amber} />
        <KpiCard label="Total SKUs" valor={String(kpis.totalSku)} cor={C.espresso} />
      </div>

      {/* Filtros */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Produto
          <input
            type="text"
            value={filtroSaldoProduto}
            onChange={(e) => setFiltroSaldoProduto(e.target.value)}
            placeholder="Buscar por nome ou código"
            style={selInpStyle}
            list="saldo-produtos-list"
            data-testid="saldo-filtro-produto"
          />
          <datalist id="saldo-produtos-list">
            {produtos.map((p) => <option key={p.id} value={p.nome} />)}
          </datalist>
        </label>
        <label style={{ fontSize: 11, color: C.espressoM, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Local
          <select value={filtroSaldoLocal} onChange={(e) => setFiltroSaldoLocal(e.target.value)} style={selInpStyle} data-testid="saldo-filtro-local">
            <option value="">Todos os locais</option>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.espresso, display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'end', paddingBottom: 8 }}>
          <input
            type="checkbox"
            checked={filtroSaldoSomenteComSaldo}
            onChange={(e) => setFiltroSaldoSomenteComSaldo(e.target.checked)}
            data-testid="saldo-filtro-com-saldo"
          />
          Só com saldo
        </label>
      </div>

      <div style={{ fontSize: 11, color: C.espressoM, paddingLeft: 4 }}>{rows.length} de {total} linha(s)</div>

      {rows.length === 0 ? (
        total === 0
          ? <EmptyState titulo="Sem saldo no estoque" texto="Quando você receber a primeira compra, o estoque aparece aqui." />
          : <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13, background: C.offWhite, border: `1px dashed ${C.border}`, borderRadius: 10 }}>Nenhum item bate com os filtros.</div>
      ) : (
        <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
              <thead style={{ background: C.cream }}>
                <tr>
                  <Th>Produto</Th>
                  <Th>Local</Th>
                  <Th align="right">Saldo</Th>
                  <Th align="right">Custo médio</Th>
                  <Th align="right">Valor total</Th>
                  <Th>Classe</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const corClasse = r.classe_abc === 'A' ? C.gold : r.classe_abc === 'B' ? C.blue : C.espressoM
                  return (
                    <tr key={`${r.produto_id}|${r.local_id ?? ''}`} style={{ borderTop: `1px solid ${C.borderL}` }} data-testid="saldo-row">
                      <Td>
                        <div style={{ fontWeight: 600 }}>{r.produto_nome}</div>
                        {r.produto_codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace' }}>{r.produto_codigo}</span>}
                      </Td>
                      <Td>{r.local_nome}</Td>
                      <Td align="right"><strong style={{ color: r.saldo > 0 ? C.green : C.espressoL }}>{fmtNum(r.saldo)}</strong></Td>
                      <Td align="right">{r.custo_medio > 0 ? fmtBRL(r.custo_medio) : '—'}</Td>
                      <Td align="right"><strong>{r.valor_total > 0 ? fmtBRL(r.valor_total) : '—'}</strong></Td>
                      <Td>
                        {r.classe_abc ? (
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: corClasse + '20', color: corClasse, fontWeight: 700 }}>{r.classe_abc}</span>
                        ) : <span style={{ color: C.espressoL }}>—</span>}
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

function KpiCard({ label, valor, cor, destaque }: { label: string; valor: string; cor: string; destaque?: boolean }) {
  return (
    <div style={{
      background: destaque ? '#FDF7E8' : C.white,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${cor}`,
      borderRadius: 10,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
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

// ════════════════════════════════════════════════════════════
// F2.2 · ModalAjuste — focado em ajustes positivo/negativo
// ════════════════════════════════════════════════════════════

function ModalAjuste({ companyId, locais, movimentacoes, onClose, onSubmit }: {
  companyId: string
  locais: Local[]
  movimentacoes: Movimentacao[]
  onClose: () => void
  onSubmit: (args: { produto_id: string; local_id: string | null; positivo: boolean;
    quantidade: number; custo_unitario: number; motivo: string; observacoes: string | null }) => Promise<boolean>
}) {
  // FIX-PRODUTO-AUTOCOMPLETE-REUSE-262-v1 · usa componente compartilhado
  // (server-side · acaba com filtro client-side fragil)
  const [produtoSel, setProdutoSel] = useState<ProdutoSelecionado | null>(null)
  const localPrincipal = locais.find((l) => l.principal) ?? locais[0] ?? null
  const [localId, setLocalId] = useState<string>(localPrincipal?.id ?? '')
  const [positivo, setPositivo] = useState(true)
  const [quantidade, setQuantidade] = useState('')
  const [custo, setCusto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Saldo atual do produto (no local escolhido se possivel; senao estoque_atual do produto)
  const saldoAtual = useMemo(() => {
    if (!produtoSel) return null
    for (const m of movimentacoes) {
      if (m.produto_id !== produtoSel.id) continue
      if (localId && m.local_id && m.local_id !== localId) continue
      return Number(m.quantidade_depois ?? 0)
    }
    return Number(produtoSel.estoque_atual ?? 0)
  }, [produtoSel, localId, movimentacoes])

  // Quando seleciona produto, preenche custo sugerido
  function aoSelecionar(p: ProdutoSelecionado) {
    setProdutoSel(p)
    if (!custo) {
      const c = Number(p.preco_custo_medio ?? p.preco_custo ?? 0)
      if (c > 0) setCusto(c.toFixed(2).replace('.', ','))
    }
  }

  const qtdN = Number(quantidade.replace(',', '.')) || 0
  const custoN = Number(custo.replace(',', '.')) || 0
  const saldoFinal = saldoAtual != null ? (positivo ? saldoAtual + qtdN : saldoAtual - qtdN) : null

  async function salvar() {
    setErro(null)
    if (!produtoSel) { setErro('Escolha um produto da lista.'); return }
    if (!localId) { setErro('Escolha o local.'); return }
    if (qtdN <= 0) { setErro('Quantidade deve ser maior que zero.'); return }
    if (!motivo.trim()) { setErro('Informe o motivo do ajuste.'); return }
    if (!positivo && saldoAtual != null && qtdN > saldoAtual) {
      setErro(`Não dá pra ajustar -${qtdN}: saldo atual é ${saldoAtual}.`); return
    }
    setSalvando(true)
    const ok = await onSubmit({
      produto_id: produtoSel.id,
      local_id: localId || null,
      positivo, quantidade: qtdN, custo_unitario: custoN,
      motivo: motivo.trim(), observacoes: obs.trim() || null,
    })
    setSalvando(false)
    if (!ok) setErro('Falha ao salvar ajuste.')
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !salvando) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 22, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Ajuste de estoque</h3>
          <button onClick={onClose} disabled={salvando} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Produto · componente compartilhado FIX-PRODUTO-AUTOCOMPLETE-REUSE-262-v1 */}
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Produto *</label>
            <div style={{ marginTop: 4 }}>
              <ProdutoAutocomplete
                companyId={companyId}
                selecionado={produtoSel}
                onSelect={aoSelecionar}
                onClear={() => setProdutoSel(null)}
                autoFocus
                testId="ajuste-prod"
                detalheSelecionado={(p) => saldoAtual != null
                  ? (<>Saldo atual: <strong>{fmtNum(saldoAtual)} {p.unidade ?? ''}</strong></>)
                  : null}
              />
            </div>
          </div>

          {/* Local */}
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Local *</label>
            <select value={localId} onChange={(e) => setLocalId(e.target.value)} data-testid="ajuste-local"
              style={{ ...selInpStyle, marginTop: 4, width: '100%' }}>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>

          {/* Tipo · radio */}
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Tipo *</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setPositivo(true)} data-testid="ajuste-tipo-pos"
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, border: `1.5px solid ${positivo ? C.green : C.border}`,
                  background: positivo ? '#ECFDF5' : '#fff', color: positivo ? '#047857' : C.espresso, fontWeight: 600, cursor: 'pointer', fontSize: 13,
                }}>
                + Positivo (entrou estoque)
              </button>
              <button type="button" onClick={() => setPositivo(false)} data-testid="ajuste-tipo-neg"
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, border: `1.5px solid ${!positivo ? C.red : C.border}`,
                  background: !positivo ? '#FEE2E2' : '#fff', color: !positivo ? '#B91C1C' : C.espresso, fontWeight: 600, cursor: 'pointer', fontSize: 13,
                }}>
                – Negativo (perda/saída)
              </button>
            </div>
          </div>

          {/* Qtd + Custo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Quantidade *</label>
              <input type="text" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="0"
                data-testid="ajuste-qtd" style={{ ...selInpStyle, marginTop: 4, width: '100%', textAlign: 'right' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Custo unitário</label>
              <input type="text" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="0,00"
                data-testid="ajuste-custo" style={{ ...selInpStyle, marginTop: 4, width: '100%', textAlign: 'right' }} />
            </div>
          </div>

          {/* Preview */}
          {produtoSel && saldoAtual != null && qtdN > 0 && (
            <div style={{ padding: 10, background: C.cream, borderRadius: 8, fontSize: 12, color: C.espresso }}>
              Saldo atual: <strong>{fmtNum(saldoAtual)}</strong> → Saldo após ajuste: <strong style={{ color: positivo ? C.green : C.red }}>{fmtNum(saldoFinal ?? 0)}</strong>
            </div>
          )}

          {/* Motivo */}
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Motivo *</label>
            <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: avaria · encontrado no fundo · contagem física"
              data-testid="ajuste-motivo" style={{ ...selInpStyle, marginTop: 4, width: '100%' }} />
          </div>

          {/* Observacoes */}
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Observações</label>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
              style={{ ...selInpStyle, marginTop: 4, width: '100%', resize: 'vertical' }} />
          </div>

          {erro && (
            <div style={{ padding: 10, background: C.redBg, border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 12 }}>{erro}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            <button type="button" onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
            <button type="button" onClick={salvar} disabled={salvando || !produtoSel || qtdN <= 0 || !motivo.trim()}
              data-testid="ajuste-salvar" style={btnPrincipal(!salvando && !!produtoSel && qtdN > 0 && !!motivo.trim())}>
              {salvando ? 'Salvando…' : 'Criar ajuste'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// F2.2 · Tab Inventário (lista) + Modal Novo Inventário
// ════════════════════════════════════════════════════════════

function TabInventario({ rows, locaisPorId, onSelect }: {
  rows: Inventario[]; locaisPorId: Record<string, Local>; onSelect: (i: Inventario) => void
}) {
  if (rows.length === 0) {
    return <EmptyState titulo="Nenhum inventário ainda" texto="Use o botão Iniciar inventário pra fazer a contagem física e gerar ajustes automaticamente pelas diferenças." />
  }
  return (
    <div style={{ background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
          <thead style={{ background: C.cream }}>
            <tr><Th>Número</Th><Th>Local</Th><Th>Status</Th><Th>Início</Th><Th>Fim</Th><Th align="right">Itens</Th><Th align="right">Divergências</Th></tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const corStatus = i.status === 'fechado' ? C.green : i.status === 'em_andamento' ? C.blue : C.espressoM
              const local = i.local_id ? locaisPorId[i.local_id] : null
              return (
                <tr key={i.id} onClick={() => onSelect(i)} data-testid="inventario-row"
                  style={{ cursor: 'pointer', borderTop: `1px solid ${C.borderL}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.cream)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <Td><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{i.numero ?? '—'}</span></Td>
                  <Td>{local?.nome ?? '—'}</Td>
                  <Td>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: corStatus + '20', color: corStatus, fontWeight: 700, textTransform: 'uppercase' }}>
                      {i.status ?? '—'}
                    </span>
                  </Td>
                  <Td>{i.data_inicio ? new Date(i.data_inicio).toLocaleDateString('pt-BR') : '—'}</Td>
                  <Td>{i.data_fim ? new Date(i.data_fim).toLocaleDateString('pt-BR') : '—'}</Td>
                  <Td align="right">{i.total_produtos ?? 0}</Td>
                  <Td align="right"><strong style={{ color: (i.total_divergencias ?? 0) > 0 ? C.amber : C.espressoL }}>{i.total_divergencias ?? 0}</strong></Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ModalNovoInventario({ companyId, locais, onClose, onCreated, flashErr }: {
  companyId: string; locais: Local[];
  onClose: () => void; onCreated: (id: string) => void | Promise<void>;
  flashErr: (m: string) => void
}) {
  const principal = locais.find((l) => l.principal) ?? locais[0] ?? null
  const [localId, setLocalId] = useState<string>(principal?.id ?? '')
  const [obs, setObs] = useState('')
  const [categoria, setCategoria] = useState('')
  const [marca, setMarca] = useState('')
  const [salvando, setSalvando] = useState(false)

  // FIX-INVENTARIO-INICIAR-SALDO-v1
  // Fonte unica de verdade: erp_produtos.estoque_atual GLOBAL (mesma fonte
  // da aba Saldo · fn_curva_abc_estoque). NAO usar texto localizacao nem
  // depender de produtos do parent (pode estar paginado/stale).
  // Sistema single-local por enquanto · saldo por local fica pra depois
  // quando houver multi-deposito real (deriva por local_id das movimentacoes).
  const [universo, setUniverso] = useState<Produto[]>([])
  const [carregandoUniv, setCarregandoUniv] = useState(false)

  useEffect(() => {
    if (!companyId) { setUniverso([]); return }
    setCarregandoUniv(true)
    let cancelado = false
    void (async () => {
      const cols = 'id,company_id,codigo,nome,categoria,unidade,preco_venda,preco_custo,preco_custo_medio,estoque_atual,estoque_minimo,estoque_maximo,localizacao,ativo'
      const { data } = await supabase.from('erp_produtos').select(cols)
        .eq('company_id', companyId).eq('ativo', true).gt('estoque_atual', 0)
        .order('nome').limit(10000)
      if (cancelado) return
      setUniverso((data ?? []) as Produto[])
      setCarregandoUniv(false)
    })()
    return () => { cancelado = true }
  }, [companyId])

  const categorias = useMemo(() => Array.from(new Set(universo.map((p) => p.categoria).filter(Boolean) as string[])).sort(), [universo])
  const marcasUnique = useMemo(() => Array.from(new Set(universo.map((p) => (p as Produto & { marca?: string | null }).marca).filter(Boolean) as string[])).sort(), [universo])

  // Snapshot: estoque_atual GLOBAL > 0 + filtros opcionais.
  const snapshot = useMemo(() => {
    return universo.filter((p) => {
      if (Number(p.estoque_atual ?? 0) <= 0) return false
      if (categoria && p.categoria !== categoria) return false
      if (marca && (p as Produto & { marca?: string | null }).marca !== marca) return false
      return true
    })
  }, [universo, categoria, marca])

  async function criar() {
    if (!localId) { flashErr('Escolha o local.'); return }
    if (snapshot.length === 0) { flashErr('Nenhum produto pra inventariar com os filtros.'); return }
    setSalvando(true)
    try {
      // Numero
      const { data: numero } = await supabase.rpc('next_inventario_numero', { p_company_id: companyId })
      const { data: { user } } = await supabase.auth.getUser()
      const { data: inv, error: e1 } = await supabase.from('erp_inventarios').insert({
        company_id: companyId,
        numero: numero ?? `INV-${Date.now().toString().slice(-6)}`,
        local_id: localId,
        status: 'em_andamento',
        data_inicio: new Date().toISOString().slice(0, 10),
        responsavel: user?.email ?? null,
        total_produtos: snapshot.length,
        observacoes: obs.trim() || null,
        created_by: user?.id ?? null,
      }).select('id').single()
      if (e1 || !inv) throw new Error(e1?.message ?? 'Falha ao criar inventário')

      const itens = snapshot.map((p) => ({
        inventario_id: inv.id,
        company_id: companyId,
        produto_id: p.id,
        quantidade_sistema: Number(p.estoque_atual ?? 0),
        custo_unitario: Number(p.preco_custo_medio ?? p.preco_custo ?? 0),
      }))
      const { error: e2 } = await supabase.from('erp_inventario_itens').insert(itens)
      if (e2) throw new Error(e2.message)
      await onCreated(inv.id)
    } catch (err) {
      flashErr(err instanceof Error ? err.message : 'Erro ao criar inventário')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !salvando) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.offWhite, borderRadius: 12, padding: 22, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>📋 Iniciar inventário</h3>
          <button onClick={onClose} disabled={salvando} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Local *</label>
            <select value={localId} onChange={(e) => setLocalId(e.target.value)} style={{ ...selInpStyle, marginTop: 4, width: '100%' }}>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          {categorias.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Filtrar categoria (opc.)</label>
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ ...selInpStyle, marginTop: 4, width: '100%' }}>
                  <option value="">Todas</option>
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Filtrar marca (opc.)</label>
                <select value={marca} onChange={(e) => setMarca(e.target.value)} style={{ ...selInpStyle, marginTop: 4, width: '100%' }}>
                  <option value="">Todas</option>
                  {marcasUnique.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: C.espressoM, fontWeight: 600 }}>Observações</label>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
              style={{ ...selInpStyle, marginTop: 4, width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ padding: 10, background: C.goldBg, borderRadius: 8, fontSize: 12, color: C.goldD }}>
            {carregandoUniv
              ? 'Carregando produtos com saldo…'
              : <>Vai inventariar <strong>{snapshot.length}</strong> produto(s) com saldo &gt; 0.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            <button type="button" onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
            <button type="button" onClick={criar} disabled={salvando || carregandoUniv || snapshot.length === 0} data-testid="inventario-criar"
              style={btnPrincipal(!salvando && !carregandoUniv && snapshot.length > 0)}>
              {salvando ? 'Criando…' : 'Criar inventário'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DrawerInventario({ inventario, produtos, locaisPorId, onClose, onFechado, flash, flashErr }: {
  inventario: Inventario
  produtos: Produto[]
  locaisPorId: Record<string, Local>
  onClose: () => void
  onFechado: () => void | Promise<void>
  flash: (m: string) => void
  flashErr: (m: string) => void
}) {
  const [itens, setItens] = useState<InventarioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [salvandoIdx, setSalvandoIdx] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)
  const fechado = inventario.status === 'fechado'
  const produtosPorId = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos])
  const local = inventario.local_id ? locaisPorId[inventario.local_id] : null

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('erp_inventario_itens')
        .select('*').eq('inventario_id', inventario.id)
      if (alive) {
        setItens((data ?? []) as InventarioItem[])
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [inventario.id])

  async function alterarContado(it: InventarioItem, novaQtd: number) {
    setSalvandoIdx(it.id)
    // FIX-INVENTARIO-CONTAGEM-PERSIST-v1
    // UPDATE direto falhava silenciosamente (diferenca e GENERATED) · usa RPC.
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.rpc('fn_inventario_registrar_contagem', {
      p_item_id: it.id,
      p_quantidade_contada: novaQtd,
      p_usuario: user?.email ?? null,
    })
    if (error) {
      flashErr('Não foi possível salvar a contagem: ' + error.message)
      setSalvandoIdx(null)
      return
    }
    // Releitura do item pra refletir diferenca generated + valor_diferenca.
    const { data: row } = await supabase.from('erp_inventario_itens').select('*').eq('id', it.id).single()
    if (row) {
      setItens((prev) => prev.map((x) => x.id === it.id ? (row as InventarioItem) : x))
    }
    setSalvandoIdx(null)
  }

  async function fechar() {
    if (!confirm('Fechar o inventário? Vai gerar movimentações de ajuste pelas diferenças.')) return
    setFechando(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.rpc('fechar_inventario', {
      p_inventario_id: inventario.id,
      p_usuario_id: user?.id ?? null,
    })
    if (error) {
      flashErr('Falha ao fechar: ' + error.message)
      setFechando(false)
      return
    }
    flash('Inventário FECHADO · ajustes criados.')
    setFechando(false)
    await onFechado()
  }

  // FIX-INVENTARIO-CONTAGEM-PERSIST-v1: divergencia so existe pra item contado.
  // (diferenca e GENERATED · vem != 0 antes da contagem · nao e divergencia real)
  const contados = itens.filter((i) => i.quantidade_contada != null).length
  const divergencias = itens.filter((i) => i.quantidade_contada != null && Number(i.diferenca ?? 0) !== 0).length

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(780px, 100%)', height: '100%', background: C.offWhite, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)' }}>
        <header style={{ position: 'sticky', top: 0, background: C.offWhite, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 600 }}>Inventário</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{inventario.numero ?? '—'}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.espressoM }}>{local?.nome ?? '—'} · {contados}/{itens.length} contados · {divergencias} divergência(s)</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM }}><X size={16} /></button>
        </header>

        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.espressoM }}>Carregando itens…</div>
          ) : itens.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Sem itens.</div>
          ) : (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: C.cream }}>
                  <tr><Th>Produto</Th><Th align="right">Sistema</Th><Th align="right">Contado</Th><Th align="right">Diferença</Th></tr>
                </thead>
                <tbody>
                  {itens.map((it) => {
                    const p = produtosPorId[it.produto_id]
                    const sistema = Number(it.quantidade_sistema ?? 0)
                    const contado = it.quantidade_contada
                    const diff = it.diferenca ?? (contado != null ? Number(contado) - sistema : 0)
                    const corDiff = diff > 0 ? C.green : diff < 0 ? C.red : C.espressoL
                    return (
                      <tr key={it.id} style={{ borderTop: `1px solid ${C.borderL}` }}>
                        <Td>
                          <div style={{ fontWeight: 600 }}>{p?.nome ?? '—'}</div>
                          {p?.codigo && <span style={{ fontSize: 9, color: C.espressoM, fontFamily: 'monospace' }}>{p.codigo}</span>}
                        </Td>
                        <Td align="right">{fmtNum(sistema)}</Td>
                        <Td align="right">
                          {fechado ? (
                            <span>{contado != null ? fmtNum(Number(contado)) : '—'}</span>
                          ) : (
                            <input
                              type="number" step="0.001"
                              defaultValue={contado ?? ''}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value)
                                if (!isNaN(v)) void alterarContado(it, v)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  ;(e.target as HTMLInputElement).blur()
                                }
                              }}
                              data-testid={`inv-contado-${it.id}`}
                              disabled={salvandoIdx === it.id}
                              style={{ width: 90, padding: 4, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, textAlign: 'right' }}
                            />
                          )}
                        </Td>
                        <Td align="right">
                          {contado != null ? (
                            <strong style={{ color: corDiff }}>{diff > 0 ? '+' : ''}{fmtNum(diff)}</strong>
                          ) : <span style={{ color: C.espressoL }}>—</span>}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!fechado && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" onClick={onClose} disabled={fechando} style={btnSec}>Continuar depois</button>
              <button type="button" onClick={fechar} disabled={fechando || contados === 0} data-testid="inv-fechar"
                style={btnPrincipal(!fechando && contados > 0)}>
                {fechando ? 'Fechando…' : '🔒 Fechar inventário'}
              </button>
            </div>
          )}
          {fechado && (
            <div style={{ marginTop: 14, padding: 12, background: C.greenBg, borderRadius: 8, color: C.green, fontSize: 12 }}>
              ✓ Inventário FECHADO. Ajustes gerados nas movimentações.
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
