'use client'

// fiscal-devolucao-venda-e-remessa-v1 · Parte B
// Tela: emitir NFe de remessa (conserto, comodato, demonstração, etc.).
// Usa erp_fiscal_remessa_tipos (globais + tenant) pra preencher CFOP/natureza.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { ArrowLeft, Loader2, AlertCircle, Truck, Plus, Trash2 } from 'lucide-react'

interface DestPessoa {
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

interface RemessaTipo {
  id: string
  nome: string
  natureza: string
  cfop_dentro: string
  cfop_fora: string
}

interface ItemRem {
  produtoId: string
  produtoLabel: string
  quantidade: number
  valorUnitarioOverride?: number
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export default function RemessaClient() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)

  const [destTabela, setDestTabela] = useState<'erp_clientes' | 'erp_fornecedores'>('erp_clientes')
  const [pessoas, setPessoas] = useState<DestPessoa[]>([])
  const [destinatarioId, setDestinatarioId] = useState('')

  const [tipos, setTipos] = useState<RemessaTipo[]>([])
  const [tipoId, setTipoId] = useState('')
  const [natureza, setNatureza] = useState('')
  const [cfop, setCfop] = useState('')

  const [produtos, setProdutos] = useState<Produto[]>([])
  const [itens, setItens] = useState<ItemRem[]>([])
  const [produtoBusca, setProdutoBusca] = useState('')

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
      const [t, p] = await Promise.all([
        supabase
          .from('erp_fiscal_remessa_tipos')
          .select('id, nome, natureza, cfop_dentro, cfop_fora')
          .eq('ativo', true)
          .or(`company_id.is.null,company_id.eq.${companyId}`)
          .order('nome'),
        supabase
          .from('erp_produtos')
          .select('id, codigo, nome, preco_venda')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome')
          .limit(500),
      ])
      setTipos((t.data ?? []) as RemessaTipo[])
      setProdutos((p.data ?? []) as Produto[])
    })()
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const { data } = await supabase
        .from(destTabela)
        .select('id, razao_social, nome_fantasia, cnpj_cpf, cpf_cnpj')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('razao_social')
        .limit(500)
      setPessoas((data ?? []) as DestPessoa[])
      setDestinatarioId('')
    })()
  }, [companyId, destTabela])

  function aplicarTipo(id: string) {
    setTipoId(id)
    const t = tipos.find((x) => x.id === id)
    if (t) {
      setNatureza(t.natureza)
      // TODO PARAMETRO_CONFIRMAR_COM_CONTADOR: detectar UF do destinatario vs empresa
      // Por enquanto: default cfop_dentro (5xxx). User edita pra 6xxx se for fora.
      setCfop(t.cfop_dentro)
    }
  }

  function adicionarItem(prod: Produto) {
    setItens((arr) => [
      ...arr,
      {
        produtoId: prod.id,
        produtoLabel: `${prod.codigo ? `[${prod.codigo}] ` : ''}${prod.nome}`,
        quantidade: 1,
        valorUnitarioOverride: prod.preco_venda ?? 0,
      },
    ])
    setProdutoBusca('')
  }

  function atualizarItem(idx: number, patch: Partial<ItemRem>) {
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
  const podeEnviar = !!companyId && !!destinatarioId && !!cfop && !!natureza && itens.length > 0 && !enviando

  async function emitir() {
    if (!podeEnviar) return
    if (!confirm(`EMITIR NF-e de remessa para ${itens.length} item(ns)?\n\nVerificar CFOP/CST com contador.`)) return
    setEnviando(true); setErro(null); setSucesso(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/remessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          destinatarioId,
          destinatarioTabela: destTabela,
          tipoId: tipoId || null,
          cfop: cfop.trim(),
          naturezaOperacao: natureza,
          itens: itens.map((it) => ({
            produtoId: it.produtoId,
            quantidade: Number(it.quantidade),
            valorUnitarioOverride: Number(it.valorUnitarioOverride ?? 0),
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
      alert(`EMITIU NF-e de remessa nº ${json.numero}.`)
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
          <Truck size={16} /> Remessa / NF-e diversa
        </h1>
      </div>

      <div className="mb-4 p-3 bg-[#FBF3E0] border border-[#C8941A]/40 rounded-lg text-[11.5px] text-[#3D2314]/85 leading-snug">
        <strong>Atenção (Pilar 1):</strong> O CFOP é selecionado conforme o tipo da remessa (default = dentro do estado). Edite para fora do estado (<strong>6xxx</strong>) quando o destinatário for de outra UF. Operações sem incidência não destacam imposto · validar com contador antes de produção.
      </div>

      {sucesso && (
        <div className="mb-4 p-3 bg-[#E7F4EC] border border-[#1B873F]/40 rounded-lg text-[12.5px] text-[#1B873F]">
          ✓ EMITIU NF-e de remessa nº <strong>{sucesso.numero}</strong>
          {sucesso.chave && <div className="font-mono text-[10.5px] mt-1 text-[#1B873F]/85 break-all">chave: {sucesso.chave}</div>}
        </div>
      )}

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Destinatário</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Tipo de pessoa</label>
            <select
              value={destTabela}
              onChange={(e) => setDestTabela(e.target.value as 'erp_clientes' | 'erp_fornecedores')}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            >
              <option value="erp_clientes">Cliente</option>
              <option value="erp_fornecedores">Fornecedor</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">{destTabela === 'erp_clientes' ? 'Cliente' : 'Fornecedor'} *</label>
            <select
              value={destinatarioId}
              onChange={(e) => setDestinatarioId(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            >
              <option value="">Selecione...</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razao_social ?? p.nome_fantasia ?? p.id} {p.cnpj_cpf || p.cpf_cnpj ? `· ${p.cnpj_cpf ?? p.cpf_cnpj}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Tipo de remessa</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Modelo *</label>
            <select
              value={tipoId}
              onChange={(e) => aplicarTipo(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            >
              <option value="">Selecione...</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">Natureza *</label>
            <input
              type="text"
              value={natureza}
              onChange={(e) => setNatureza(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#3D2314]/70 mb-1">CFOP *</label>
            <input
              type="text"
              value={cfop}
              onChange={(e) => setCfop(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="5915"
              className="w-full px-3 py-2 text-[13px] font-mono border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A]"
            />
            {tipoId && (
              <div className="text-[10.5px] text-[#3D2314]/55 mt-1">
                Sugestão: <strong>{tipos.find((t) => t.id === tipoId)?.cfop_dentro}</strong> dentro / <strong>{tipos.find((t) => t.id === tipoId)?.cfop_fora}</strong> fora
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 sm:p-5 mb-4">
        <h2 className="text-[12.5px] font-semibold text-[#3D2314] mb-3">Itens</h2>

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
                  <th className="px-2 py-1.5 text-left text-[10.5px] text-[#3D2314]/65 uppercase">Produto</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase">Qtd</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase">Vlr Unit</th>
                  <th className="px-2 py-1.5 text-right text-[10.5px] text-[#3D2314]/65 uppercase">Subtotal</th>
                  <th></th>
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
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#3D2314]">{fmtBRL(subtotal)}</td>
                      <td className="px-2 py-1.5">
                        <button type="button" onClick={() => removerItem(idx)} className="text-[#A32D2D] hover:bg-[#A32D2D]/10 p-1 rounded">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#3D2314]/15 bg-[#FAF7F2]">
                  <td colSpan={3} className="px-2 py-2 text-right text-[#3D2314]/65 text-[11.5px] font-medium uppercase">Total</td>
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

      <div className="flex justify-end">
        <button
          type="button"
          onClick={emitir}
          disabled={!podeEnviar}
          data-testid="nfe-remessa-emitir"
          className="px-5 py-2 text-[12.5px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {enviando ? 'Emitindo…' : 'Emitir remessa'}
        </button>
      </div>
    </div>
  )
}
