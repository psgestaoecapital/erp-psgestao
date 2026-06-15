'use client'

// fiscal-devolucao-compra-v1
// Tela de emissao de NFe de devolucao de compra.
// Linguagem: EMITIU NF-e de devolução de compra nº X.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { ArrowLeft, Loader2, AlertCircle, Trash2, Plus, RotateCcw } from 'lucide-react'

interface Fornecedor {
  id: string
  razao_social: string | null
  nome_fantasia: string | null
  cnpj_cpf: string | null
  cpf_cnpj: string | null
}

interface Produto {
  id: string
  codigo: string | null
  nome: string
  preco_venda: number | null
}

interface ItemDevol {
  produtoId: string
  produtoLabel: string
  quantidade: number
  valorUnitarioOverride?: number
  cfopOverride: string
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

function maskChave(v: string): string {
  return v.replace(/\D/g, '').slice(0, 44)
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export default function DevolucaoCompraClient() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [chaveCompra, setChaveCompra] = useState('')
  const [natureza, setNatureza] = useState('Devolução de compra')
  const [itens, setItens] = useState<ItemDevol[]>([])
  const [produtoBusca, setProdutoBusca] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<{ numero: string; chave?: string } | null>(null)

  useEffect(() => {
    const cid = resolveCompanyId()
    if (!cid) {
      setErroEmpresa('Selecione uma empresa específica no trocador da TopNav.')
      return
    }
    setCompanyId(cid)
  }, [])

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const [f, p] = await Promise.all([
        supabase
          .from('erp_fornecedores')
          .select('id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('razao_social')
          .limit(500),
        supabase
          .from('erp_produtos')
          .select('id, codigo, nome, preco_venda')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome')
          .limit(500),
      ])
      setFornecedores((f.data ?? []) as Fornecedor[])
      setProdutos((p.data ?? []) as Produto[])
    })()
  }, [companyId])

  function adicionarItem(prod: Produto) {
    setItens((arr) => [
      ...arr,
      {
        produtoId: prod.id,
        produtoLabel: `${prod.codigo ? `[${prod.codigo}] ` : ''}${prod.nome}`,
        quantidade: 1,
        valorUnitarioOverride: prod.preco_venda ?? 0,
        cfopOverride: '5202',
      },
    ])
    setProdutoBusca('')
  }

  function atualizarItem(idx: number, patch: Partial<ItemDevol>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removerItem(idx: number) {
    setItens((arr) => arr.filter((_, i) => i !== idx))
  }

  const produtosFiltrados = produtoBusca.trim().length > 0
    ? produtos.filter((p) =>
        p.nome.toLowerCase().includes(produtoBusca.toLowerCase()) ||
        (p.codigo ?? '').toLowerCase().includes(produtoBusca.toLowerCase())
      ).slice(0, 20)
    : []

  const totalItens = itens.reduce((s, it) => s + (it.valorUnitarioOverride ?? 0) * it.quantidade, 0)
  const chaveLimpa = chaveCompra.replace(/\D/g, '')
  const podeEnviar = !!companyId && !!fornecedorId && chaveLimpa.length === 44 && itens.length > 0 && !enviando

  async function emitir() {
    if (!podeEnviar) return
    if (!confirm(`EMITIR NF-e de devolução para ${itens.length} item(ns)?\n\nCFOP / CST devem espelhar a entrada (validar com contador antes de produção).`)) return
    setEnviando(true); setErro(null); setSucesso(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/devolucao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          fornecedorId,
          chaveCompra: chaveLimpa,
          naturezaOperacao: natureza,
          itens: itens.map((it) => ({
            produtoId: it.produtoId,
            quantidade: Number(it.quantidade),
            valorUnitarioOverride: Number(it.valorUnitarioOverride ?? 0),
            cfopOverride: it.cfopOverride.trim() || '5202',
          })),
        }),
      })
      const json = await resp.json()
      if (!resp.ok || json?.ok === false) {
        setErro(json?.mensagem ?? json?.motivoRejeicao ?? 'Falha ao emitir devolução')
        setEnviando(false)
        return
      }
      setSucesso({ numero: String(json.numero ?? '?'), chave: json.chave })
      setEnviando(false)
      alert(`EMITIU NF-e de devolução de compra nº ${json.numero}.`)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Erro ao emitir')
      setEnviando(false)
    }
  }

  function resetar() {
    setFornecedorId(''); setChaveCompra(''); setNatureza('Devolução de compra')
    setItens([]); setProdutoBusca(''); setErro(null); setSucesso(null)
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
          <RotateCcw size={16} /> Devolução de compra
        </h1>
      </div>

      <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[11.5px] text-[#3D2314]/85 leading-snug">
        <strong>Atenção (Pilar 1):</strong> CFOP, CST/CSOSN e CEST devem espelhar a NF-e de compra para devolver o mesmo imposto creditado. Padrão sugerido: <strong>5202</strong> (dentro do estado) ou <strong>6202</strong> (fora). Se a compra teve ICMS-ST, use <strong>5411/6411</strong>. Validar com contador antes de produção.
      </div>

      {sucesso && (
        <div className="mb-4 p-3 bg-[#E7F4EC] border border-[#1B873F]/40 rounded-lg text-[12.5px] text-[#1B873F]">
          ✓ EMITIU NF-e de devolução de compra nº <strong>{sucesso.numero}</strong>
          {sucesso.chave && <div className="font-mono text-[10.5px] mt-1 text-[#1B873F]/85 break-all">chave: {sucesso.chave}</div>}
        </div>
      )}

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Dados da devolução</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Fornecedor (destinatário) *</label>
            <select
              value={fornecedorId}
              onChange={(e) => setFornecedorId(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            >
              <option value="">Selecione...</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.razao_social ?? f.nome_fantasia ?? f.id} {f.cnpj_cpf || f.cpf_cnpj ? `· ${f.cnpj_cpf ?? f.cpf_cnpj}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Natureza da operação</label>
            <input
              type="text"
              value={natureza}
              onChange={(e) => setNatureza(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">
              Chave da NF-e de compra (44 dígitos) *
            </label>
            <input
              type="text"
              value={chaveCompra}
              onChange={(e) => setChaveCompra(maskChave(e.target.value))}
              placeholder="00000000000000000000000000000000000000000000"
              className="w-full px-3 py-2 text-[13px] font-mono border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
            <div className="text-[10.5px] mt-1 text-right">
              <span className={chaveLimpa.length === 44 ? 'text-[#1B873F]' : 'text-[#A32D2D]'}>
                {chaveLimpa.length}/44
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Itens a devolver</h2>

        <div className="relative mb-3">
          <input
            type="text"
            value={produtoBusca}
            onChange={(e) => setProdutoBusca(e.target.value)}
            placeholder="Buscar produto por nome ou código..."
            className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
          />
          {produtosFiltrados.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-[#3D2314]/15 rounded-lg shadow-lg">
              {produtosFiltrados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => adicionarItem(p)}
                  className="w-full text-left px-3 py-2 hover:bg-[#FAF7F2] flex items-center justify-between gap-2 border-b border-[#3D2314]/5 last:border-0"
                >
                  <span className="text-[12.5px] text-[#3D2314]">
                    {p.codigo && <span className="font-mono text-[10.5px] text-[#3D2314]/55 mr-1.5">[{p.codigo}]</span>}
                    {p.nome}
                  </span>
                  <span className="text-[11px] text-[#3D2314]/65 tabular-nums whitespace-nowrap">{fmtBRL(p.preco_venda ?? 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {itens.length === 0 ? (
          <div className="text-center py-6 text-[12px] text-[#3D2314]/55">
            Busque um produto acima para adicionar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-[#FAF7F2]">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Produto</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Qtd</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Vlr Unit (R$)</th>
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">CFOP</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase tracking-wide">Subtotal</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it, idx) => {
                  const subtotal = (it.valorUnitarioOverride ?? 0) * it.quantidade
                  return (
                    <tr key={idx} className="border-t border-[#3D2314]/5">
                      <td className="px-2 py-1.5 text-[#3D2314]">{it.produtoLabel}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0.001" step="0.001"
                          value={it.quantidade}
                          onChange={(e) => atualizarItem(idx, { quantidade: Number(e.target.value) })}
                          className="w-20 px-2 py-1 text-right text-[12px] border border-[#3D2314]/15 rounded"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number" min="0" step="0.01"
                          value={it.valorUnitarioOverride ?? 0}
                          onChange={(e) => atualizarItem(idx, { valorUnitarioOverride: Number(e.target.value) })}
                          className="w-24 px-2 py-1 text-right text-[12px] border border-[#3D2314]/15 rounded"
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
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#3D2314]">{fmtBRL(subtotal)}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => removerItem(idx)}
                          className="text-[#A32D2D] hover:bg-[#A32D2D]/10 p-1 rounded"
                          aria-label="Remover"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#3D2314]/15 bg-[#FAF7F2]">
                  <td colSpan={4} className="px-2 py-2 text-right text-[#3D2314]/65 text-[11.5px] font-medium uppercase">Total</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[#3D2314] font-semibold">{fmtBRL(totalItens)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {erro && (
        <div className="mb-4 p-3 bg-[#FCEBEB] text-[#A32D2D] text-[12.5px] rounded-lg flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={resetar}
          disabled={enviando}
          className="px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#3D2314]/20 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={emitir}
          disabled={!podeEnviar}
          data-testid="nfe-devol-emitir"
          className="px-5 py-2 text-[12.5px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {enviando ? 'Emitindo…' : 'Emitir devolução'}
        </button>
      </div>
    </div>
  )
}
