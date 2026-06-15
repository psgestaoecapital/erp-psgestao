'use client'

// fiscal-devolucao-venda-e-remessa-v1 · Parte A
// Tela: devolucao de venda. Seleciona NFe autorizada -> itens -> emite com
// finalidade='devolucao', chave_referenciada=chave da venda.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { ArrowLeft, Loader2, AlertCircle, RotateCcw, Plus } from 'lucide-react'

interface NFeVenda {
  id: string
  numero: string | null
  chave: string | null
  data_emissao: string | null
  destinatario_razao_social: string | null
  valor_total: number | null
  itens: Array<Record<string, unknown>> | null
}

interface ItemVenda {
  codigo: string | null
  descricao: string | null
  quantidade: number
  valorUnitario: number
  produtoId?: string
}

interface ItemDevol {
  produtoId: string
  codigo: string | null
  descricao: string
  quantidadeVendida: number
  quantidade: number
  cfopOverride: string
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

const fmtBRL = (v: number | null) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtData = (s: string | null) => {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('pt-BR') } catch { return '—' }
}

export default function DevolucaoVendaClient() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)
  const [vendas, setVendas] = useState<NFeVenda[]>([])
  const [vendaSelId, setVendaSelId] = useState('')
  const [natureza, setNatureza] = useState('Devolução de venda')
  const [itens, setItens] = useState<ItemDevol[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<{ numero: string; chave?: string } | null>(null)

  useEffect(() => {
    const cid = resolveCompanyId()
    if (!cid) { setErroEmpresa('Selecione uma empresa específica no trocador da TopNav.'); return }
    setCompanyId(cid)
  }, [])

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const { data } = await supabase
        .from('erp_nfe_emitidas')
        .select('id, numero, chave, data_emissao, destinatario_razao_social, valor_total, itens')
        .eq('company_id', companyId)
        .eq('status', 'autorizada')
        .eq('finalidade', 'normal')
        .order('data_emissao', { ascending: false })
        .limit(200)
      setVendas((data ?? []) as NFeVenda[])
    })()
  }, [companyId])

  useEffect(() => {
    if (!vendaSelId) { setItens([]); return }
    const venda = vendas.find((v) => v.id === vendaSelId)
    if (!venda || !Array.isArray(venda.itens)) { setItens([]); return }
    const lista: ItemDevol[] = []
    for (const itRaw of venda.itens) {
      const it = itRaw as ItemVenda & Record<string, unknown>
      const qtd = Number(it.quantidade ?? 0)
      lista.push({
        produtoId: String(it.produtoId ?? (it as Record<string, unknown>).produto_id ?? ''),
        codigo: typeof it.codigo === 'string' ? it.codigo : null,
        descricao: typeof it.descricao === 'string' ? it.descricao : '(sem descrição)',
        quantidadeVendida: qtd,
        quantidade: qtd,
        cfopOverride: '1202',
      })
    }
    setItens(lista)
  }, [vendaSelId, vendas])

  function atualizarItem(idx: number, patch: Partial<ItemDevol>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const itensValidos = itens.filter((i) => i.produtoId && i.quantidade > 0)
  const algumExcede = itensValidos.some((i) => i.quantidade > i.quantidadeVendida + 0.001)
  const podeEnviar = !!vendaSelId && itensValidos.length > 0 && !algumExcede && !enviando

  async function emitir() {
    if (!podeEnviar) return
    if (!confirm(`EMITIR NF-e de devolução de venda para ${itensValidos.length} item(ns)?\n\nCFOP/CST devem espelhar a venda (validar com contador).`)) return
    setEnviando(true); setErro(null); setSucesso(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/devolucao-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nfeVendaId: vendaSelId,
          naturezaOperacao: natureza,
          itens: itensValidos.map((it) => ({
            produtoId: it.produtoId,
            quantidade: it.quantidade,
            cfopOverride: it.cfopOverride.trim() || '1202',
          })),
        }),
      })
      const json = await resp.json()
      if (!resp.ok || json?.ok === false) {
        setErro(json?.mensagem ?? json?.motivoRejeicao ?? 'Falha ao emitir')
        setEnviando(false); return
      }
      setSucesso({ numero: String(json.numero ?? '?'), chave: json.chave })
      setEnviando(false)
      alert(`EMITIU NF-e de devolução de venda nº ${json.numero}.`)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro ao emitir')
      setEnviando(false)
    }
  }

  if (erroEmpresa) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-[#FCEBEB] text-[#A32D2D] p-4 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>{erroEmpresa}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/dashboard/fiscal/nfe" className="text-[#3D2314]/65 hover:text-[#3D2314] flex items-center gap-1.5 text-[12.5px]">
          <ArrowLeft size={14} /> NF-e
        </Link>
        <span className="text-[#3D2314]/30">/</span>
        <h1 className="text-[18px] font-semibold text-[#3D2314] flex items-center gap-1.5">
          <RotateCcw size={16} /> Devolução de venda
        </h1>
      </div>

      <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[11.5px] text-[#3D2314]/85 leading-snug">
        <strong>Atenção (Pilar 1):</strong> CFOP de devolução de venda = entrada. Padrão: <strong>1202</strong> (dentro do estado) / <strong>2202</strong> (fora). Se ICMS-ST, use <strong>1411/2411</strong>. CST/CSOSN devem espelhar a venda original. Validar com contador antes de produção.
      </div>

      {sucesso && (
        <div className="mb-4 p-3 bg-[#E7F4EC] border border-[#1B873F]/40 rounded-lg text-[12.5px] text-[#1B873F]">
          ✓ EMITIU NF-e de devolução de venda nº <strong>{sucesso.numero}</strong>
          {sucesso.chave && <div className="font-mono text-[10.5px] mt-1 text-[#1B873F]/85 break-all">chave: {sucesso.chave}</div>}
        </div>
      )}

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <label className="block text-[11px] text-[#3D2314]/70 mb-1">NF-e de venda original *</label>
        <select
          value={vendaSelId}
          onChange={(e) => setVendaSelId(e.target.value)}
          className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
        >
          <option value="">Selecione uma NFe autorizada...</option>
          {vendas.map((v) => (
            <option key={v.id} value={v.id}>
              nº {v.numero ?? '?'} · {fmtData(v.data_emissao)} · {v.destinatario_razao_social ?? '—'} · {fmtBRL(v.valor_total)}
            </option>
          ))}
        </select>

        <label className="block text-[11px] text-[#3D2314]/70 mb-1 mt-3">Natureza da operação</label>
        <input
          type="text"
          value={natureza}
          onChange={(e) => setNatureza(e.target.value)}
          className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
        />
      </div>

      {itens.length > 0 && (
        <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
          <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Itens a devolver</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-[#FAF7F2]">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Produto</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Qtd vendida</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Qtd a devolver</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">CFOP</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it, idx) => {
                  const excede = it.quantidade > it.quantidadeVendida + 0.001
                  return (
                    <tr key={idx} className="border-t border-[#3D2314]/5">
                      <td className="px-2 py-1.5 text-[#3D2314]">
                        {it.codigo && <span className="font-mono text-[10.5px] text-[#3D2314]/55 mr-1.5">[{it.codigo}]</span>}
                        {it.descricao}
                        {!it.produtoId && <span className="ml-1 text-[10.5px] text-[#A32D2D]">⚠ sem produtoId</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#3D2314]/65">{it.quantidadeVendida}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0" step="0.001" max={it.quantidadeVendida}
                          value={it.quantidade}
                          onChange={(e) => atualizarItem(idx, { quantidade: Number(e.target.value) })}
                          className={`w-24 px-2 py-1 text-right text-[12px] border rounded ${excede ? 'border-[#A32D2D] text-[#A32D2D]' : 'border-[#3D2314]/15'}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={it.cfopOverride}
                          onChange={(e) => atualizarItem(idx, { cfopOverride: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                          className="w-16 px-2 py-1 text-[12px] font-mono border border-[#3D2314]/15 rounded"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {algumExcede && (
            <div className="mt-2 text-[11.5px] text-[#A32D2D]">
              Há item(ns) com quantidade maior que a vendida.
            </div>
          )}
        </div>
      )}

      {erro && (
        <div className="mb-4 p-3 bg-[#FCEBEB] text-[#A32D2D] text-[12.5px] rounded-lg flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={emitir}
          disabled={!podeEnviar}
          data-testid="nfe-devol-venda-emitir"
          className="px-5 py-2 text-[12.5px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {enviando ? 'Emitindo…' : 'Emitir devolução'}
        </button>
      </div>
    </div>
  )
}
