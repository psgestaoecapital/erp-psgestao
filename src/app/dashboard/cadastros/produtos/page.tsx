'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ProdutoForm, { type Produto } from '@/components/cadastros/ProdutoForm'
import ImportProdutosFiscalModal from '@/components/importar/ImportProdutosFiscalModal'
import AutoclassificarProdutosModal from '@/components/importar/AutoclassificarProdutosModal'
import {
  Package, Plus, Search, Edit, Loader2, Filter, ChevronDown, ChevronUp,
  ArrowUp, ArrowDown, X, Upload, Sparkles,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SELECT_COLS = 'id,codigo,nome,ncm,unidade,preco_venda,codigo_barras'

type OrdenarPor = 'codigo' | 'nome' | 'preco_venda'
type ComEan = 'todos' | 'sim' | 'nao'

interface UnidadeOption {
  unidade: string
  qtd: number
}

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v))

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)

  // Busca
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')

  // Filtros
  const [unidade, setUnidade] = useState<string>('')
  const [precoMin, setPrecoMin] = useState<string>('')
  const [precoMax, setPrecoMax] = useState<string>('')
  const [semPreco, setSemPreco] = useState(false)
  const [comEan, setComEan] = useState<ComEan>('todos')

  // Ordenacao
  const [ordenarPor, setOrdenarPor] = useState<OrdenarPor>('codigo')
  const [ordemAsc, setOrdemAsc] = useState(true)

  // Opcoes carregadas
  const [unidades, setUnidades] = useState<UnidadeOption[]>([])
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)

  // Modal edicao
  const [editando, setEditando] = useState<Produto | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [importarFiscalAberto, setImportarFiscalAberto] = useState(false)
  const [autoclassificarAberto, setAutoclassificarAberto] = useState(false)

  const offsetRef = useRef(0)

  useEffect(() => {
    const id = setTimeout(() => setBuscaDebounced(busca.trim()), 300)
    return () => clearTimeout(id)
  }, [busca])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const cid = localStorage.getItem('ps_empresa_sel')
    if (cid && !cid.startsWith('group_') && cid !== 'consolidado') {
      setCompanyId(cid)
    } else {
      setLoading(false)
    }
  }, [])

  // Carrega unidades pra o dropdown (uma vez por empresa)
  useEffect(() => {
    if (!companyId) return
    let alive = true
    supabase
      .rpc('fn_produtos_unidades', { p_company_id: companyId })
      .then(({ data, error }) => {
        if (!alive || error) return
        setUnidades((data ?? []) as UnidadeOption[])
      })
    return () => { alive = false }
  }, [companyId])

  const carregar = useCallback(
    async (reset: boolean) => {
      if (!companyId) return
      if (reset) {
        setLoading(true)
        offsetRef.current = 0
      } else {
        setLoadingMore(true)
      }
      setErro(null)
      try {
        let q = supabase
          .from('erp_produtos')
          .select(SELECT_COLS, { count: 'exact' })
          .eq('company_id', companyId)
          .eq('ref_externa_sistema', 'OMIE')

        if (buscaDebounced) {
          const b = buscaDebounced.replace(/[%]/g, '')
          q = q.or(`nome.ilike.%${b}%,codigo.ilike.%${b}%,ncm.ilike.%${b}%`)
        }
        if (unidade) q = q.eq('unidade', unidade)
        const min = precoMin === '' ? null : parseFloat(precoMin.replace(',', '.'))
        const max = precoMax === '' ? null : parseFloat(precoMax.replace(',', '.'))
        if (min != null && !isNaN(min)) q = q.gte('preco_venda', min)
        if (max != null && !isNaN(max)) q = q.lte('preco_venda', max)
        if (semPreco) q = q.or('preco_venda.is.null,preco_venda.eq.0')
        if (comEan === 'sim') q = q.not('codigo_barras', 'is', null)
        if (comEan === 'nao') q = q.is('codigo_barras', null)

        q = q
          .order(ordenarPor, { ascending: ordemAsc })
          .range(offsetRef.current, offsetRef.current + PAGE_SIZE - 1)

        const { data, count, error } = await q
        if (error) throw error
        const rows = (data ?? []) as unknown as Produto[]
        setTotal(count ?? 0)
        setProdutos((prev) => (reset ? rows : [...prev, ...rows]))
        offsetRef.current += rows.length
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar produtos')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [companyId, buscaDebounced, unidade, precoMin, precoMax, semPreco, comEan, ordenarPor, ordemAsc]
  )

  // Reset on qualquer mudanca de filtro/ordem/busca
  useEffect(() => {
    if (companyId) carregar(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, buscaDebounced, unidade, precoMin, precoMax, semPreco, comEan, ordenarPor, ordemAsc])

  function toggleOrdem(coluna: OrdenarPor) {
    if (ordenarPor === coluna) {
      setOrdemAsc((a) => !a)
    } else {
      setOrdenarPor(coluna)
      setOrdemAsc(true)
    }
  }

  function limparFiltros() {
    setUnidade('')
    setPrecoMin('')
    setPrecoMax('')
    setSemPreco(false)
    setComEan('todos')
  }

  const filtrosAtivos = useMemo(() => {
    let n = 0
    if (unidade) n++
    if (precoMin) n++
    if (precoMax) n++
    if (semPreco) n++
    if (comEan !== 'todos') n++
    return n
  }, [unidade, precoMin, precoMax, semPreco, comEan])

  const podeCarregarMais = produtos.length < total
  const buscaOuFiltroAtivo = !!buscaDebounced || filtrosAtivos > 0
  const headerContagem = buscaOuFiltroAtivo
    ? `${produtos.length} de ${total} (filtrado)`
    : `${produtos.length} de ${total}`

  if (!companyId) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="p-6 text-center text-[#3D2314]/70 text-[13px]">
            Selecione uma empresa especifica (nao consolidado ou grupo) pra cadastrar produtos.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
              Cadastros · Gestao Empresarial
            </div>
            <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
              <Package size={22} className="text-[#C8941A]" /> Produtos
            </h1>
            <p className="text-[13px] text-[#3D2314]/70 mt-1.5">
              Catalogo pra emissao de NFe · vendas de produto fisico
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setAutoclassificarAberto(true)}
              data-testid="produto-autoclassificar"
              className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#C8941A] text-[#C8941A] hover:bg-[#FFF8E7] flex items-center gap-2"
            >
              <Sparkles size={15} /> Auto-classificar pela base PS
            </button>
            <button
              type="button"
              onClick={() => setImportarFiscalAberto(true)}
              data-testid="produto-importar-fiscal"
              className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#C8941A] text-[#C8941A] hover:bg-[#FFF8E7] flex items-center gap-2"
            >
              <Upload size={15} /> Importar planilha fiscal
            </button>
            <button
              type="button"
              onClick={() => setNovoAberto(true)}
              data-testid="produto-novo"
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-2"
            >
              <Plus size={15} /> Novo Produto
            </button>
          </div>
        </header>

        <div className="bg-white rounded-xl border border-[#3D2314]/10 overflow-hidden">
          {/* Barra de busca + toggle filtros */}
          <div className="px-4 py-3 border-b border-[#3D2314]/10 flex items-center gap-2">
            <Search size={15} className="text-[#3D2314]/50 flex-shrink-0" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, codigo ou NCM..."
              className="flex-1 text-[13px] outline-none bg-transparent text-[#3D2314] placeholder:text-[#3D2314]/40 min-w-0"
            />
            <button
              type="button"
              onClick={() => setFiltrosAbertos((o) => !o)}
              data-testid="produto-toggle-filtros"
              className={`flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium rounded border transition-colors flex-shrink-0 ${
                filtrosAtivos > 0
                  ? 'border-[#C8941A]/45 text-[#633806] bg-[#C8941A]/10'
                  : 'border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5'
              }`}
            >
              <Filter size={12} />
              <span className="hidden sm:inline">Filtros</span>
              {filtrosAtivos > 0 && (
                <span className="bg-[#C8941A] text-white text-[9.5px] px-1 rounded">{filtrosAtivos}</span>
              )}
              {filtrosAbertos ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            <span
              className="text-[11px] text-[#3D2314]/70 flex-shrink-0"
              data-testid="produtos-contagem"
            >
              {headerContagem}
            </span>
          </div>

          {/* Filtros · colapsavel */}
          {filtrosAbertos && (
            <div className="px-4 py-3 border-b border-[#3D2314]/10 bg-[#FAF7F2]/40">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10.5px] uppercase tracking-wide text-[#3D2314]/65 block mb-1 font-medium">
                    Unidade
                  </label>
                  <select
                    value={unidade}
                    onChange={(e) => setUnidade(e.target.value)}
                    data-testid="filtro-unidade"
                    className="w-full px-2 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded bg-white text-[#3D2314]"
                  >
                    <option value="">Todas ({unidades.reduce((s, u) => s + u.qtd, 0)})</option>
                    {unidades.map((u) => (
                      <option key={u.unidade} value={u.unidade}>
                        {u.unidade} ({u.qtd})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10.5px] uppercase tracking-wide text-[#3D2314]/65 block mb-1 font-medium">
                    Preço entre (R$)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={precoMin}
                      onChange={(e) => setPrecoMin(e.target.value)}
                      placeholder="min"
                      data-testid="filtro-preco-min"
                      className="w-full px-2 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded bg-white text-[#3D2314] placeholder:text-[#3D2314]/40"
                    />
                    <span className="text-[#3D2314]/40 text-[11px]">—</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={precoMax}
                      onChange={(e) => setPrecoMax(e.target.value)}
                      placeholder="max"
                      data-testid="filtro-preco-max"
                      className="w-full px-2 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded bg-white text-[#3D2314] placeholder:text-[#3D2314]/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10.5px] uppercase tracking-wide text-[#3D2314]/65 block mb-1 font-medium">
                    EAN (cód. barras)
                  </label>
                  <select
                    value={comEan}
                    onChange={(e) => setComEan(e.target.value as ComEan)}
                    data-testid="filtro-ean"
                    className="w-full px-2 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded bg-white text-[#3D2314]"
                  >
                    <option value="todos">Todos</option>
                    <option value="sim">Com EAN</option>
                    <option value="nao">Sem EAN</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10.5px] uppercase tracking-wide text-[#3D2314]/65 block mb-1 font-medium">
                    Outros
                  </label>
                  <label className="flex items-center gap-2 px-2 py-1.5 border border-[#3D2314]/15 rounded bg-white cursor-pointer text-[12.5px] text-[#3D2314]">
                    <input
                      type="checkbox"
                      checked={semPreco}
                      onChange={(e) => setSemPreco(e.target.checked)}
                      data-testid="filtro-sem-preco"
                      className="accent-[#C8941A]"
                    />
                    Só sem preço
                  </label>
                </div>
              </div>

              {filtrosAtivos > 0 && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={limparFiltros}
                    data-testid="filtro-limpar"
                    className="text-[12px] text-[#3D2314]/70 hover:text-[#3D2314] flex items-center gap-1"
                  >
                    <X size={12} /> Limpar {filtrosAtivos} filtro{filtrosAtivos > 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </div>
          )}

          {erro && (
            <div className="px-4 py-2 bg-[#FCEBEB] text-[#791F1F] text-[12.5px] border-b border-[#E8A6A5]">
              {erro}
            </div>
          )}

          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={24} />
            </div>
          ) : produtos.length === 0 ? (
            <div className="py-12 text-center text-[#3D2314]/70 text-[13px]">
              {buscaOuFiltroAtivo
                ? 'Nenhum produto corresponde à busca + filtros · ajuste ou limpe pra ver mais.'
                : 'Nenhum produto cadastrado · clique em "Novo Produto" pra começar'}
            </div>
          ) : (
            <>
              {/* Tabela · desktop */}
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-[13px] text-[#3D2314]">
                  <thead className="bg-[#3D2314]/5 text-[11.5px] text-[#3D2314]/75 uppercase tracking-[0.5px]">
                    <tr>
                      <ThSort label="Codigo" col="codigo" current={ordenarPor} asc={ordemAsc} onClick={toggleOrdem} />
                      <ThSort label="Descricao" col="nome" current={ordenarPor} asc={ordemAsc} onClick={toggleOrdem} />
                      <th className="text-left px-4 py-2.5 font-medium">NCM</th>
                      <th className="text-left px-4 py-2.5 font-medium">Unidade</th>
                      <ThSort
                        label="Preço venda"
                        col="preco_venda"
                        current={ordenarPor}
                        asc={ordemAsc}
                        onClick={toggleOrdem}
                        align="right"
                      />
                      <th className="text-right px-4 py-2.5 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map((p) => (
                      <tr
                        key={p.id}
                        data-testid="produto-row"
                        className="border-t border-[#3D2314]/8 hover:bg-[#FAEEDA]/30"
                      >
                        <td className="px-4 py-2.5 font-mono text-[12px] text-[#3D2314]">
                          {p.codigo ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-[#3D2314]">{p.nome}</td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-stone-500">
                          {p.ncm ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-stone-500 text-[12.5px]">
                          {p.unidade ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314] font-medium">
                          {fmtBRL(p.preco_venda as number | null | undefined)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setEditando(p)}
                            data-testid="produto-editar"
                            className="text-[#C8941A] hover:text-[#A87810] mr-3"
                            title="Editar"
                          >
                            <Edit size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards · mobile */}
              <div className="md:hidden divide-y divide-[#3D2314]/8">
                {produtos.map((p) => (
                  <div
                    key={p.id}
                    data-testid="produto-row-mobile"
                    className="px-4 py-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-[#3D2314] leading-tight">
                        {p.nome}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-stone-500">
                        <span className="font-mono text-[#3D2314]/85">{p.codigo ?? '—'}</span>
                        {p.unidade && (
                          <>
                            <span>·</span>
                            <span>{p.unidade}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <div className="text-[13.5px] tabular-nums font-medium text-[#3D2314]">
                        {fmtBRL(p.preco_venda as number | null | undefined)}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditando(p)}
                        className="text-[#C8941A] hover:text-[#A87810]"
                        title="Editar"
                      >
                        <Edit size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {podeCarregarMais && (
                <div className="px-4 py-3 border-t border-[#3D2314]/10 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => carregar(false)}
                    disabled={loadingMore}
                    data-testid="produto-carregar-mais"
                    className="px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-2"
                  >
                    {loadingMore ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Plus size={13} />
                    )}
                    Carregar mais (faltam {total - produtos.length})
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {(novoAberto || editando) && (
          <ProdutoForm
            companyId={companyId}
            produto={editando}
            onClose={() => {
              setNovoAberto(false)
              setEditando(null)
            }}
            onSalvo={() => {
              setNovoAberto(false)
              setEditando(null)
              carregar(true)
            }}
          />
        )}

        {importarFiscalAberto && (
          <ImportProdutosFiscalModal
            companyId={companyId}
            onClose={() => setImportarFiscalAberto(false)}
            onAtualizado={() => carregar(true)}
          />
        )}

        {autoclassificarAberto && (
          <AutoclassificarProdutosModal
            companyId={companyId}
            onClose={() => setAutoclassificarAberto(false)}
            onAtualizado={() => carregar(true)}
          />
        )}
      </div>
    </div>
  )
}

interface ThSortProps {
  label: string
  col: OrdenarPor
  current: OrdenarPor
  asc: boolean
  onClick: (col: OrdenarPor) => void
  align?: 'left' | 'right'
}
function ThSort({ label, col, current, asc, onClick, align = 'left' }: ThSortProps) {
  const ativo = current === col
  return (
    <th
      className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onClick(col)}
        data-testid={`ordenar-${col}`}
        className={`inline-flex items-center gap-1 ${
          align === 'right' ? 'ml-auto' : ''
        } ${ativo ? 'text-[#3D2314]' : 'text-[#3D2314]/75'} hover:text-[#3D2314]`}
      >
        {label}
        {ativo ? (
          asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        ) : (
          <span className="opacity-30">↕</span>
        )}
      </button>
    </th>
  )
}
