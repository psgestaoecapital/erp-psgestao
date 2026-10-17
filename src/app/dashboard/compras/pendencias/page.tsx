'use client'

// #1677 (B3) · Pendências de compra — tela do comprador. A solicitação aprovada vira pendência; o comprador gera a cotação
// sem redigitar (fn_compras_solicitacao_gerar_cotacao) e segue na tela de Cotações que já existe (WhatsApp, propostas,
// comparativo, fornecedor vencedor → pedido de compra). Leitura e escrita só pelas RPCs com guarda de empresa.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingCart, Loader2, Paperclip, FileText, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { BotaoOrdemFornecimento } from '@/components/compras/OrdemFornecimento'
import { FILTROS_PENDENCIA, SITUACAO_ROTULO, filtrarPorSituacao, linkCotacao, type Situacao } from '@/lib/compras/pendencias'

const BUCKET = 'compras-orcamentos'

type Item = { id: string; descricao: string; quantidade: number; unidade: string | null }
type Orcamento = { id: string; fornecedor_nome: string; valor_total: number; prazo_entrega: string | null; arquivo_path: string | null; arquivo_nome: string | null }
type Compra = { id: string; numero: string | null; fornecedor_nome: string | null; total: number | null; status: string | null }
type Pendencia = {
  id: string; numero: number; titulo: string; justificativa: string | null; urgente: boolean
  decidido_em: string | null; decisao_motivo: string | null; solicitante_nome: string | null; aprovado_por_nome: string | null
  situacao: Situacao
  cotacao: { id: string; numero: string; status: string; fornecedores: number; compra: Compra | null } | null
  itens: Item[]; orcamentos: Orcamento[]
}

const brl = (v: number | null) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const data = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')
const COR: Record<Situacao, string> = {
  pendente: 'bg-amber-50 text-amber-800', em_cotacao: 'bg-sky-50 text-sky-800', comprada: 'bg-emerald-50 text-emerald-800',
}

