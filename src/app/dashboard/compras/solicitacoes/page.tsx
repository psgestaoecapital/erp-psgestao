'use client'

// #1677 (B2) · Solicitações de compra — o funcionário pede a compra com os itens e anexa os orçamentos (3 ou 1, pela
// alçada); o aprovador principal ou o substituto aprova ou recusa com motivo. Toda escrita passa pelas RPCs
// fn_compras_solicitacao_* (guarda de empresa, quem pede não aprova). Arquivos no bucket privado compras-orcamentos.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Loader2, Plus, Trash2, Paperclip, Check, X, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { AlcadaConfig } from '@/lib/compras/alcada'
import {
  ITEM_VAZIO, STATUS_ROTULO, caminhoOrcamento, lerQuantidade, pendenciasEnvio, validarSolicitacaoForm, type ItemForm,
} from '@/lib/compras/solicitacao'

const BUCKET = 'compras-orcamentos'

type Item = { id: string; produto_id: string | null; descricao: string; categoria: string | null; quantidade: number; unidade: string | null }
type Orcamento = { id: string; fornecedor_nome: string; valor_total: number; prazo_entrega: string | null; observacao: string | null; arquivo_path: string | null; arquivo_nome: string | null }
type Solicitacao = {
  id: string; numero: number; titulo: string; justificativa: string | null; urgente: boolean; status: string
  criado_em: string; enviada_em: string | null; decidido_em: string | null; decisao_motivo: string | null
  minha: boolean; posso_decidir: boolean; solicitante_nome: string | null; decidido_por_nome: string | null
  itens: Item[]; orcamentos: Orcamento[]
}
type Alcada = AlcadaConfig & { configurada: boolean; aprovador_principal_id: string | null }
type Produto = { id: string; nome: string; categoria: string | null; unidade: string | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const data = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')
const FILTROS = [
  { id: 'aguardando_aprovacao', rotulo: 'Aguardando aprovação' },
  { id: 'rascunho', rotulo: 'Rascunhos' },
  { id: 'aprovada', rotulo: 'Aprovadas' },
  { id: 'recusada', rotulo: 'Recusadas' },
  { id: 'todas', rotulo: 'Todas' },
] as const
const COR: Record<string, string> = {
  rascunho: 'bg-gray-100 text-gray-700', aguardando_aprovacao: 'bg-amber-50 text-amber-800',
  aprovada: 'bg-emerald-50 text-emerald-800', recusada: 'bg-red-50 text-red-700', cancelada: 'bg-gray-100 text-gray-500',
}

export default function SolicitacoesCompraPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [lista, setLista] = useState<Solicitacao[]>([])
  const [alcada, setAlcada] = useState<Alcada | null>(null)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [filtro, setFiltro] = useState<string>('aguardando_aprovacao')
  const [aberta, setAberta] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  // formulário (nova ou rascunho)
  const [form, setForm] = useState<{ id: string | null; titulo: string; justificativa: string; urgente: boolean; itens: ItemForm[] } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) { setLista([]); setLoading(false); return }
    setLoading(true)
    const [{ data: d, error }, { data: prods }] = await Promise.all([
      supabase.rpc('fn_compras_solicitacao_listar', { p_company_id: empresa }),
      supabase.from('erp_produtos').select('id, nome, categoria, unidade').eq('company_id', empresa).eq('ativo', true).order('nome').limit(3000),
    ])
    setLoading(false)
    if (error || !d) { setMsg({ tipo: 'erro', texto: error?.message ?? 'Não foi possível ler as solicitações.' }); return }
    const r = d as { solicitacoes: Solicitacao[]; alcada: Alcada }
    setLista(r.solicitacoes ?? [])
    setAlcada(r.alcada ?? null)
    setProdutos((prods ?? []) as Produto[])
  }, [empresa])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as solicitações quando a empresa muda
  useEffect(() => { carregar() }, [carregar])

  const visiveis = useMemo(
    () => lista.filter((s) => (filtro === 'todas' ? true : s.status === filtro)),
    [lista, filtro],
  )
  const contagem = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of lista) c[s.status] = (c[s.status] ?? 0) + 1
    return c
  }, [lista])

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setMsg(null)
    const { data: d, error } = await supabase.rpc(fn, args)
    const r = d as { sucesso?: boolean; erro?: string; id?: string } | null
    if (error || !r?.sucesso) { setMsg({ tipo: 'erro', texto: error?.message ?? r?.erro ?? 'Não foi possível concluir.' }); return null }
    setMsg({ tipo: 'ok', texto: ok })
    await carregar()
    return r
  }

  const novo = () => { setForm({ id: null, titulo: '', justificativa: '', urgente: false, itens: [{ ...ITEM_VAZIO }] }); setMsg(null) }
  const editar = (s: Solicitacao) => setForm({
    id: s.id, titulo: s.titulo, justificativa: s.justificativa ?? '', urgente: s.urgente,
    itens: s.itens.map((i) => ({ produto_id: i.produto_id ?? '', descricao: i.descricao, categoria: i.categoria ?? '', quantidade: String(i.quantidade).replace('.', ','), unidade: i.unidade ?? '' })),
  })

  const salvar = async () => {
    if (!empresa || !form) return
    const erro = validarSolicitacaoForm(form)
    if (erro) { setMsg({ tipo: 'erro', texto: erro }); return }
    setSalvando(true)
    const r = await rpc('fn_compras_solicitacao_salvar', {
      p_company_id: empresa,
      p_dados: {
        id: form.id, titulo: form.titulo, justificativa: form.justificativa, urgente: form.urgente,
        itens: form.itens.map((i) => ({ produto_id: i.produto_id || null, descricao: i.descricao, categoria: i.categoria || null, quantidade: lerQuantidade(i.quantidade), unidade: i.unidade || null })),
      },
    }, 'Rascunho salvo. Agora anexe os orçamentos e envie para aprovação.')
    setSalvando(false)
    if (r?.id) { setForm(null); setAberta(r.id); setFiltro('rascunho') }
  }

  const setItem = (idx: number, patch: Partial<ItemForm>) =>
    setForm((f) => (f ? { ...f, itens: f.itens.map((i, k) => (k === idx ? { ...i, ...patch } : i)) } : f))
  const escolherProduto = (idx: number, id: string) => {
    const p = produtos.find((x) => x.id === id)
    setItem(idx, p ? { produto_id: p.id, descricao: p.nome, categoria: p.categoria ?? '', unidade: p.unidade ?? 'UN' } : { produto_id: '' })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-1 h-7 w-7 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Solicitações de compra</h1>
            <p className="mt-1 text-sm text-gray-600">Peça a compra com os orçamentos; o aprovador da empresa aprova ou recusa.</p>
          </div>
        </div>
        {empresa && !form && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={novo}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nova solicitação
            </button>
            <AjudaCampo chave="compras.solic.nova" />
          </div>
        )}
      </header>

      {!empresa && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Escolha uma empresa no topo da tela.</p>}
      {msg && <p className={`rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>}
      {empresa && alcada && !alcada.configurada && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          A alçada ainda não foi configurada: as solicitações podem ser montadas, mas só são enviadas depois que um Master definir o aprovador em Compras &gt; Alçada de compras.
        </p>
      )}

      {empresa && form && (
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-lg font-semibold text-gray-900">{form.id ? 'Editar rascunho' : 'Nova solicitação'}</h2>
          <label className="block">
            <span className="flex items-center gap-1 text-sm font-medium text-gray-800">O que comprar <AjudaCampo chave="compras.solic.titulo" /></span>
            <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} maxLength={200}
              placeholder="Ex.: Pastilhas de freio para estoque" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
          </label>
          <label className="block">
            <span className="flex items-center gap-1 text-sm font-medium text-gray-800">Justificativa <AjudaCampo chave="compras.solic.justificativa" /></span>
            <textarea value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} rows={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={form.urgente} onChange={(e) => setForm({ ...form, urgente: e.target.checked })} className="h-5 w-5" />
            Compra urgente (sem esperar orçamentos) <AjudaCampo chave="compras.solic.urgente" />
          </label>

          <div className="space-y-3">
            <span className="text-sm font-medium text-gray-800">Itens</span>
            {form.itens.map((it, idx) => (
              <div key={idx} className="grid gap-2 rounded-xl border border-gray-200 p-3 md:grid-cols-12">
                <label className="md:col-span-12">
                  <span className="flex items-center gap-1 text-xs text-gray-600">Produto do cadastro <AjudaCampo chave="compras.solic.item_produto" /></span>
                  <select value={it.produto_id} onChange={(e) => escolherProduto(idx, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base">
                    <option value="">— item avulso —</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
                <label className="md:col-span-6">
                  <span className="flex items-center gap-1 text-xs text-gray-600">Descrição <AjudaCampo chave="compras.solic.item_descricao" /></span>
                  <input value={it.descricao} onChange={(e) => setItem(idx, { descricao: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
                </label>
                <label className="md:col-span-2">
                  <span className="flex items-center gap-1 text-xs text-gray-600">Quantidade <AjudaCampo chave="compras.solic.item_quantidade" /></span>
                  <input inputMode="decimal" value={it.quantidade} onChange={(e) => setItem(idx, { quantidade: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
                </label>
                <label className="md:col-span-1">
                  <span className="flex items-center gap-1 text-xs text-gray-600">Unid. <AjudaCampo chave="compras.solic.item_unidade" /></span>
                  <input value={it.unidade} onChange={(e) => setItem(idx, { unidade: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-base" />
                </label>
                <label className="md:col-span-3">
                  <span className="flex items-center gap-1 text-xs text-gray-600">Categoria <AjudaCampo chave="compras.solic.item_categoria" /></span>
                  <div className="mt-1 flex gap-1">
                    <input value={it.categoria} disabled={!!it.produto_id} onChange={(e) => setItem(idx, { categoria: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base disabled:bg-gray-50" />
                    {form.itens.length > 1 && (
                      <button type="button" aria-label="Tirar item" onClick={() => setForm({ ...form, itens: form.itens.filter((_, k) => k !== idx) })}
                        className="rounded-lg border border-gray-300 px-2 text-gray-500"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </label>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setForm({ ...form, itens: [...form.itens, { ...ITEM_VAZIO }] })}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"><Plus className="h-4 w-4" /> Adicionar item</button>
              <AjudaCampo chave="compras.solic.adicionar_item" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={salvar} disabled={salvando}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar rascunho
            </button>
            <AjudaCampo chave="compras.solic.salvar" />
            <button type="button" onClick={() => setForm(null)} className="rounded-lg px-4 py-2.5 text-sm text-gray-600">Voltar</button>
          </div>
        </section>
      )}

      {empresa && !form && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${filtro === f.id ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800' : 'border-gray-300 text-gray-700'}`}>
                {f.rotulo}{f.id !== 'todas' && contagem[f.id] ? ` (${contagem[f.id]})` : ''}
              </button>
            ))}
            <AjudaCampo chave="compras.solic.filtro_status" />
          </div>

          {loading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>}
          {!loading && visiveis.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">Nenhuma solicitação nesta situação.</p>}

          <ul className="space-y-3">
            {visiveis.map((s) => (
              <li key={s.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <button type="button" onClick={() => setAberta(aberta === s.id ? null : s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left">
                  <div>
                    <p className="font-semibold text-gray-900">#{s.numero} · {s.titulo} {s.urgente && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">urgente</span>}</p>
                    <p className="text-xs text-gray-500">{s.solicitante_nome ?? '—'} · {data(s.criado_em)} · {s.itens.length} item(ns) · {s.orcamentos.length} orçamento(s)</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${COR[s.status] ?? ''}`}>{STATUS_ROTULO[s.status] ?? s.status}</span>
                </button>
                {aberta === s.id && (
                  <Detalhe s={s} empresa={empresa} alcada={alcada} rpc={rpc} editar={() => editar(s)} setMsg={setMsg} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Detalhe({ s, empresa, alcada, rpc, editar, setMsg }: {
  s: Solicitacao; empresa: string; alcada: Alcada | null
  rpc: (fn: string, args: Record<string, unknown>, ok: string) => Promise<unknown>
  editar: () => void; setMsg: (m: { tipo: 'ok' | 'erro'; texto: string } | null) => void
}) {
  const [orc, setOrc] = useState({ fornecedor: '', valor: '', prazo: '' })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const rascunhoMeu = s.minha && s.status === 'rascunho'
  const pend = pendenciasEnvio({ urgente: s.urgente, itens: s.itens, orcamentos: s.orcamentos.length }, alcada)

  const abrirArquivo = async (path: string) => {
    const { data: d, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !d?.signedUrl) { setMsg({ tipo: 'erro', texto: 'Não foi possível abrir o arquivo.' }); return }
    window.open(d.signedUrl, '_blank', 'noopener')
  }

  const anexar = async () => {
    const valor = lerQuantidade(orc.valor)
    if (!orc.fornecedor.trim() || !(valor > 0)) { setMsg({ tipo: 'erro', texto: 'Informe o fornecedor e o valor total.' }); return }
    setOcupado(true)
    let path: string | null = null
    if (arquivo) {
      if (arquivo.size > 10 * 1024 * 1024) { setOcupado(false); setMsg({ tipo: 'erro', texto: 'Arquivo maior que 10 MB.' }); return }
      path = caminhoOrcamento(empresa, s.id, arquivo.name)
      const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: arquivo.type || undefined })
      if (error) { setOcupado(false); setMsg({ tipo: 'erro', texto: `Não foi possível enviar o arquivo: ${error.message}` }); return }
    }
    const r = await rpc('fn_compras_solicitacao_orcamento_adicionar', {
      p_solicitacao_id: s.id,
      p_dados: { fornecedor_nome: orc.fornecedor, valor_total: valor, prazo_entrega: orc.prazo, arquivo_path: path, arquivo_nome: arquivo?.name ?? null },
    }, 'Orçamento anexado.')
    setOcupado(false)
    if (r) { setOrc({ fornecedor: '', valor: '', prazo: '' }); setArquivo(null) }
  }

  const acao = async (fn: string, args: Record<string, unknown>, ok: string) => { setOcupado(true); await rpc(fn, args, ok); setOcupado(false) }

  return (
    <div className="space-y-4 border-t border-gray-100 p-4">
      {s.justificativa && <p className="text-sm text-gray-700"><span className="font-medium">Justificativa:</span> {s.justificativa}</p>}
      <div>
        <p className="text-sm font-medium text-gray-800">Itens</p>
        <ul className="mt-1 divide-y divide-gray-100 text-sm">
          {s.itens.map((i) => (
            <li key={i.id} className="flex justify-between gap-2 py-1.5">
              <span>{i.descricao}{i.categoria ? <span className="text-gray-500"> · {i.categoria}</span> : null}</span>
              <span className="whitespace-nowrap text-gray-700">{Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade ?? ''}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-800">Orçamentos (do menor para o maior)</p>
        {s.orcamentos.length === 0 && <p className="mt-1 text-sm text-gray-500">Nenhum orçamento anexado.</p>}
        <ul className="mt-1 divide-y divide-gray-100 text-sm">
          {s.orcamentos.map((o, k) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{k === 0 && s.orcamentos.length > 1 && <span className="mr-1 rounded bg-emerald-50 px-1.5 text-xs text-emerald-800">menor</span>}{o.fornecedor_nome}{o.prazo_entrega ? <span className="text-gray-500"> · {o.prazo_entrega}</span> : null}</span>
              <span className="flex items-center gap-2">
                <span className="font-medium">{brl(Number(o.valor_total))}</span>
                {o.arquivo_path && <button type="button" onClick={() => abrirArquivo(o.arquivo_path!)} className="inline-flex items-center gap-1 text-emerald-700 underline"><Paperclip className="h-3.5 w-3.5" />{o.arquivo_nome ?? 'arquivo'}</button>}
                {rascunhoMeu && <button type="button" aria-label="Tirar orçamento" onClick={() => acao('fn_compras_solicitacao_orcamento_remover', { p_orcamento_id: o.id }, 'Orçamento removido.')} className="text-gray-400"><Trash2 className="h-4 w-4" /></button>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {rascunhoMeu && (
        <div className="grid gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-12">
          <label className="md:col-span-5">
            <span className="flex items-center gap-1 text-xs text-gray-600">Fornecedor <AjudaCampo chave="compras.solic.orc_fornecedor" /></span>
            <input value={orc.fornecedor} onChange={(e) => setOrc({ ...orc, fornecedor: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="md:col-span-3">
            <span className="flex items-center gap-1 text-xs text-gray-600">Valor total <AjudaCampo chave="compras.solic.orc_valor" /></span>
            <input inputMode="decimal" value={orc.valor} onChange={(e) => setOrc({ ...orc, valor: e.target.value })} placeholder="0,00" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="md:col-span-4">
            <span className="flex items-center gap-1 text-xs text-gray-600">Prazo de entrega <AjudaCampo chave="compras.solic.orc_prazo" /></span>
            <input value={orc.prazo} onChange={(e) => setOrc({ ...orc, prazo: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
          </label>
          <label className="md:col-span-8">
            <span className="flex items-center gap-1 text-xs text-gray-600">Arquivo (PDF ou foto) <AjudaCampo chave="compras.solic.orc_arquivo" /></span>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" />
          </label>
          <div className="flex items-end gap-1 md:col-span-4">
            <button type="button" onClick={anexar} disabled={ocupado} className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 px-3 py-2 text-sm text-emerald-700 disabled:opacity-60">
              <Paperclip className="h-4 w-4" /> Anexar orçamento
            </button>
            <AjudaCampo chave="compras.solic.orc_adicionar" />
          </div>
        </div>
      )}

      {rascunhoMeu && pend.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-lg bg-amber-50 p-3 pl-7 text-sm text-amber-800">{pend.map((p) => <li key={p}>{p}</li>)}</ul>
      )}

      {s.decidido_em && (
        <p className="text-sm text-gray-700">{STATUS_ROTULO[s.status]} por {s.decidido_por_nome ?? '—'} em {data(s.decidido_em)}{s.decisao_motivo ? ` — ${s.decisao_motivo}` : ''}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {rascunhoMeu && (
          <>
            <button type="button" onClick={editar} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Editar itens</button>
            <button type="button" disabled={ocupado || pend.length > 0} onClick={() => acao('fn_compras_solicitacao_enviar', { p_id: s.id }, 'Enviada para aprovação.')}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Send className="h-4 w-4" /> Enviar para aprovação
            </button>
            <AjudaCampo chave="compras.solic.enviar" />
          </>
        )}
        {s.minha && ['rascunho', 'aguardando_aprovacao'].includes(s.status) && (
          <>
            <button type="button" disabled={ocupado} onClick={() => { if (confirm('Cancelar esta solicitação?')) acao('fn_compras_solicitacao_cancelar', { p_id: s.id }, 'Solicitação cancelada.') }}
              className="rounded-lg px-3 py-2 text-sm text-red-700">Cancelar solicitação</button>
            <AjudaCampo chave="compras.solic.cancelar" />
          </>
        )}
      </div>

      {s.posso_decidir && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <label className="block">
            <span className="flex items-center gap-1 text-sm font-medium text-gray-800">Motivo / observação <AjudaCampo chave="compras.solic.motivo" /></span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={ocupado} onClick={() => acao('fn_compras_solicitacao_decidir', { p_id: s.id, p_aprovar: true, p_motivo: motivo || null }, 'Compra aprovada.')}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" /> Aprovar</button>
            <AjudaCampo chave="compras.solic.aprovar" />
            <button type="button" disabled={ocupado || !motivo.trim()} onClick={() => acao('fn_compras_solicitacao_decidir', { p_id: s.id, p_aprovar: false, p_motivo: motivo }, 'Compra recusada.')}
              className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"><X className="h-4 w-4" /> Recusar</button>
            <AjudaCampo chave="compras.solic.recusar" />
          </div>
        </div>
      )}
    </div>
  )
}
