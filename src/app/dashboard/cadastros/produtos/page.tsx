'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import ProdutoForm, { type Produto } from '@/components/cadastros/ProdutoForm'
import { Package, Plus, Search, Edit, Loader2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Produto | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const carregar = useCallback(async (cid: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('erp_produtos')
      .select('id, codigo, nome, descricao, ncm, cfop_venda, cest, origem, cst_icms, cst_pis, cst_cofins, aliquota_icms, aliquota_ipi, aliquota_pis, aliquota_cofins, unidade, preco_venda, preco_custo, ativo')
      .eq('company_id', cid)
      .order('nome')
    setProdutos((data ?? []) as Produto[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const cid = localStorage.getItem('ps_empresa_sel')
    if (cid && !cid.startsWith('group_') && cid !== 'consolidado') {
      setCompanyId(cid)
      carregar(cid)
    } else {
      setLoading(false)
    }
  }, [carregar])

  const filtrados = produtos.filter(
    (p) =>
      !busca ||
      p.nome.toLowerCase().includes(busca.toLowerCase()) ||
      p.codigo?.toLowerCase().includes(busca.toLowerCase()) ||
      (p.ncm ?? '').includes(busca)
  )

  if (!companyId) {
    return (
      <div className="p-6 text-center text-[#3D2314]/70 text-[13px]">
        Selecione uma empresa especifica (nao consolidado ou grupo) pra cadastrar produtos.
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
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
          <div className="px-4 py-3 border-b border-[#3D2314]/10 flex items-center gap-2">
            <Search size={15} className="text-[#3D2314]/50" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, codigo ou NCM..."
              className="flex-1 text-[13px] outline-none bg-transparent"
            />
            <span className="text-[11px] text-[#3D2314]/55">
              {filtrados.length} de {produtos.length}
            </span>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={24} />
            </div>
          ) : filtrados.length === 0 ? (
            <div className="py-12 text-center text-[#3D2314]/60 text-[13px]">
              {produtos.length === 0
                ? 'Nenhum produto cadastrado · clique em "Novo Produto" pra comecar'
                : 'Nenhum produto corresponde a busca'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11.5px] text-[#3D2314]/70">
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
                  {filtrados.map((p) => (
                    <tr key={p.id} className="border-t border-[#3D2314]/8 hover:bg-[#FAEEDA]/30">
                      <td className="px-4 py-2.5 font-mono text-[12px]">{p.codigo ?? '—'}</td>
                      <td className="px-4 py-2.5">{p.nome}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{p.ncm ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{p.cfop_venda ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
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
              carregar(companyId)
            }}
          />
        )}
      </div>
    </div>
  )
}
