'use client'

import { useEffect, useState } from 'react'
import { Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { authFetch } from '@/lib/authFetch'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { Vinculo } from '@/lib/produtos/vinculosProduto'

interface Props {
  produtoId: string | null
  companyId: string | null
  onFechar: () => void
  onExcluido: () => void
}

type Info = { nome: string; codigo: string | null; vinculos: Vinculo[] }

// Exclusão de produto (chamado #3856). Antes de confirmar, consulta os vínculos: se houver pedido, nota, estoque,
// compra ou obra usando o produto, bloqueia e mostra onde. Sem vínculo, a exclusão é lógica (o produto sai da lista
// e fica inativo, com o histórico preservado).
export default function ExcluirProdutoModal({ produtoId, companyId, onFechar, onExcluido }: Props) {
  const [info, setInfo] = useState<Info | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!produtoId || !companyId) return
    let cancelado = false
    setCarregando(true)
    setErro(null)
    setInfo(null)
    authFetch(`/api/cadastros/produtos?id=${encodeURIComponent(produtoId)}&company_id=${encodeURIComponent(companyId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelado) return
        if (!json.ok) throw new Error(json.mensagem ?? 'Erro ao verificar o produto')
        setInfo({ nome: json.produto.nome, codigo: json.produto.codigo, vinculos: json.vinculos })
      })
      .catch((e: unknown) => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Erro') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [produtoId, companyId])

  if (!produtoId || !companyId) return null

  const bloqueado = !!info && info.vinculos.length > 0

  async function excluir() {
    if (!produtoId || !companyId) return
    setExcluindo(true)
    setErro(null)
    try {
      const r = await authFetch('/api/cadastros/produtos', {
        method: 'DELETE',
        body: JSON.stringify({ id: produtoId, company_id: companyId }),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) throw new Error(json.mensagem ?? 'Não foi possível excluir')
      onExcluido()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-testid="excluir-produto">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-[#3D2314]">
            {bloqueado ? 'Não é possível excluir este produto' : 'Excluir este produto?'}
          </h3>
          <AjudaCampo chave="cadastros.produtos.excluir" />
        </div>

        {carregando && (
          <div className="mt-5 flex items-center gap-2 text-[13px] text-[#3D2314]/70" data-testid="excluir-produto-carregando">
            <Loader2 size={14} className="animate-spin" /> Verificando vínculos…
          </div>
        )}

        {info && !bloqueado && (
          <p className="mt-2 text-[13.5px] text-[#3D2314]/70" data-testid="excluir-produto-confirmar">
            <strong className="text-[#3D2314]">{info.codigo ? `${info.codigo} · ` : ''}{info.nome}</strong> sai do cadastro e
            da lista de produtos ativos. Nada é apagado: o histórico continua no sistema.
          </p>
        )}

        {info && bloqueado && (
          <div className="mt-3" data-testid="excluir-produto-bloqueio">
            <p className="flex items-start gap-2 text-[13.5px] text-[#3D2314]/80">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-[#C8941A]" />
              <span>
                <strong className="text-[#3D2314]">{info.nome}</strong> já é usado em:
              </span>
            </p>
            <ul className="mt-2 space-y-1 text-[13px] text-[#3D2314]/80 pl-6 list-disc">
              {info.vinculos.map((v) => (
                <li key={v.rotulo}>{v.rotulo}: {v.total}</li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-[#3D2314]/60">
              Para tirar o produto da venda e da compra, edite o cadastro e desmarque “Ativo”. O histórico fica preservado.
            </p>
          </div>
        )}

        {erro && <p className="mt-3 text-[13px] text-red-700" data-testid="excluir-produto-erro">{erro}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onFechar}
            data-testid="excluir-produto-cancelar"
            className="rounded-lg px-4 py-2 text-[13px] text-[#3D2314]/70 hover:bg-stone-100"
          >
            {bloqueado ? 'Entendi' : 'Cancelar'}
          </button>
          {info && !bloqueado && (
            <button
              type="button"
              onClick={excluir}
              disabled={excluindo}
              data-testid="excluir-produto-ok"
              className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {excluindo ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Excluir produto
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
