'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import FiscalStatusBadge from '@/components/fiscal/FiscalStatusBadge'
import {
  ArrowLeft, Search, Loader2, AlertCircle, ChevronDown, ChevronRight,
  FileCode, FileText, ChevronLeft, ChevronRight as ChevR,
} from 'lucide-react'

interface NFeRow {
  id: string
  numero: string | null
  serie: string | null
  chave: string | null
  data_emissao: string | null
  destinatario_razao_social: string | null
  destinatario_cnpj: string | null
  destinatario_cpf: string | null
  valor_total: number | null
  valor_icms: number | null
  valor_ipi: number | null
  natureza_operacao: string | null
  status: string
  motivo_rejeicao: string | null
  protocolo: string | null
  xml_url: string | null
  danfe_url: string | null
  xml_storage_path: string | null
  danfe_storage_path: string | null
  provider_reference: string | null
  criado_em: string | null
  total_geral: number
}

const PAGE_SIZE = 50

function resolveCompanyId(): { kind: 'ok'; id: string } | { kind: 'erro'; mensagem: string } {
  if (typeof window === 'undefined') return { kind: 'erro', mensagem: 'Carregando…' }
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado') {
    return { kind: 'erro', mensagem: 'Selecione uma empresa específica no trocador da TopNav.' }
  }
  if (sel.startsWith('group_')) {
    return { kind: 'erro', mensagem: 'Lista fiscal é por empresa — selecione uma empresa do grupo.' }
  }
  return { kind: 'ok', id: sel }
}

const fmtBRL = (v: number | null) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtDoc = (cnpj: string | null, cpf: string | null) => {
  const v = cnpj ?? cpf ?? ''
  if (!v) return '—'
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return v
}

const fmtData = (iso: string | null) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('pt-BR')
  } catch {
    return '—'
  }
}

const fmtChave = (c: string | null) => {
  if (!c) return '—'
  // 44 digitos · agrupa de 4 em 4 pra leitura
  return c.replace(/(\d{4})(?=\d)/g, '$1 ')
}

