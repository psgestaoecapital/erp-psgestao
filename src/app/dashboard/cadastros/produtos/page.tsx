'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ProdutoForm, { type Produto } from '@/components/cadastros/ProdutoForm'
import { Package, Plus, Search, Edit, Loader2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SELECT_COLS =
  'id, codigo, nome, descricao, ncm, cfop_venda, cest, origem, cst_icms, cst_pis, cst_cofins, aliquota_icms, aliquota_ipi, aliquota_pis, aliquota_cofins, unidade, preco_venda, preco_custo, ativo'

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [editando, setEditando] = useState<Produto | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const ofssetRef = useRef(0)

  // Debounce de busca · 300ms
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

  const carregar = useCallback(
    async (reset: boolean) => {
      if (!companyId) return
      if (reset) {
        setLoading(true)
        ofssetRef.current = 0
      } else {
        setLoadingMore(true)
      }
      setErro(null)
      try {
        let q = supabase
          .from('erp_produtos')
          .select(SELECT_COLS, { count: 'exact' })
          .eq('company_id', companyId)
          .order('codigo', { ascending: true })
          .range(ofssetRef.current, ofssetRef.current + PAGE_SIZE - 1)

        if (buscaDebounced) {
          const b = buscaDebounced.replace(/[%]/g, '')
          q = q.or(`nome.ilike.%${b}%,codigo.ilike.%${b}%,ncm.ilike.%${b}%`)
        }

        const { data, count, error } = await q
        if (error) throw error
        const rows = (data ?? []) as unknown as Produto[]
        setTotal(count ?? 0)
        setProdutos((prev) => (reset ? rows : [...prev, ...rows]))
        ofssetRef.current += rows.length
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar produtos')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [companyId, buscaDebounced]
  )

  // Recarrega ao mudar companyId ou busca (debounced)
  useEffect(() => {
    if (companyId) carregar(true)
  }, [companyId, buscaDebounced, carregar])

  const podeCarregarMais = produtos.length < total
  const limpouBusca = !buscaDebounced
  const headerContagem = limpouBusca
    ? `${produtos.length} de ${total}`
    : `${produtos.length} de ${total} (filtrado)`

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
          <button
            type="button"
            onClick={() => setNovoAberto(true)}
            data-testid="produto-novo"
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-2 flex-shrink-0"
          >
            <Plus size={15} /> Novo Produto
          </button>
        </header>

        <div className="bg-white rounded-xl border border-[#3D2314]/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#3D2314]/10 flex items-center gap-2 text-[#3D2314]">
            <Search size={15} className="text-[#3D2314]/50" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, codigo ou NCM..."
              className="flex-1 text-[13px] outline-none bg-transparent text-[#3D2314] placeholder:text-[#3D2314]/40"
            />
            <span className="text-[11px] text-[#3D2314]/70" data-testid="produtos-contagem">
              {headerContagem}
            </span>
          </div>

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
              {total === 0
                ? 'Nenhum produto cadastrado · clique em "Novo Produto" pra comecar'
                : 'Nenhum produto corresponde a busca'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] text-[#3D2314]">
                  <thead className="bg-[#3D2314]/5 text-[11.5px] text-[#3D2314]/75 uppercase tracking-[0.5px]">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Codigo</th>
                      <th className="text-left px-4 py-2.5 font-medium">Nome</th>
                      <th className="text-left px-4 py-2.5 font-medium">NCM</th>
                      <th className="text-left px-4 py-2.5 font-medium">CFOP</th>
                      <th className="text-right px-4 py-2.5 font-medium">Preco</th>
                      <th className="text-right px-4 py-2.5 font-medium">Acoes</th>
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
                        <td className="px-4 py-2.5 font-mono text-[12px] text-stone-500">
                          {p.cfop_venda ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314] font-medium">
                          R$ {Number(p.preco_venda ?? 0).toFixed(2)}
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
      </div>
    </div>
  )
}
