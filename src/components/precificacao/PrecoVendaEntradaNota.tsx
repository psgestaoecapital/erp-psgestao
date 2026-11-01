'use client'

// Chamado #2710 (FCR) · na ENTRADA da nota de compra, sugere o preço de venda do produto vinculado pelo markup padrão
// dele (ou o geral da empresa) sobre o custo desta nota, deixando editar antes de gravar.
// Lê o markup por fn_preco_markup_efetivo (a mesma regra da Precificação — RD-26) e grava o preço por
// fn_produto_preco_aplicar (guarda de empresa + histórico em erp_preco_historico com o motivo "Entrada da nota").
// Usado em Documentos recebidos e no Mutirão (os dois montam ItensNfeRecebida).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, Tag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { lerPreco, precoPorMarkup } from '@/lib/precificacao/entradaNota'

const ROTA_AJUDA = '/dashboard/compras/documentos-recebidos'

type Efetivo = { ok?: boolean; markup_pct?: number | null; origem?: 'produto' | 'geral' | null; markup_geral_pct?: number | null }

const brl = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTxt = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const precoTxt = (v: number | null) => v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PrecoVendaEntradaNota({ companyId, produtoId, custo, motivo }: {
  companyId: string; produtoId: string
  custo: number | null           // custo do produto nesta nota (já dividido pelo fator de conversão)
  motivo: string                 // vai para o histórico de preço (ex.: "Entrada da nota de compra")
}) {
  const [ef, setEf] = useState<Efetivo | null>(null)
  const [atual, setAtual] = useState<number | null>(null)
  const [valor, setValor] = useState('')
  const [editado, setEditado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  const sugerido = precoPorMarkup(custo, ef?.markup_pct)

  const carregar = useCallback(async () => {
    const [mk, prod] = await Promise.all([
      supabase.rpc('fn_preco_markup_efetivo', { p_company_id: companyId, p_produto_id: produtoId, p_custo: custo }),
      supabase.from('erp_produtos').select('preco_venda').eq('id', produtoId).eq('company_id', companyId).maybeSingle(),
    ])
    return { mk: (mk.data ?? null) as Efetivo | null, preco: (prod.data as { preco_venda?: number | null } | null)?.preco_venda ?? null }
  }, [companyId, produtoId, custo])

  useEffect(() => {
    let vivo = true
    void carregar().then(({ mk, preco }) => {
      if (!vivo) return
      setEf(mk); setAtual(preco != null ? Number(preco) : null)
    })
    return () => { vivo = false }
  }, [carregar])

  // o campo começa no sugerido (o usuário pode mudar; mudou → não sobrescreve mais)
  useEffect(() => { if (!editado) setValor(precoTxt(sugerido)) }, [sugerido, editado])

  async function gravar() {
    const n = lerPreco(valor)
    if (n == null) { setMsg({ ok: false, texto: 'Informe o preço de venda (ex.: 14,00).' }); return }
    setSalvando(true); setMsg(null)
    const { data } = await supabase.rpc('fn_produto_preco_aplicar', { p_produto_id: produtoId, p_novo_preco: n, p_regra_id: null, p_motivo: motivo })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setMsg({ ok: false, texto: r?.erro === 'sem_acesso' ? 'Seu perfil não pode alterar o preço deste produto.' : 'Não consegui gravar o preço.' }); return }
    setAtual(n); setEditado(false)
    setMsg({ ok: true, texto: `Preço de venda gravado: ${brl(n)}.` })
  }

  if (ef && ef.ok === false) return null

  return (
    <div className="mt-1.5 rounded-md border border-[#3D2314]/10 bg-[#FBF6EA] px-2 py-1.5 text-[10.5px] text-[#3D2314]/75" data-testid={`nfe-preco-venda-${produtoId}`}>
      <label className="flex items-center gap-1.5 flex-wrap">
        <Tag size={12} aria-hidden className="text-[#BA7517]" />
        <span className="font-medium text-[#3D2314]">Preço de venda</span>
        <AjudaCampo chave="compras.entrada.preco_venda_sugerido" rota={ROTA_AJUDA} />
        <span className="text-[#3D2314]/55">R$</span>
        <input type="text" inputMode="decimal" value={valor} data-testid={`nfe-preco-venda-input-${produtoId}`}
          onChange={(e) => { setValor(e.target.value); setEditado(true) }}
          placeholder={sugerido != null ? precoTxt(sugerido) : 'ex. 14,00'}
          className="w-24 border border-[#3D2314]/15 rounded px-1.5 py-0.5 text-[11px] text-[#3D2314] bg-white" />
        <button type="button" onClick={() => void gravar()} disabled={salvando || !valor.trim()}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#3D2314] text-white font-medium hover:bg-[#2A1810] disabled:opacity-50 min-h-[28px]">
          {salvando ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Gravar preço
        </button>
        {editado && sugerido != null && (
          <button type="button" onClick={() => { setEditado(false); setValor(precoTxt(sugerido)) }}
            className="px-2 py-0.5 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-white min-h-[28px]">usar o sugerido</button>
        )}
      </label>
      <div className="mt-1">
        {ef == null ? 'Carregando o markup…'
          : ef.origem == null ? <>Sem markup no produto nem geral da empresa — defina em <Link href="/dashboard/compras/precificacao" className="text-[#BA7517] font-medium hover:underline">Compras › Precificação</Link> para o preço vir sugerido.</>
          : custo == null ? <>Markup {ef.origem === 'produto' ? 'do produto' : 'geral'} {pctTxt(ef.markup_pct)} — calcule o custo desta linha para sugerir o preço.</>
          : <>Sugerido <strong className="text-[#3D2314]">{brl(sugerido)}</strong> = custo {brl(custo)} + markup {ef.origem === 'produto' ? 'do produto' : 'geral da empresa'} {pctTxt(ef.markup_pct)}.</>}
        {' '}Preço atual: <strong className="text-[#3D2314]">{brl(atual)}</strong>.
      </div>
      {msg && <div className={'mt-0.5 ' + (msg.ok ? 'text-[#3F7012]' : 'text-[#A32D2D]')}>{msg.texto}</div>}
    </div>
  )
}