export default function NFeListClient() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)
  const [lista, setLista] = useState<NFeRow[]>([])
  const [totalGeral, setTotalGeral] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [statusFiltro, setStatusFiltro] = useState<string>('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaSubmit, setBuscaSubmit] = useState('')
  const [expandida, setExpandida] = useState<string | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)

  useEffect(() => {
    const sel = resolveCompanyId()
    if (sel.kind === 'erro') setErroEmpresa(sel.mensagem)
    else setCompanyId(sel.id)
  }, [])

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_listar_nfes_emitidas', {
        p_company_id: companyId,
        p_status: statusFiltro || null,
        p_data_inicio: dataInicio || null,
        p_data_fim: dataFim || null,
        p_busca: buscaSubmit || null,
        p_limit: PAGE_SIZE,
        p_offset: (pagina - 1) * PAGE_SIZE,
      })
      if (error) throw error
      const rows = (data ?? []) as NFeRow[]
      setLista(rows)
      setTotalGeral(rows[0]?.total_geral ?? 0)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }, [companyId, statusFiltro, dataInicio, dataFim, buscaSubmit, pagina])

  useEffect(() => { carregar() }, [carregar])

  async function baixar(row: NFeRow, tipo: 'xml' | 'pdf') {
    setBaixando(`${row.id}-${tipo}`)
    try {
      if (tipo === 'xml' && row.xml_url) {
        window.open(row.xml_url, '_blank', 'noopener,noreferrer')
        return
      }
      if (tipo === 'pdf' && row.danfe_url) {
        window.open(row.danfe_url, '_blank', 'noopener,noreferrer')
        return
      }
      const { data, error } = await supabase.rpc('fn_fiscal_get_storage_url', {
        p_tabela: 'nfe',
        p_doc_id: row.id,
        p_tipo: tipo,
      })
      if (error) throw error
      const payload = (data ?? {}) as { ok?: boolean; erro?: string; storage_path?: string; bucket?: string }
      if (!payload.ok || !payload.storage_path) {
        throw new Error(payload.erro ?? 'Arquivo não disponível')
      }
      const bucket = payload.bucket ?? 'fiscal-xmls'
      const signed = await supabase.storage.from(bucket).createSignedUrl(payload.storage_path, 3600)
      if (signed.error || !signed.data?.signedUrl) {
        throw new Error(signed.error?.message ?? 'Erro ao gerar URL assinada')
      }
      window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao baixar')
    } finally {
      setBaixando(null)
    }
  }

  function aplicarBusca() {
    setBuscaSubmit(busca.trim())
    setPagina(1)
  }

  function resetFiltros() {
    setStatusFiltro('')
    setDataInicio('')
    setDataFim('')
    setBusca('')
    setBuscaSubmit('')
    setPagina(1)
  }

  if (erroEmpresa) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] px-4 py-6">
        <div className="max-w-3xl mx-auto bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={18} />
          <div className="text-[13px] text-[#791F1F]">{erroEmpresa}</div>
        </div>
      </div>
    )
  }

  const totalPaginas = Math.max(1, Math.ceil(totalGeral / PAGE_SIZE))
  const inicio = (pagina - 1) * PAGE_SIZE + 1
  const fim = Math.min(pagina * PAGE_SIZE, totalGeral)

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <Link
          href="/dashboard/fiscal"
          className="inline-flex items-center gap-1.5 text-[12px] text-[#BA7517] hover:text-[#8B5612] mb-3"
        >
          <ArrowLeft size={13} /> Voltar pro Hub Fiscal
        </Link>
        <header className="mb-5">
          <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight">
            NFes Emitidas
          </h1>
          <p className="text-[13px] text-[#3D2314]/70 mt-1">
            Histórico de notas fiscais eletrônicas (modelo 55) · {totalGeral} {totalGeral === 1 ? 'nota' : 'notas'}
          </p>
        </header>

        <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">
                Buscar destinatário / número / chave
              </label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && aplicarBusca()}
                  placeholder="XYZ Eireli, 000001, 35..."
                  className="w-full pl-8 pr-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">Status</label>
              <select
                value={statusFiltro}
                onChange={(e) => { setStatusFiltro(e.target.value); setPagina(1) }}
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white"
              >
                <option value="">Todos</option>
                <option value="autorizada">Autorizada</option>
                <option value="processando">Processando</option>
                <option value="rejeitada">Rejeitada</option>
                <option value="cancelada">Cancelada</option>
                <option value="denegada">Denegada</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">De</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => { setDataInicio(e.target.value); setPagina(1) }}
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">Até</label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => { setDataFim(e.target.value); setPagina(1) }}
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={resetFiltros}
              className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={aplicarBusca}
              data-testid="nfe-aplicar-filtro"
              className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-1.5"
            >
              <Search size={12} /> Filtrar
            </button>
          </div>
        </div>

        {erro && (
          <div className="mb-3 bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-lg p-3 flex items-start gap-2 text-[12px] text-[#791F1F]">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={24} />
            </div>
          ) : lista.length === 0 ? (
            <div className="py-12 text-center text-[12.5px] text-[#3D2314]/60">
              Nenhuma NFe encontrada com esses filtros.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 uppercase tracking-[0.5px]">
                  <tr>
                    <th className="px-3 py-2.5 w-8"></th>
                    <th className="text-left px-3 py-2.5 font-medium">Nº/Série</th>
                    <th className="text-left px-3 py-2.5 font-medium">Data</th>
                    <th className="text-left px-3 py-2.5 font-medium">Destinatário</th>
                    <th className="text-right px-3 py-2.5 font-medium">Valor</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((row) => {
                    const aberto = expandida === row.id
                    return (
                      <>
                        <tr
                          key={row.id}
                          data-testid="nfe-list-row"
                          className="border-t border-[#3D2314]/8 hover:bg-[#FAEEDA]/30 cursor-pointer"
                          onClick={() => setExpandida(aberto ? null : row.id)}
                        >
                          <td className="px-3 py-2.5">
                            {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[12px]">
                            {row.numero ?? '—'}
                            {row.serie && <span className="text-[#3D2314]/55 ml-1">/{row.serie}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[12.5px]">{fmtData(row.data_emissao ?? row.criado_em)}</td>
                          <td className="px-3 py-2.5">
                            <div className="text-[12.5px] text-[#3D2314]">{row.destinatario_razao_social ?? '—'}</div>
                            <div className="text-[10.5px] text-[#3D2314]/60 font-mono">
                              {fmtDoc(row.destinatario_cnpj, row.destinatario_cpf)}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                            {fmtBRL(row.valor_total)}
                          </td>
                          <td className="px-3 py-2.5">
                            <FiscalStatusBadge status={row.status} motivo={row.motivo_rejeicao} />
                          </td>
                        </tr>
                        {aberto && (
                          <tr key={`${row.id}-detalhe`} className="bg-[#FAF7F2]/60 border-t border-[#3D2314]/8">
                            <td colSpan={6} className="px-5 py-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                                <div className="sm:col-span-2">
                                  <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px]">Chave de acesso (44 dígitos)</div>
                                  <div className="text-[#3D2314] mt-0.5 font-mono text-[11px] break-all">
                                    {fmtChave(row.chave)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px]">Natureza da operação</div>
                                  <div className="text-[#3D2314] mt-0.5">{row.natureza_operacao ?? '—'}</div>
                                </div>
                                <div>
                                  <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px]">Impostos / Valor</div>
                                  <div className="text-[#3D2314] mt-0.5">
                                    Total: {fmtBRL(row.valor_total)} · ICMS: {fmtBRL(row.valor_icms)} · IPI: {fmtBRL(row.valor_ipi)}
                                  </div>
                                </div>
                                {row.protocolo && (
                                  <div>
                                    <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px]">Protocolo</div>
                                    <div className="text-[#3D2314] mt-0.5 font-mono text-[11.5px]">{row.protocolo}</div>
                                  </div>
                                )}
                                {row.motivo_rejeicao && (
                                  <div className="sm:col-span-2">
                                    <div className="text-[10.5px] text-[#791F1F] uppercase tracking-[0.5px]">Motivo rejeição</div>
                                    <div className="text-[#791F1F] mt-0.5">{row.motivo_rejeicao}</div>
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => baixar(row, 'xml')}
                                  disabled={baixando === `${row.id}-xml`}
                                  data-testid="nfe-download-xml"
                                  className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {baixando === `${row.id}-xml` ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <FileCode size={12} />
                                  )}
                                  XML
                                </button>
                                <button
                                  type="button"
                                  onClick={() => baixar(row, 'pdf')}
                                  disabled={baixando === `${row.id}-pdf`}
                                  data-testid="nfe-download-danfe"
                                  className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {baixando === `${row.id}-pdf` ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <FileText size={12} />
                                  )}
                                  DANFE
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalGeral > 0 && (
            <div className="px-4 py-3 border-t border-[#3D2314]/10 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[#3D2314]/70">
              <div>Mostrando {inicio}–{fim} de {totalGeral}</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina <= 1}
                  className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-1"
                >
                  <ChevronLeft size={12} /> Anterior
                </button>
                <span className="px-2 text-[12px]">Página {pagina} de {totalPaginas}</span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  disabled={pagina >= totalPaginas}
                  className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-1"
                >
                  Próxima <ChevR size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
