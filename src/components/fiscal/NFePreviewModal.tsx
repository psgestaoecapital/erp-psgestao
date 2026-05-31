'use client'

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/authFetch'
import { calcularImpostos } from '@/lib/fiscal/nfe-calc-impostos'
import { supabase } from '@/lib/supabase'
import { X, Loader2, Trash2, FileCheck, AlertTriangle, ExternalLink } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
  erpReceberId: string
  valor?: number
  onSucesso?: (nfeId: string) => void
}

interface ProdutoOpcao {
  id: string
  codigo: string
  nome: string
  ncm: string | null
  cfop_venda: string | null
  unidade: string | null
  preco_venda: number | null
  aliquota_icms: number | null
  aliquota_ipi: number | null
  aliquota_pis: number | null
  aliquota_cofins: number | null
}

interface ItemSelecionado {
  produtoId: string
  produtoNome: string
  ncm: string
  cfop: string
  unidade: string
  precoVenda: number
  precoUnitario: number
  quantidade: number
  aliquotaIcms?: number
  aliquotaIpi?: number
  aliquotaPis?: number
  aliquotaCofins?: number
}

interface RespostaEmissao {
  ok?: boolean
  nfeId?: string
  status?: string
  numero?: string
  chave?: string
  xmlUrl?: string
  danfeUrl?: string
  motivoRejeicao?: string
  ambiente?: string
  mensagem?: string
}

type Status = 'preview' | 'enviando' | 'consultando' | 'autorizada' | 'rejeitada'

