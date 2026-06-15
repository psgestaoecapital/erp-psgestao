'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import FiscalStatusBadge from '@/components/fiscal/FiscalStatusBadge'
import {
  ArrowLeft, Search, Loader2, AlertCircle, ChevronDown, ChevronRight,
  FileCode, FileText, ChevronLeft, ChevronRight as ChevR, XCircle, Edit3,
} from 'lucide-react'
import { authFetch } from '@/lib/authFetch'

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
  // fiscal-cancelamento-nfe-v1
  const [cancelando, setCancelando] = useState<NFeRow | null>(null)
  const [justifCancel, setJustifCancel] = useState('')
  const [enviandoCancel, setEnviandoCancel] = useState(false)
  const [erroCancel, setErroCancel] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // fiscal-carta-correcao-nfe-v1
  const [ccAberta, setCcAberta] = useState<NFeRow | null>(null)
  const [ccCorrecao, setCcCorrecao] = useState('')
  const [enviandoCC, setEnviandoCC] = useState(false)
  const [erroCC, setErroCC] = useState<string | null>(null)
  type EventoCC = { id: string; sequencia: number; correcao: string | null; status: string; protocolo: string | null; motivo_rejeicao: string | null; criado_em: string }
  const [historicoCC, setHistoricoCC] = useState<Record<string, EventoCC[]>>({})

  async function carregarHistoricoCC(nfeId: string) {
    const { data } = await supabase
      .from('erp_nfe_eventos')
      .select('id, sequencia, correcao, status, protocolo, motivo_rejeicao, criado_em')
      .eq('nfe_id', nfeId)
      .eq('tipo', 'carta_correcao')
      .order('sequencia', { ascending: true })
    setHistoricoCC((m) => ({ ...m, [nfeId]: (data ?? []) as EventoCC[] }))
  }

  async function emitirCartaCorrecao() {
    if (!ccAberta) return
    const correcao = ccCorrecao.trim()
    if (correcao.length < 15 || correcao.length > 1000) {
      setErroCC('Correção precisa ter entre 15 e 1000 caracteres.')
      return
    }
    if (!confirm(`EMITIR carta de correção para a NF-e nº ${ccAberta.numero ?? ccAberta.id}?\n\nAtenção: CC-e NÃO pode alterar valores, impostos ou dados do destinatário.`)) return
    setEnviandoCC(true); setErroCC(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/carta-correcao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nfeId: ccAberta.id, correcao }),
      })
      const json = await resp.json()
      if (!resp.ok || json?.ok === false) {
        setErroCC(json?.mensagem ?? json?.motivoRejeicao ?? 'Falha ao emitir CC-e')
        setEnviandoCC(false)
        return
      }
      alert(`EMITIU carta de correção nº ${json.sequencia} (status: ${json.status}).`)
      void carregarHistoricoCC(ccAberta.id)
      setCcAberta(null); setCcCorrecao(''); setErroCC(null); setEnviandoCC(false)
    } catch (e) {
      setErroCC((e as Error)?.message ?? 'Erro ao emitir CC-e')
      setEnviandoCC(false)
    }
  }

  async function cancelarNFe() {
    if (!cancelando) return
    if (justifCancel.trim().length < 15) {
      setErroCancel('Justificativa precisa de no minimo 15 caracteres (regra SEFAZ).')
      return
    }
    if (!confirm(`Tem certeza? Esta acao eh definitiva.\n\nCANCELAR a NF-e nº ${cancelando.numero ?? cancelando.id} na SEFAZ?`)) return
    setEnviandoCancel(true); setErroCancel(null)
    try {
      const resp = await authFetch('/api/fiscal/nfe/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nfeId: cancelando.id, justificativa: justifCancel.trim() }),
      })
      const json = await resp.json()
      if (!resp.ok || json?.ok === false) {
        setErroCancel(json?.mensagem ?? 'Falha ao cancelar')
        setEnviandoCancel(false)
        return
      }
      // sucesso · fecha modal + recarrega lista
      setCancelando(null); setJustifCancel(''); setErroCancel(null)
      setEnviandoCancel(false)
      alert(`CANCELOU a nota nº ${cancelando.numero ?? cancelando.id}.`)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setErroCancel((e as Error)?.message ?? 'Erro ao cancelar')
      setEnviandoCancel(false)
    }
  }

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
  }, [companyId, statusFiltro, dataInicio, dataFim, buscaSubmit, pagina, reloadKey])

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
                          onClick={() => {
                            const nv = aberto ? null : row.id
                            setExpandida(nv)
                            if (nv) void carregarHistoricoCC(row.id)
                          }}
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
                                {row.status === 'autorizada' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => { setCcAberta(row); setCcCorrecao(''); setErroCC(null) }}
                                      data-testid="nfe-carta-correcao"
                                      className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#C8941A]/40 text-[#3D2314] hover:bg-[#C8941A]/10 flex items-center gap-1.5"
                                    >
                                      <Edit3 size={12} /> Carta de correção
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setCancelando(row); setJustifCancel(''); setErroCancel(null) }}
                                      data-testid="nfe-cancelar"
                                      className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#A32D2D]/40 text-[#A32D2D] hover:bg-[#A32D2D]/10 flex items-center gap-1.5"
                                    >
                                      <XCircle size={12} /> Cancelar nota
                                    </button>
                                  </>
                                )}
                              </div>

                              {/* fiscal-carta-correcao-nfe-v1 · historico CC-e */}
                              {(historicoCC[row.id] ?? []).length > 0 && (
                                <div className="mt-4 pt-3 border-t border-[#3D2314]/8">
                                  <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px] mb-2">
                                    Cartas de correção (CC-e)
                                  </div>
                                  <div className="flex flex-col gap-1.5">
                                    {(historicoCC[row.id] ?? []).map((ev) => (
                                      <div key={ev.id} className="text-[11.5px] text-[#3D2314] bg-[#FAF7F2]/80 rounded px-2 py-1.5">
                                        <div className="flex justify-between gap-2 flex-wrap">
                                          <span className="font-semibold">CC-e {ev.sequencia}</span>
                                          <span className={
                                            ev.status === 'registrado' ? 'text-[#3B6D11]' :
                                            ev.status === 'rejeitado' ? 'text-[#A32D2D]' :
                                            'text-[#C8941A]'
                                          }>
                                            {ev.status === 'registrado' ? '✓ registrado' : ev.status === 'rejeitado' ? '✕ rejeitado' : '⏳ processando'}
                                          </span>
                                        </div>
                                        <div className="mt-0.5 text-[#3D2314]/85 break-words">{ev.correcao}</div>
                                        {ev.protocolo && <div className="mt-0.5 text-[10.5px] text-[#3D2314]/55 font-mono">prot {ev.protocolo}</div>}
                                        {ev.motivo_rejeicao && <div className="mt-0.5 text-[10.5px] text-[#A32D2D]">{ev.motivo_rejeicao}</div>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
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

      {/* fiscal-carta-correcao-nfe-v1 · Modal de CC-e */}
      {ccAberta && (
        <div onClick={() => !enviandoCC && setCcAberta(null)} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl max-w-lg w-full p-5 border border-[#C8941A]/40">
            <div className="flex items-start gap-3 mb-4">
              <Edit3 size={20} className="text-[#3D2314] flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-[15px] font-semibold text-[#3D2314]">Carta de correção · NF-e nº {ccAberta.numero ?? ccAberta.id}</h3>
                <p className="text-[11.5px] text-[#3D2314]/70 mt-1.5 leading-snug">
                  Use para corrigir <strong>informações complementares</strong>. CC-e <strong>NÃO</strong> pode alterar:
                  valores/impostos, dados do destinatário, data de emissão ou regra tributária.
                </p>
                <p className="text-[10.5px] text-[#3D2314]/55 mt-1">
                  Limite legal: 20 CC-e por NF-e (a última válida prevalece).
                </p>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-[11.5px] font-medium text-[#3D2314] mb-1.5">
                Texto da correção (15-1000 caracteres) <span className="text-[#A32D2D]">*</span>
              </label>
              <textarea
                value={ccCorrecao}
                onChange={(e) => setCcCorrecao(e.target.value)}
                rows={5}
                maxLength={1000}
                placeholder="Ex: Onde se lê 'Av. das Flores 123', leia-se 'Av. das Flores 132'."
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#C8941A] resize-none"
                disabled={enviandoCC}
                data-testid="nfe-cc-texto"
              />
              <div className="flex justify-between mt-1 text-[10.5px]">
                <span className={ccCorrecao.length < 15 ? 'text-[#A32D2D]' : 'text-[#3D2314]/55'}>
                  {ccCorrecao.length}/15 mínimo
                </span>
                <span className={ccCorrecao.length > 1000 ? 'text-[#A32D2D]' : 'text-[#3D2314]/55'}>
                  {ccCorrecao.length}/1000
                </span>
              </div>
            </div>

            {erroCC && (
              <div className="mb-3 p-2 bg-[#FCEBEB] text-[#A32D2D] text-[12px] rounded-lg flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{erroCC}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCcAberta(null)}
                disabled={enviandoCC}
                className="px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#3D2314]/20 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={emitirCartaCorrecao}
                disabled={enviandoCC || ccCorrecao.trim().length < 15 || ccCorrecao.trim().length > 1000}
                data-testid="nfe-cc-confirmar"
                className="px-4 py-2 text-[12.5px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-50 flex items-center gap-1.5"
              >
                {enviandoCC ? <Loader2 size={12} className="animate-spin" /> : <Edit3 size={12} />}
                {enviandoCC ? 'Emitindo…' : 'Emitir CC-e'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* fiscal-cancelamento-nfe-v1 · Modal de cancelamento */}
      {cancelando && (
        <div onClick={() => !enviandoCancel && setCancelando(null)} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl max-w-md w-full p-5 border border-[#A32D2D]/40">
            <div className="flex items-start gap-3 mb-4">
              <XCircle size={20} className="text-[#A32D2D] flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-[15px] font-semibold text-[#3D2314]">Cancelar NF-e nº {cancelando.numero ?? cancelando.id}</h3>
                <p className="text-[12px] text-[#3D2314]/70 mt-1">
                  Prazo legal: 24 horas após a autorização (SEFAZ-SC). Após esse prazo, use carta de correção ou nota de ajuste.
                </p>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-[11.5px] font-medium text-[#3D2314] mb-1.5">
                Justificativa (mínimo 15 caracteres) <span className="text-[#A32D2D]">*</span>
              </label>
              <textarea
                value={justifCancel}
                onChange={(e) => setJustifCancel(e.target.value)}
                rows={3}
                maxLength={255}
                placeholder="Ex: Erro no destinatário · Reemissão necessária"
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/20 rounded-lg focus:outline-none focus:border-[#A32D2D] resize-none"
                disabled={enviandoCancel}
                data-testid="nfe-cancelar-justificativa"
              />
              <div className="flex justify-between mt-1 text-[10.5px]">
                <span className={justifCancel.length < 15 ? 'text-[#A32D2D]' : 'text-[#3D2314]/55'}>
                  {justifCancel.length}/15 mínimo
                </span>
                <span className="text-[#3D2314]/55">{justifCancel.length}/255</span>
              </div>
            </div>

            {erroCancel && (
              <div className="mb-3 p-2 bg-[#FCEBEB] text-[#A32D2D] text-[12px] rounded-lg flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{erroCancel}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCancelando(null)}
                disabled={enviandoCancel}
                className="px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#3D2314]/20 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={cancelarNFe}
                disabled={enviandoCancel || justifCancel.trim().length < 15}
                data-testid="nfe-cancelar-confirmar"
                className="px-4 py-2 text-[12.5px] font-medium rounded-lg bg-[#A32D2D] text-white hover:bg-[#8A2525] disabled:opacity-50 flex items-center gap-1.5"
              >
                {enviandoCancel ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                {enviandoCancel ? 'Cancelando…' : 'Cancelar nota'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
