'use client'

// Markup PRÓPRIO de um produto (chamado #2710 FCR). Produto sem o próprio usa o markup geral da empresa.
// Lê por fn_preco_markup_efetivo e grava por fn_preco_markup_produtos (a mesma regra da alteração em massa — RD-26).
// Usado no cadastro do produto (aba Preços) e na tela de Precificação.

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Undo2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

type Efetivo = {
  ok?: boolean; erro?: string
  markup_geral_pct?: number | null; markup_produto_pct?: number | null; markup_pct?: number | null
  origem?: 'produto' | 'geral' | null; preco_sugerido?: number | null
}

const brl = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTxt = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

export default function MarkupProdutoCampo({ companyId, produtoId, custo, onSalvo }: {
  companyId: string; produtoId: string; custo?: number | null; onSalvo?: () => void
}) {
  const [ef, setEf] = useState<Efetivo | null>(null)
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const ler = useCallback(async (): Promise<Efetivo | null> => {
    const { data } = await supabase.rpc('fn_preco_markup_efetivo', { p_company_id: companyId, p_produto_id: produtoId, p_custo: custo ?? null })
    return data as Efetivo | null
  }, [companyId, produtoId, custo])
  const aplicar = (r: Efetivo | null) => {
    setEf(r)
    setValor(r?.markup_produto_pct != null ? String(r.markup_produto_pct).replace('.', ',') : '')
  }
  const carregar = async () => aplicar(await ler())

  useEffect(() => {
    let vivo = true
    void ler().then((r) => { if (vivo) aplicar(r) })
    return () => { vivo = false }
  }, [ler])

  async function gravar(remover: boolean) {
    const n = Number(valor.trim().replace(',', '.'))
    if (!remover && (valor.trim() === '' || Number.isNaN(n) || n < 0)) { setMsg('Informe o markup em % (ex.: 40).'); return }
    setSalvando(true); setMsg(null)
    const { data } = await supabase.rpc('fn_preco_markup_produtos', {
      p_company_id: companyId, p_markup_pct: remover ? null : n, p_remover: remover,
      p_produto_ids: [produtoId], p_gravar: true,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setMsg(r?.erro === 'sem_permissao' ? 'Seu perfil não pode alterar preço.' : 'Não consegui gravar o markup.'); return }
    setMsg(remover ? 'Pronto: o produto volta a usar o markup geral.' : 'Markup do produto gravado.')
    await carregar()
    onSalvo?.()
  }

  if (ef && ef.ok === false) return null

  return (
    <div className="rounded-lg border border-[#3D2314]/10 bg-[#FAF7F2] p-3">
      <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
        <span className="flex items-center">Markup do produto<AjudaCampo chave="compras.precificacao.markup_produto" /></span>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
            placeholder={ef?.markup_geral_pct != null ? `geral ${pctTxt(ef.markup_geral_pct)}` : 'ex. 40'}
            className="w-24 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] bg-white" />
          <span className="text-[13px] text-[#3D2314]/60">%</span>
          <button type="button" onClick={() => void gravar(false)} disabled={salvando}
            className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md bg-[#3D2314] text-white font-medium hover:bg-[#2A1810] disabled:opacity-50">
            {salvando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Gravar
          </button>
          {ef?.markup_produto_pct != null && (
            <button type="button" onClick={() => void gravar(true)} disabled={salvando}
              className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md border border-[#3D2314]/15 text-[#3D2314]/75 hover:bg-[#3D2314]/5 disabled:opacity-50">
              <Undo2 size={12} /> Voltar ao geral
            </button>
          )}
        </div>
      </label>
      <div className="mt-1.5 text-[11px] text-[#3D2314]/60">
        {ef == null ? 'Carregando…'
          : ef.origem === 'produto' ? <>Usando o markup <strong>deste produto</strong> ({pctTxt(ef.markup_pct)}).</>
          : ef.origem === 'geral' ? <>Sem markup próprio: usa o <strong>geral da empresa</strong> ({pctTxt(ef.markup_pct)}).</>
          : <>Sem markup próprio e a empresa não tem markup geral (defina em Compras › Precificação).</>}
        {ef?.preco_sugerido != null && <> Preço sugerido pelo custo: <strong>{brl(ef.preco_sugerido)}</strong>.</>}
      </div>
      {msg && <div className="mt-1 text-[11px] text-[#3F7012]">{msg}</div>}
    </div>
  )
}
