'use client'

// Markup GERAL da empresa + ALTERAÇÃO EM MASSA do markup por produto, com PRÉVIA (chamado #2710 FCR · RD-55: nada grava
// sem conferir). Regra: produto com markup próprio usa o dele; sem o próprio, usa o geral.
// Banco: fn_preco_markup_geral_salvar e fn_preco_markup_produtos (p_gravar=false = prévia; true = grava).

import { useState } from 'react'
import { Check, Eye, Layers, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

type LinhaPrevia = {
  produto_id: string; codigo: string; nome: string; custo: number
  markup_antes: number | null; origem_antes: string | null
  markup_depois: number | null; origem_depois: string | null; preco_sugerido_depois: number | null
}
type Resp = { ok?: boolean; erro?: string; gravado?: boolean; total?: number; markup_geral_pct?: number | null; produtos?: LinhaPrevia[] }

const brl = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTxt = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const num = (s: string): number | null => { const t = s.trim().replace(/\s/g, '').replace(',', '.'); const n = Number(t); return t === '' || Number.isNaN(n) ? null : n }
const ERROS: Record<string, string> = {
  sem_selecao: 'Escolha quais produtos (categoria, fornecedor, busca) ou marque "Todos os produtos".',
  markup_invalido: 'Informe um markup entre 0 e 1000%.',
  sem_permissao: 'Seu perfil não pode alterar preço.',
  sem_acesso: 'Sem acesso a esta empresa.',
  nenhum_produto: 'Nenhum produto nesse filtro.',
}

export default function MarkupPadraoCard({ companyId, markupGeral, onMudou }: {
  companyId: string; markupGeral: number | null | undefined; onMudou: () => void
}) {
  const [geralIn, setGeralIn] = useState('')
  const [salvandoGeral, setSalvandoGeral] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [acao, setAcao] = useState<'definir' | 'remover'>('definir')
  const [mkIn, setMkIn] = useState('')
  const [todos, setTodos] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [busca, setBusca] = useState('')
  const [previa, setPrevia] = useState<Resp | null>(null)
  const [trabalhando, setTrabalhando] = useState(false)

  // re-sincroniza o campo quando o markup geral GRAVADO muda (padrão "estado derivado da prop", sem efeito)
  const [geralSync, setGeralSync] = useState<number | null | undefined>(undefined)
  if (geralSync !== markupGeral) {
    setGeralSync(markupGeral)
    setGeralIn(markupGeral != null ? String(markupGeral).replace('.', ',') : '')
  }

  async function salvarGeral() {
    const v = num(geralIn)
    if (geralIn.trim() !== '' && (v == null || v < 0)) { setMsg('Markup geral inválido.'); return }
    setSalvandoGeral(true); setMsg(null)
    const { data } = await supabase.rpc('fn_preco_markup_geral_salvar', { p_company_id: companyId, p_markup_pct: v })
    setSalvandoGeral(false)
    const r = data as Resp | null
    if (!r?.ok) { setMsg(ERROS[r?.erro ?? ''] ?? 'Não consegui salvar o markup geral.'); return }
    setMsg(v == null ? 'Markup geral retirado.' : `Markup geral de ${pctTxt(v)} salvo. Vale para todo produto sem markup próprio.`)
    setPrevia(null)
    onMudou()
  }

  // mudar qualquer escolha invalida a prévia (o que está na tela tem de ser exatamente o que vai gravar)
  const mudou = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPrevia(null) }

  async function rodar(gravar: boolean) {
    setTrabalhando(true); setMsg(null)
    const { data } = await supabase.rpc('fn_preco_markup_produtos', {
      p_company_id: companyId, p_markup_pct: acao === 'remover' ? null : num(mkIn), p_remover: acao === 'remover',
      p_produto_ids: null, p_categoria: categoria.trim() || null, p_fornecedor: fornecedor.trim() || null,
      p_busca: busca.trim() || null, p_todos: todos, p_gravar: gravar,
    })
    setTrabalhando(false)
    const r = data as Resp | null
    if (!r?.ok) { setMsg(ERROS[r?.erro ?? ''] ?? 'Não consegui calcular.'); setPrevia(null); return }
    if (!gravar) { setPrevia(r); return }
    setMsg(`Markup gravado em ${r.total} produto(s).`)
    setPrevia(null)
    onMudou()
  }

  async function confirmarGravar() {
    if (!previa?.total) return
    if (!confirm(`Gravar o markup em ${previa.total} produto(s)? Fica registrado na auditoria.`)) return
    await rodar(true)
  }

  return (
    <div className="mt-3 bg-white border border-[#3D2314]/10 rounded-xl p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-[#3D2314] mb-2"><Layers size={15} className="text-[#C8941A]" /> Markup padrão</div>

      {/* Markup geral */}
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
          <span className="flex items-center">Markup geral da empresa<AjudaCampo chave="compras.precificacao.markup_geral" /></span>
          <div className="mt-0.5 flex items-center gap-1">
            <input type="text" inputMode="decimal" value={geralIn} onChange={(e) => setGeralIn(e.target.value)} placeholder="ex. 30" className="w-24 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314]" />
            <span className="text-[13px] text-[#3D2314]/60">%</span>
          </div>
        </label>
        <button type="button" onClick={() => void salvarGeral()} disabled={salvandoGeral} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#3D2314] text-white font-medium hover:bg-[#2A1810] disabled:opacity-50">
          {salvandoGeral ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Salvar geral
        </button>
        <span className="text-[11px] text-[#3D2314]/55 self-center">Produto com markup próprio usa o dele; os demais usam o geral.</span>
      </div>

      {/* Alteração em massa */}
      <div className="mt-3 pt-3 border-t border-[#3D2314]/8">
        <div className="flex items-center text-[12px] font-medium text-[#3D2314] mb-1.5">Alterar o markup de vários produtos<AjudaCampo chave="compras.precificacao.markup_massa" /></div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
            <span className="flex items-center">O que fazer<AjudaCampo chave="compras.precificacao.markup_produto" /></span>
            <select value={acao} onChange={(e) => mudou(setAcao)(e.target.value as 'definir' | 'remover')} className="mt-0.5 text-[13px] border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[#3D2314]">
              <option value="definir">Definir markup próprio</option>
              <option value="remover">Voltar ao markup geral</option>
            </select>
          </label>
          {acao === 'definir' && (
            <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
              <span className="flex items-center">Novo markup<AjudaCampo chave="compras.precificacao.markup_produto" /></span>
              <div className="mt-0.5 flex items-center gap-1">
                <input type="text" inputMode="decimal" value={mkIn} onChange={(e) => mudou(setMkIn)(e.target.value)} placeholder="ex. 40" className="w-20 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314]" />
                <span className="text-[13px] text-[#3D2314]/60">%</span>
              </div>
            </label>
          )}
          <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
            <span className="flex items-center">Categoria<AjudaCampo chave="compras.precificacao.markup_massa_filtro" /></span>
            <input value={categoria} onChange={(e) => mudou(setCategoria)(e.target.value)} disabled={todos} placeholder="ex. Tintas" className="mt-0.5 w-32 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] disabled:opacity-40" />
          </label>
          <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
            <span className="flex items-center">Fornecedor<AjudaCampo chave="compras.precificacao.markup_massa_filtro" /></span>
            <input value={fornecedor} onChange={(e) => mudou(setFornecedor)(e.target.value)} disabled={todos} placeholder="parte do nome" className="mt-0.5 w-32 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] disabled:opacity-40" />
          </label>
          <label className="text-[12px] text-[#3D2314]/70 flex flex-col">
            <span className="flex items-center">Produto<AjudaCampo chave="compras.precificacao.markup_massa_filtro" /></span>
            <input value={busca} onChange={(e) => mudou(setBusca)(e.target.value)} disabled={todos} placeholder="nome ou código" className="mt-0.5 w-32 border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] disabled:opacity-40" />
          </label>
          <label className="text-[12px] text-[#3D2314]/70 flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={todos} onChange={(e) => mudou(setTodos)(e.target.checked)} />
            Todos os produtos<AjudaCampo chave="compras.precificacao.markup_massa_filtro" />
          </label>
          <button type="button" onClick={() => void rodar(false)} disabled={trabalhando} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810] disabled:opacity-50">
            {trabalhando && !previa ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Ver prévia
          </button>
          {previa && (previa.total ?? 0) > 0 && (
            <button type="button" onClick={() => void confirmarGravar()} disabled={trabalhando} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510] disabled:opacity-50">
              {trabalhando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Gravar markup ({previa.total})
            </button>
          )}
        </div>

        {previa && (
          <div className="mt-2">
            <div className="text-[11px] text-[#B06A00] mb-1">Prévia — <strong>nada foi gravado</strong>. {previa.total} produto(s).</div>
            {(previa.total ?? 0) > 0 && (
              <div className="max-h-64 overflow-auto border border-[#3D2314]/8 rounded-md">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[#3D2314]/55 text-left border-b border-[#3D2314]/8">
                    <th className="px-2 py-1.5 font-medium">Produto</th>
                    <th className="px-2 py-1.5 font-medium text-right">Markup hoje</th>
                    <th className="px-2 py-1.5 font-medium text-right">Depois</th>
                    <th className="px-2 py-1.5 font-medium text-right">Preço sugerido</th>
                  </tr></thead>
                  <tbody>
                    {(previa.produtos ?? []).map((l) => (
                      <tr key={l.produto_id} className="border-b border-[#3D2314]/6">
                        <td className="px-2 py-1.5 text-[#3D2314]"><div className="truncate max-w-[220px]">{l.nome}</div><div className="text-[10px] text-[#3D2314]/50">cód {l.codigo}</div></td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[#3D2314]/70">{pctTxt(l.markup_antes)}{l.origem_antes && <span className="text-[10px] text-[#3D2314]/45"> · {l.origem_antes}</span>}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-[#3F7012]">{pctTxt(l.markup_depois)}{l.origem_depois && <span className="text-[10px] text-[#3D2314]/45 font-normal"> · {l.origem_depois}</span>}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{brl(l.preco_sugerido_depois)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-1 text-[11px] text-[#3D2314]/55">O markup não muda o preço de venda sozinho: depois de gravar, use “Formar preços › Markup padrão de cada produto” para gerar os preços.</div>
          </div>
        )}
      </div>
      {msg && <div className="mt-2 text-[12px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20">{msg}</div>}
    </div>
  )
}
