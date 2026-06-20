'use client'

// Onda 3.1/3.2 · Itens da NFe recebida com de-para + vinculo manual.
// Le fn_nfe_item_depara_sugerir e grava via fn_nfe_item_vincular.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Item = {
  item_id: string
  numero_item: number
  codigo_produto: string
  descricao: string
  ncm: string | null
  cfop: string | null
  quantidade: number
  valor_unitario: number
  produto_id: string | null
  produto_nome: string | null
  vinculo_origem: string | null
  entra_estoque: boolean | null
}

type Prod = {
  id: string
  nome: string
  codigo: string | null
  ncm: string | null
  estoque_atual: number | null
}

interface SugerirResp {
  ok: boolean
  itens?: Item[]
  erro?: string
}

interface VincularResp {
  ok: boolean
  item_id?: string
  produto_id?: string
  entra_estoque?: boolean
  depara_fixado?: boolean
  erro?: string
}

interface Props {
  nfeId: string
  companyId: string
  onChange?: () => void
}

export function ItensNfeRecebida({ nfeId, companyId, onChange }: Props) {
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [buscaItem, setBuscaItem] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Prod[]>([])
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_item_depara_sugerir', {
      p_nfe_recebida_id: nfeId,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as SugerirResp | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao sugerir'); setItens([]); return }
    setItens(r.itens ?? [])
  }, [nfeId])

  useEffect(() => { void carregar() }, [carregar])

  async function buscarProduto(termo: string) {
    setQ(termo)
    if (termo.trim().length < 2) { setRes([]); return }
    const { data } = await supabase
      .from('erp_produtos')
      .select('id, nome, codigo, ncm, estoque_atual')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .ilike('nome', `%${termo.trim()}%`)
      .limit(20)
    setRes((data as Prod[]) ?? [])
  }

  async function vincular(itemId: string, produtoId: string) {
    setBusy(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_item_vincular', {
      p_item_id: itemId,
      p_produto_id: produtoId,
      p_fixar_depara: true,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as VincularResp | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao vincular'); return }
    setBuscaItem(null); setQ(''); setRes([])
    await carregar()
    onChange?.()
  }

  function chipEstoque(it: Item) {
    if (it.entra_estoque === true) {
      return <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#E8F4DC] text-[#3F7012] font-medium">entra no estoque</span>
    }
    if (it.entra_estoque === false) {
      return <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#3D2314]/8 text-[#3D2314]/65 font-medium">não entra</span>
    }
    return <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium">classificar CFOP</span>
  }
  function chipVinculo(it: Item) {
    if (it.produto_id) {
      const sufixo = it.vinculo_origem === 'sugerido'
        ? ' (sugestão)'
        : it.vinculo_origem === 'depara'
        ? ' (de-para)'
        : ''
      return (
        <span className="text-[10.5px] px-2 py-0.5 rounded-full font-medium bg-[#F3E9DD] text-[#3D2314]">
          ✓ {it.produto_nome ?? 'vinculado'}{sufixo}
        </span>
      )
    }
    return <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FAEEDA] text-[#BA7517] font-medium">pendente de vínculo</span>
  }

  if (loading) {
    return <div className="text-[12px] text-[#3D2314]/55 py-2">Carregando itens…</div>
  }
  if (erro) {
    return <div className="text-[12px] text-[#A32D2D] py-2">Não consegui carregar itens: {erro}</div>
  }
  if (itens.length === 0) {
    return <div className="text-[12px] text-[#3D2314]/55 py-2 italic">Sem itens — nota ainda sem XML completo.</div>
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="text-[12px] font-medium text-[#3D2314]">
        Itens da nota ({itens.length})
      </div>
      {itens.map((it) => (
        <div key={it.item_id} className="rounded-lg border border-[#3D2314]/10 p-3 bg-[#FAF7F2]/40">
          <div className="flex justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-[#3D2314] truncate">
                {it.descricao}
              </div>
              <div className="text-[10.5px] text-[#3D2314]/60 mt-0.5">
                cód {it.codigo_produto} · NCM {it.ncm ?? '—'} · CFOP {it.cfop ?? '—'} ·{' '}
                {Number(it.quantidade ?? 0).toLocaleString('pt-BR')}× R${' '}
                {Number(it.valor_unitario ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {chipEstoque(it)}
            {chipVinculo(it)}
            <button
              type="button"
              onClick={() => { setBuscaItem(it.item_id); setQ(''); setRes([]) }}
              className="text-[10.5px] px-2.5 py-1 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810]"
            >
              {it.produto_id ? 'Trocar produto' : 'Vincular produto'}
            </button>
          </div>

          {buscaItem === it.item_id && (
            <div className="mt-2 rounded-md bg-white border border-[#3D2314]/10 p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => void buscarProduto(e.target.value)}
                placeholder="Buscar produto pelo nome…"
                className="w-full text-[12px] border border-[#3D2314]/15 rounded-md px-2 py-1 outline-none text-[#3D2314]"
              />
              <div className="max-h-48 overflow-auto mt-1">
                {res.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void vincular(it.item_id, p.id)}
                    className="w-full text-left text-[12px] px-2 py-1 hover:bg-[#3D2314]/5 rounded text-[#3D2314] disabled:opacity-50"
                  >
                    {p.nome}{' '}
                    <span className="text-[10.5px] text-[#3D2314]/50">
                      · estoque {Number(p.estoque_atual ?? 0).toLocaleString('pt-BR')}
                    </span>
                  </button>
                ))}
                {q.length >= 2 && res.length === 0 && (
                  <div className="text-[10.5px] text-[#3D2314]/50 px-2 py-1">
                    Nenhum produto encontrado.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setBuscaItem(null); setQ(''); setRes([]) }}
                className="text-[10.5px] text-[#3D2314]/55 mt-1 hover:underline"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