export default function PendenciasCompraPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [lista, setLista] = useState<Pendencia[]>([])
  const [filtro, setFiltro] = useState<string>('pendente')
  const [aberta, setAberta] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLista([]); setLoading(false); return }
    setLoading(true)
    const { data: d, error } = await supabase.rpc('fn_compras_pendencias_listar', { p_company_id: empresa })
    setLoading(false)
    if (error || !d) { setMsg({ tipo: 'erro', texto: error?.message ?? 'Não foi possível ler as pendências.' }); return }
    setLista(((d as { pendencias: Pendencia[] }).pendencias) ?? [])
  }, [empresa])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as pendências quando a empresa muda
  useEffect(() => { carregar() }, [carregar])

  const visiveis = useMemo(() => filtrarPorSituacao(lista, filtro), [lista, filtro])
  const contagem = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of lista) c[p.situacao] = (c[p.situacao] ?? 0) + 1
    return c
  }, [lista])

  const gerarCotacao = async (p: Pendencia) => {
    setMsg(null); setOcupado(p.id)
    const { data: d, error } = await supabase.rpc('fn_compras_solicitacao_gerar_cotacao', { p_id: p.id })
    setOcupado(null)
    const r = d as { sucesso?: boolean; erro?: string; cotacao_id?: string; numero?: string; ja_existia?: boolean } | null
    if (error || !r?.sucesso || !r.cotacao_id) { setMsg({ tipo: 'erro', texto: error?.message ?? r?.erro ?? 'Não foi possível gerar a cotação.' }); return }
    setMsg({ tipo: 'ok', texto: r.ja_existia ? `A cotação ${r.numero} já existia. Abrindo…` : `Cotação ${r.numero} criada. Abrindo…` })
    router.push(linkCotacao(r.cotacao_id))
  }

  const abrirArquivo = async (path: string) => {
    const { data: d, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error || !d?.signedUrl) { setMsg({ tipo: 'erro', texto: 'Não foi possível abrir o arquivo.' }); return }
    window.open(d.signedUrl, '_blank', 'noopener')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header className="flex items-start gap-3">
        <ShoppingCart className="mt-1 h-7 w-7 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pendências de compra</h1>
          <p className="mt-1 text-sm text-gray-600">Compras aprovadas esperando o comprador: gere a cotação, compare os fornecedores e feche o pedido.</p>
        </div>
      </header>

      {!empresa && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Escolha uma empresa no topo da tela.</p>}
      {msg && <p className={`rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>}

      {empresa && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTROS_PENDENCIA.map((f) => (
              <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${filtro === f.id ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800' : 'border-gray-300 text-gray-700'}`}>
                {f.rotulo}{f.id !== 'todas' && contagem[f.id] ? ` (${contagem[f.id]})` : ''}
              </button>
            ))}
            <AjudaCampo chave="compras.pend.filtro_situacao" />
          </div>

          {loading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>}
          {!loading && visiveis.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">Nenhuma compra nesta situação.</p>}

          <ul className="space-y-3">
            {visiveis.map((p) => (
              <li key={p.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <button type="button" onClick={() => setAberta(aberta === p.id ? null : p.id)} className="min-w-0 flex-1 text-left">
                    <p className="font-semibold text-gray-900">#{p.numero} · {p.titulo} {p.urgente && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">urgente</span>}</p>
                    <p className="text-xs text-gray-500">
                      {p.solicitante_nome ?? '—'} · aprovada por {p.aprovado_por_nome ?? '—'} em {data(p.decidido_em)} · {p.itens.length} item(ns)
                      {p.cotacao ? ` · cotação ${p.cotacao.numero} (${p.cotacao.fornecedores} fornecedor(es))` : ''}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${COR[p.situacao]}`}>{SITUACAO_ROTULO[p.situacao]}</span>
                    {p.cotacao ? (
                      <>
                        <button type="button" onClick={() => router.push(linkCotacao(p.cotacao!.id))}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 px-3 py-2 text-sm text-emerald-700">
                          <ExternalLink className="h-4 w-4" /> Abrir cotação
                        </button>
                        <AjudaCampo chave="compras.pend.abrir_cotacao" />
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={ocupado === p.id} onClick={() => gerarCotacao(p)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                          {ocupado === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Gerar cotação
                        </button>
                        <AjudaCampo chave="compras.pend.gerar_cotacao" />
                      </>
                    )}
                  </div>
                </div>

                {p.cotacao?.compra && (
                  <p className="flex flex-wrap items-center gap-1 border-t border-gray-100 px-4 py-2 text-sm text-emerald-800">
                    Pedido {p.cotacao.compra.numero ?? ''} — {p.cotacao.compra.fornecedor_nome ?? '—'} — {brl(p.cotacao.compra.total)}
                    <AjudaCampo chave="compras.pend.pedido" />
                    <span className="ml-auto"><BotaoOrdemFornecimento compraId={p.cotacao.compra.id} /></span>
                  </p>
                )}

                {aberta === p.id && (
                  <div className="space-y-4 border-t border-gray-100 p-4">
                    {p.justificativa && <p className="text-sm text-gray-700"><span className="font-medium">Justificativa:</span> {p.justificativa}</p>}
                    {p.decisao_motivo && <p className="text-sm text-gray-700"><span className="font-medium">Observação do aprovador:</span> {p.decisao_motivo}</p>}
                    <div>
                      <p className="text-sm font-medium text-gray-800">Itens</p>
                      <ul className="mt-1 divide-y divide-gray-100 text-sm">
                        {p.itens.map((i) => (
                          <li key={i.id} className="flex justify-between gap-2 py-1.5">
                            <span>{i.descricao}</span>
                            <span className="whitespace-nowrap text-gray-700">{Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade ?? ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="flex items-center gap-1 text-sm font-medium text-gray-800">Orçamentos da solicitação <AjudaCampo chave="compras.pend.orcamentos" /></p>
                      {p.orcamentos.length === 0 && <p className="mt-1 text-sm text-gray-500">Compra urgente, sem orçamentos anexados.</p>}
                      <ul className="mt-1 divide-y divide-gray-100 text-sm">
                        {p.orcamentos.map((o) => (
                          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                            <span>{o.fornecedor_nome}{o.prazo_entrega ? <span className="text-gray-500"> · {o.prazo_entrega}</span> : null}</span>
                            <span className="flex items-center gap-2">
                              <span className="font-medium">{brl(Number(o.valor_total))}</span>
                              {o.arquivo_path && <button type="button" onClick={() => abrirArquivo(o.arquivo_path!)} className="inline-flex items-center gap-1 text-emerald-700 underline"><Paperclip className="h-3.5 w-3.5" />{o.arquivo_nome ?? 'arquivo'}</button>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