export default function NFePreviewModal(props: Props) {
  const [status, setStatus] = useState<Status>('preview')
  const [produtos, setProdutos] = useState<ProdutoOpcao[]>([])
  const [itens, setItens] = useState<ItemSelecionado[]>([])
  const [naturezaOp, setNaturezaOp] = useState('Venda de mercadoria')
  const [resposta, setResposta] = useState<RespostaEmissao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregarProdutos = useCallback(async () => {
    const { data } = await supabase
      .from('erp_produtos')
      .select(
        'id, codigo, nome, ncm, cfop_venda, unidade, preco_venda, aliquota_icms, aliquota_ipi, aliquota_pis, aliquota_cofins'
      )
      .eq('company_id', props.companyId)
      .eq('ativo', true)
      .order('nome')
    setProdutos((data ?? []) as ProdutoOpcao[])
  }, [props.companyId])

  useEffect(() => {
    if (props.open) {
      setStatus('preview')
      setItens([])
      setResposta(null)
      setErro(null)
      carregarProdutos()
    }
  }, [props.open, carregarProdutos])

  function adicionarProduto(prodId: string) {
    const prod = produtos.find((p) => p.id === prodId)
    if (!prod) return
    setItens((prev) => [
      ...prev,
      {
        produtoId: prod.id,
        produtoNome: prod.nome,
        ncm: prod.ncm ?? '',
        cfop: prod.cfop_venda ?? '5102',
        unidade: prod.unidade ?? 'UN',
        precoVenda: Number(prod.preco_venda ?? 0),
        precoUnitario: Number(prod.preco_venda ?? 0),
        quantidade: 1,
        aliquotaIcms: prod.aliquota_icms ?? undefined,
        aliquotaIpi: prod.aliquota_ipi ?? undefined,
        aliquotaPis: prod.aliquota_pis ?? undefined,
        aliquotaCofins: prod.aliquota_cofins ?? undefined,
      },
    ])
  }

  const impostos = calcularImpostos(
    itens.map((i) => ({
      codigo: i.produtoId,
      descricao: i.produtoNome,
      ncm: i.ncm,
      cfop: i.cfop,
      unidade: i.unidade,
      quantidade: i.quantidade,
      valorUnitario: i.precoUnitario,
      valorTotal: i.precoUnitario * i.quantidade,
      icms: { aliquota: i.aliquotaIcms },
      ipi: { aliquota: i.aliquotaIpi },
      pis: { aliquota: i.aliquotaPis },
      cofins: { aliquota: i.aliquotaCofins },
    }))
  )

  async function pollStatus(nfeId: string, attempt: number) {
    if (attempt > 10) {
      setErro('Tempo esgotado · consulte depois no Hub Fiscal')
      setStatus('rejeitada')
      return
    }
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const r = await authFetch(`/api/fiscal/nfe/consultar/${nfeId}`)
      const json = (await r.json()) as RespostaEmissao
      if (json.status === 'autorizada') {
        setResposta((prev) => ({ ...(prev ?? {}), ...json }))
        setStatus('autorizada')
        props.onSucesso?.(nfeId)
      } else if (json.status === 'rejeitada' || json.status === 'denegada') {
        setErro(json.motivoRejeicao ?? 'Rejeitada')
        setStatus('rejeitada')
      } else {
        pollStatus(nfeId, attempt + 1)
      }
    } catch {
      pollStatus(nfeId, attempt + 1)
    }
  }

  async function emitir() {
    if (itens.length === 0) {
      setErro('Adicione pelo menos 1 produto')
      return
    }
    setStatus('enviando')
    setErro(null)
    try {
      const r = await authFetch('/api/fiscal/nfe/emitir', {
        method: 'POST',
        body: JSON.stringify({
          companyId: props.companyId,
          erpReceberId: props.erpReceberId,
          overrides: {
            naturezaOperacao: naturezaOp,
            finalidade: 'normal',
            itens: itens.map((i) => ({
              produtoId: i.produtoId,
              quantidade: i.quantidade,
              valorUnitarioOverride: i.precoUnitario,
            })),
          },
        }),
      })
      const json = (await r.json()) as RespostaEmissao
      if (!r.ok || !json.ok) {
        setErro(json.mensagem ?? json.motivoRejeicao ?? 'Erro')
        setStatus('rejeitada')
        return
      }
      setResposta(json)
      if (json.status === 'autorizada') {
        setStatus('autorizada')
        if (json.nfeId) props.onSucesso?.(json.nfeId)
      } else if (json.status === 'processando') {
        setStatus('consultando')
        if (json.nfeId) pollStatus(json.nfeId, 0)
      } else {
        setErro(json.motivoRejeicao ?? 'Rejeitada')
        setStatus('rejeitada')
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
      setStatus('rejeitada')
    }
  }

  if (!props.open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-[15px] font-medium text-[#3D2314]">Emitir NFe Produto</h2>
          <button
            type="button"
            onClick={props.onClose}
            disabled={status === 'enviando' || status === 'consultando'}
            className="text-[#3D2314]/60 hover:text-[#3D2314] disabled:opacity-30"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {status === 'preview' && (
            <>
              {produtos.length === 0 && (
                <div className="bg-[#FCEBEB] border border-[#E8A6A5] rounded-lg p-3 text-[12px] text-[#791F1F]">
                  Nenhum produto cadastrado nesta empresa · cadastre em /dashboard/cadastros/produtos primeiro
                </div>
              )}

              <div>
                <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                  Natureza da operacao
                </label>
                <input
                  type="text"
                  value={naturezaOp}
                  onChange={(e) => setNaturezaOp(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                  Adicionar produto
                </label>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      adicionarProduto(e.target.value)
                      e.target.value = ''
                    }
                  }}
                  className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Selecione um produto...
                  </option>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} · NCM {p.ncm ?? '—'} · R$ {Number(p.preco_venda ?? 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              {itens.length > 0 && (
                <div className="border border-[#3D2314]/10 rounded-lg overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Produto</th>
                        <th className="text-right px-3 py-2 font-medium">Qtd</th>
                        <th className="text-right px-3 py-2 font-medium">Valor unit.</th>
                        <th className="text-right px-3 py-2 font-medium">Total</th>
                        <th className="text-right px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item, idx) => (
                        <tr key={idx} className="border-t border-[#3D2314]/8">
                          <td className="px-3 py-2">{item.produtoNome}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={item.quantidade}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0
                                setItens((prev) =>
                                  prev.map((it, i) => (i === idx ? { ...it, quantidade: v } : it))
                                )
                              }}
                              className="w-16 px-2 py-1 text-[12px] border border-[#3D2314]/15 rounded text-right"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={item.precoUnitario}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0
                                setItens((prev) =>
                                  prev.map((it, i) => (i === idx ? { ...it, precoUnitario: v } : it))
                                )
                              }}
                              className="w-20 px-2 py-1 text-[12px] border border-[#3D2314]/15 rounded text-right"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            R$ {(item.precoUnitario * item.quantidade).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setItens((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
                              <Trash2 size={13} className="text-[#C94544]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {itens.length > 0 && (
                <div className="bg-[#FAEEDA] border border-[#E8C387] rounded-lg p-3 text-[12px] text-[#633806] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Produtos:</span>
                    <span className="tabular-nums font-medium">R$ {impostos.valorProdutos.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ICMS (por dentro):</span>
                    <span className="tabular-nums">R$ {impostos.valorIcms.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IPI (por fora):</span>
                    <span className="tabular-nums">R$ {impostos.valorIpi.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[13px] pt-1 border-t border-[#E8C387]">
                    <span>TOTAL NOTA:</span>
                    <span className="tabular-nums">R$ {impostos.valorTotalNota.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {erro && (
                <div className="text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2.5 rounded-lg">{erro}</div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={emitir}
                  disabled={itens.length === 0}
                  data-testid="nfe-emitir-confirmar"
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40"
                >
                  Emitir NFe
                </button>
              </div>
            </>
          )}

          {(status === 'enviando' || status === 'consultando') && (
            <div className="py-8 text-center">
              <Loader2 className="animate-spin mx-auto text-[#C8941A]" size={32} />
              <p className="mt-3 text-[13px] text-[#3D2314]">
                {status === 'enviando' ? 'Enviando ao Focus NFe...' : 'Aguardando autorizacao SEFAZ...'}
              </p>
              <p className="mt-1 text-[11px] text-[#3D2314]/60">Pode levar ate 30s</p>
            </div>
          )}

          {status === 'autorizada' && resposta && (
            <div className="space-y-3">
              <div className="bg-[#E8F4DC] border border-[#C0DD97] rounded-lg p-3.5 flex items-start gap-2.5">
                <FileCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={18} />
                <div className="flex-1 text-[12.5px] text-[#1B3608]">
                  <div className="font-medium">NFe autorizada</div>
                  {resposta.chave && (
                    <div className="font-mono text-[11px] mt-1 break-all">Chave: {resposta.chave}</div>
                  )}
                  {resposta.numero && (
                    <div>
                      Numero: <strong>{resposta.numero}</strong>
                    </div>
                  )}
                  {resposta.ambiente && (
                    <div className="text-[11px] text-[#1B3608]/70">Ambiente: {resposta.ambiente}</div>
                  )}
                </div>
              </div>
              {(resposta.danfeUrl || resposta.xmlUrl) && (
                <div className="flex gap-2">
                  {resposta.danfeUrl && (
                    <a
                      href={resposta.danfeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={13} /> Ver DANFE
                    </a>
                  )}
                  {resposta.xmlUrl && (
                    <a
                      href={resposta.xmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-[12px] font-medium text-center rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink size={13} /> Ver XML
                    </a>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={props.onClose}
                className="w-full px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2]"
              >
                Fechar
              </button>
            </div>
          )}

          {status === 'rejeitada' && (
            <div className="space-y-3">
              <div className="bg-[#FCEBEB] border border-[#E8A6A5] rounded-lg p-3.5 flex items-start gap-2.5">
                <AlertTriangle className="text-[#C94544] flex-shrink-0 mt-0.5" size={18} />
                <div className="text-[12.5px] text-[#791F1F]">
                  <div className="font-medium">NFe rejeitada</div>
                  <div className="mt-1">{erro ?? 'Erro desconhecido'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('preview')}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
                >
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={props.onClose}
                  className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2]"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
