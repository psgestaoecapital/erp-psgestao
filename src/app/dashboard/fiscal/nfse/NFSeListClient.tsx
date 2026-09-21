'use client'

// Fiscal · NFS-e — lista por DOCUMENTO (print do CEO 21/09). Uma linha por documento de origem
// (fn_fiscal_documentos, fonte única RD-65), não por tentativa: um serviço recusado 4× e depois
// autorizado é 1 linha, não 5. Ao expandir, a LINHA DO TEMPO do documento (fn_fiscal_documento_timeline):
// cada recusa, a autorização, o cancelamento e as tentativas fiscais registradas. Nada é apagado.
// O toggle "mostrar tentativas recusadas" volta à visão antiga (1 linha por registro, p_agrupar=false).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import FiscalStatusBadge from '@/components/fiscal/FiscalStatusBadge'
import NFSeEmitirGovModal from '@/components/fiscal/NFSeEmitirGovModal'
import NFSePreviewModal from '@/components/fiscal/NFSePreviewModal'
import { carregarProducaoDisponivel } from '@/lib/fiscal/producaoDisponivel'
import {
  ArrowLeft, Search, Loader2, AlertCircle, ChevronDown, ChevronRight,
  FileCode, FileText, ChevronLeft, ChevronRight as ChevR, Plus, RefreshCw,
  Building2, AlertTriangle, Ban, X, History, CheckCircle2, XCircle, Clock, FileSignature,
} from 'lucide-react'

// 1 linha por documento (fn_fiscal_documentos)
interface Documento {
  grupo_chave: string
  status_principal: string
  nao_emitida: boolean
  pode_reenviar: boolean
  numero: string | null
  data: string | null
  contraparte_nome: string | null
  contraparte_doc: string | null
  valor: number | null
  origem_rotulo: string | null
  motivo_rejeicao: string | null
  tentativas_recusadas: number
  ultima_recusa: string | null
  qtd_registros: number
  principal_id: string
  doc_ids: string[]
}
// evento da linha do tempo (fn_fiscal_documento_timeline)
interface TimelineEvento {
  quando: string | null
  categoria: 'recusa' | 'autorizacao' | 'cancelamento' | 'processando' | 'tentativa' | string
  status: string
  numero: string | null
  chave: string | null
  xml_url: string | null
  pdf_url: string | null
  xml_storage_path: string | null
  pdf_storage_path: string | null
  detalhe: string | null
  usuario_id: string | null
  nota_id: string | null
  operacao: string | null
  http_status: number | null
  provider_codigo: string | null
}

// #82.3 — obra do Hub para o vínculo gerencial de uma NFS-e já emitida
interface ObraLite {
  id: string
  numero: string
  nome: string | null
  cliente_nome: string | null
  endereco: string | null
  numero_endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  cno: string | null
  codigo_ibge_municipio: string | null
}
function obraIncompleta(o: ObraLite): boolean {
  const cno = (o.cno || '').trim()
  const log = (o.endereco || '').trim()
  const ibge = (o.codigo_ibge_municipio || '').trim()
  return cno === '' && (log === '' || ibge === '')
}
function obraResumo(o: ObraLite): string {
  const partes = [o.endereco, o.numero_endereco, o.cidade && o.uf ? `${o.cidade}/${o.uf}` : o.cidade].filter(Boolean)
  return partes.length ? partes.join(', ') : 'sem endereço cadastrado'
}
const OBRA_SELECT = 'id,numero,nome,cliente_nome,endereco,numero_endereco,bairro,cidade,uf,cep,cno,codigo_ibge_municipio'

const RESULTADO_ROTULO: Record<string, { t: string; cor: string; bg: string }> = {
  ok: { t: 'confirmado', cor: '#166534', bg: '#ECFDF5' },
  ja_cancelada: { t: 'já cancelada (sincronizada)', cor: '#166534', bg: '#ECFDF5' },
  processando: { t: 'processando', cor: '#8A4B08', bg: '#FFF6E5' },
  rejeitada: { t: 'rejeitada', cor: '#B42318', bg: '#FDECEC' },
  erro: { t: 'erro', cor: '#B42318', bg: '#FDECEC' },
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
  try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '—' }
}
const fmtDataHora = (iso: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return '—' }
}

// rótulo do status principal do documento (rejeitada-only vira "Não emitida", acionável)
function rotuloDocumento(d: Documento): string {
  if (d.nao_emitida) return 'Não emitida'
  return d.status_principal
}

export default function NFSeListClient() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null)
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [statusFiltro, setStatusFiltro] = useState<string>('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaSubmit, setBuscaSubmit] = useState('')
  const [mostrarRecusadas, setMostrarRecusadas] = useState(false) // visão antiga (1 linha por registro)
  const [aberta, setAberta] = useState<Documento | null>(null)     // documento expandido
  const [baixando, setBaixando] = useState<string | null>(null)
  const [emitirAberto, setEmitirAberto] = useState(false)
  const [consultando, setConsultando] = useState<string | null>(null)
  const [producaoDisponivel, setProducaoDisponivel] = useState(false)
  const [reemitir, setReemitir] = useState<null | {
    tomadorDocumento?: string; tomadorTipo?: 'cpf' | 'cnpj'; tomadorNome?: string; tomadorEmail?: string
    descricaoServico?: string; valorServicos?: number; codigoServicoMunicipio?: string; aliquotaIss?: number
    permitirObra?: boolean
  }>(null)
  const [preparandoReenvio, setPreparandoReenvio] = useState<string | null>(null)
  const [reenviarFocus, setReenviarFocus] = useState<null | { erpReceberId: string; descricao?: string; valor?: number }>(null)
  const [obraLink, setObraLink] = useState<ObraLite | null | 'loading'>(null)
  const [obraPickerOpen, setObraPickerOpen] = useState(false)
  const [obraBusca, setObraBusca] = useState('')
  const [obras, setObras] = useState<ObraLite[]>([])
  const [vinculando, setVinculando] = useState(false)
  const [confirmDesvincular, setConfirmDesvincular] = useState(false)
  const [timeline, setTimeline] = useState<TimelineEvento[] | null>(null)
  const [cancelModal, setCancelModal] = useState<{ id: string; numero: string | null } | null>(null)
  const [cancelJust, setCancelJust] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [cancelErro, setCancelErro] = useState<string | null>(null)

  useEffect(() => {
    const sel = resolveCompanyId()
    if (sel.kind === 'erro') setErroEmpresa(sel.mensagem)
    else setCompanyId(sel.id)
  }, [])

  useEffect(() => {
    if (!companyId) return
    void carregarProducaoDisponivel(companyId).then(setProducaoDisponivel)
  }, [companyId])

  const chaveAberta = aberta?.grupo_chave ?? null

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_fiscal_documentos', {
        p_company_id: companyId,
        p_tipo: 'nfse',
        p_status: statusFiltro || null,
        p_data_inicio: dataInicio || null,
        p_data_fim: dataFim || null,
        p_busca: buscaSubmit || null,
        p_agrupar: !mostrarRecusadas,
        p_limit: PAGE_SIZE,
        p_offset: (pagina - 1) * PAGE_SIZE,
      })
      if (error) throw error
      const r = data as { ok?: boolean; erro?: string; total?: number; documentos?: Documento[] } | null
      if (!r?.ok) throw new Error(r?.erro === 'sem_acesso' ? 'Você não tem acesso às notas desta empresa.' : (r?.erro ?? 'Erro ao carregar'))
      setDocumentos(r.documentos ?? [])
      setTotal(r.total ?? 0)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }, [companyId, statusFiltro, dataInicio, dataFim, buscaSubmit, mostrarRecusadas, pagina])

  useEffect(() => { carregar() }, [carregar])

  // ao expandir: carrega a linha do tempo do documento (fonte única fn_fiscal_documento_timeline).
  const carregarTimeline = useCallback(async (chave: string): Promise<TimelineEvento[]> => {
    if (!companyId) return []
    const { data } = await supabase.rpc('fn_fiscal_documento_timeline', {
      p_company_id: companyId, p_tipo: 'nfse', p_grupo_chave: chave,
    })
    const r = data as { ok?: boolean; eventos?: TimelineEvento[] } | null
    const list = r?.ok ? (r.eventos ?? []) : []
    setTimeline(list)
    return list
  }, [companyId])
  useEffect(() => {
    if (!chaveAberta) { setTimeline(null); return }
    setTimeline(null)
    void carregarTimeline(chaveAberta)
  }, [chaveAberta, carregarTimeline])

  // #82.3 — ao expandir, carrega a obra vinculada ao documento (registro principal).
  useEffect(() => {
    if (!aberta || !companyId) return
    let alive = true
    ;(async () => {
      setObraPickerOpen(false); setObraBusca(''); setConfirmDesvincular(false); setObraLink('loading')
      const { data: nfse } = await supabase.from('erp_nfse_emitidas').select('obra_id').eq('id', aberta.principal_id).maybeSingle()
      const obraId = (nfse as { obra_id?: string | null } | null)?.obra_id ?? null
      if (!obraId) { if (alive) setObraLink(null); return }
      const { data: obra } = await supabase.from('projetos_obras').select(OBRA_SELECT).eq('id', obraId).maybeSingle()
      if (alive) setObraLink((obra as ObraLite) ?? null)
    })()
    return () => { alive = false }
  }, [aberta, companyId])

  async function cancelarNFSe() {
    if (!cancelModal) return
    const just = cancelJust.trim()
    if (just.length < 15) { setCancelErro('A justificativa precisa de no mínimo 15 caracteres.'); return }
    setCancelando(true); setCancelErro(null)
    const notaId = cancelModal.id
    try {
      const resp = await authFetch('/api/fiscal/nfse/cancelar', {
        method: 'POST',
        body: JSON.stringify({ notaId, justificativa: just }),
      })
      let data: { ok?: boolean; mensagem?: string } = {}
      try { data = await resp.json() } catch { /* corpo não-JSON (ex.: 401 do withAuth) */ }
      if (!resp.ok || !data.ok) {
        const hist = chaveAberta ? await carregarTimeline(chaveAberta) : []
        const temHistorico = hist.length > 0
        const msg = resp.status === 401 ? 'Sua sessão expirou. Entre de novo e tente cancelar.'
          : resp.status === 403 ? 'Você não tem permissão para cancelar notas desta empresa.'
          : (data.mensagem ?? (temHistorico ? 'Não foi possível cancelar. Veja o histórico da nota abaixo.' : 'Não foi possível cancelar a NFS-e.'))
        setCancelErro(msg)
        return
      }
      setCancelModal(null); setCancelJust('')
      await carregar()
      if (chaveAberta) await carregarTimeline(chaveAberta)
    } catch (e) {
      setCancelErro(e instanceof Error ? e.message : 'Falha de rede ao cancelar.')
    } finally {
      setCancelando(false)
    }
  }

  useEffect(() => {
    if (!obraPickerOpen || !companyId) return
    const h = setTimeout(async () => {
      let q = supabase.from('projetos_obras').select(OBRA_SELECT)
        .eq('company_id', companyId).order('numero', { ascending: false }).limit(25)
      if (obraBusca.trim().length >= 2) {
        const t = obraBusca.trim()
        q = q.or(`numero.ilike.%${t}%,nome.ilike.%${t}%,cidade.ilike.%${t}%,endereco.ilike.%${t}%`)
      }
      const { data } = await q
      setObras((data ?? []) as ObraLite[])
    }, 250)
    return () => clearTimeout(h)
  }, [obraPickerOpen, obraBusca, companyId])

  async function vincularObra(nfseId: string, obraId: string | null) {
    setVinculando(true)
    try {
      const { error } = await supabase.from('erp_nfse_emitidas').update({ obra_id: obraId }).eq('id', nfseId)
      if (error) throw error
      if (!obraId) {
        setObraLink(null)
      } else {
        const { data: obra } = await supabase.from('projetos_obras').select(OBRA_SELECT).eq('id', obraId).maybeSingle()
        setObraLink((obra as ObraLite) ?? null)
      }
      setObraPickerOpen(false); setObraBusca(''); setConfirmDesvincular(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao vincular obra')
    } finally {
      setVinculando(false)
    }
  }

  // baixa XML/PDF de UMA nota (por id). Usa a URL direta se o provider já serviu; senão, storage assinado.
  async function baixarNota(notaId: string, tipo: 'xml' | 'pdf', urlDireta?: string | null) {
    setBaixando(`${notaId}-${tipo}`)
    try {
      if (urlDireta) { window.open(urlDireta, '_blank', 'noopener,noreferrer'); return }
      const { data, error } = await supabase.rpc('fn_fiscal_get_storage_url', { p_tabela: 'nfse', p_doc_id: notaId, p_tipo: tipo })
      if (error) throw error
      const payload = (data ?? {}) as { ok?: boolean; erro?: string; storage_path?: string; bucket?: string }
      if (!payload.ok || !payload.storage_path) throw new Error(payload.erro ?? 'Arquivo não disponível')
      const bucket = payload.bucket ?? 'fiscal-xmls'
      const signed = await supabase.storage.from(bucket).createSignedUrl(payload.storage_path, 3600)
      if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? 'Erro ao gerar URL assinada')
      window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao baixar')
    } finally {
      setBaixando(null)
    }
  }

  function aplicarBusca() { setBuscaSubmit(busca.trim()); setPagina(1) }

  // #30 — "corrigir e reenviar" o documento não emitido (usa o último registro rejeitado como semente).
  async function corrigirEReenviar(doc: Documento) {
    setPreparandoReenvio(doc.grupo_chave)
    try {
      const { data } = await supabase
        .from('erp_nfse_emitidas')
        .select('codigo_servico, aliquota_iss, tomador_email, erp_receber_id, tomador_cnpj, tomador_cpf, tomador_razao_social, descricao_servico, valor_servicos, motivo_rejeicao')
        .eq('id', doc.principal_id)
        .maybeSingle()
      const extra = (data ?? {}) as {
        codigo_servico?: string | null; aliquota_iss?: number | null; tomador_email?: string | null
        erp_receber_id?: string | null; tomador_cnpj?: string | null; tomador_cpf?: string | null
        tomador_razao_social?: string | null; descricao_servico?: string | null; valor_servicos?: number | null
        motivo_rejeicao?: string | null
      }
      // #82 · nota nascida de receita (FOCUS) → reabre pelo NFSePreviewModal (obra do Hub + E0370 embutidos)
      if (extra.erp_receber_id) {
        setReenviarFocus({
          erpReceberId: extra.erp_receber_id,
          descricao: extra.descricao_servico ?? doc.origem_rotulo ?? undefined,
          valor: extra.valor_servicos ?? doc.valor ?? undefined,
        })
        return
      }
      const cnpj = (extra.tomador_cnpj ?? '').replace(/\D/g, '')
      const cpf = (extra.tomador_cpf ?? '').replace(/\D/g, '')
      setReemitir({
        tomadorDocumento: cnpj || cpf || undefined,
        tomadorTipo: cnpj ? 'cnpj' : cpf ? 'cpf' : undefined,
        tomadorNome: extra.tomador_razao_social ?? doc.contraparte_nome ?? undefined,
        tomadorEmail: extra.tomador_email ?? undefined,
        descricaoServico: extra.descricao_servico ?? doc.origem_rotulo ?? undefined,
        valorServicos: extra.valor_servicos ?? doc.valor ?? undefined,
        codigoServicoMunicipio: extra.codigo_servico ?? undefined,
        aliquotaIss: extra.aliquota_iss ?? undefined,
        permitirObra: /E0370/i.test(extra.motivo_rejeicao ?? doc.motivo_rejeicao ?? ''),
      })
      setEmitirAberto(true)
    } finally {
      setPreparandoReenvio(null)
    }
  }

  async function consultarStatus(recordId: string) {
    setConsultando(recordId)
    try {
      const { data, error } = await supabase.functions.invoke('gov-nfse-consultar', { body: { record_id: recordId } })
      if (error) throw new Error(error.message)
      const resp = data as { ok?: boolean; erro?: string; detalhe?: string } | null
      if (resp && resp.ok === false) throw new Error(resp.erro ?? resp.detalhe ?? 'Falha ao consultar')
      await carregar()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao consultar status')
    } finally {
      setConsultando(null)
    }
  }

  async function consultarPendentes() {
    const pendentes = documentos.filter((d) => d.status_principal === 'processando').map((d) => d.principal_id)
    if (pendentes.length === 0) return
    setConsultando('all')
    try {
      const results = await Promise.allSettled(
        pendentes.map((id) => supabase.functions.invoke('gov-nfse-consultar', { body: { record_id: id } })),
      )
      const falhas: string[] = []
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          falhas.push(`Documento ${i + 1}: ${r.reason instanceof Error ? r.reason.message : 'falha'}`)
        } else {
          const resp = r.value.data as { ok?: boolean; erro?: string; detalhe?: string } | null
          if (r.value.error) falhas.push(`Documento ${i + 1}: ${r.value.error.message}`)
          else if (resp && resp.ok === false) falhas.push(`Documento ${i + 1}: ${resp.erro ?? resp.detalhe ?? 'falha'}`)
        }
      })
      await carregar()
      if (falhas.length > 0) {
        alert(`Algumas consultas falharam:\n\n${falhas.slice(0, 5).join('\n')}${falhas.length > 5 ? `\n…e mais ${falhas.length - 5}` : ''}`)
      }
    } finally {
      setConsultando(null)
    }
  }

  const qtdProcessando = documentos.filter((d) => d.status_principal === 'processando').length

  function resetFiltros() {
    setStatusFiltro(''); setDataInicio(''); setDataFim(''); setBusca(''); setBuscaSubmit(''); setPagina(1)
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

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const inicio = (pagina - 1) * PAGE_SIZE + 1
  const fim = Math.min(pagina * PAGE_SIZE, total)

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <Link href="/dashboard/fiscal" className="inline-flex items-center gap-1.5 text-[12px] text-[#BA7517] hover:text-[#8B5612] mb-3">
          <ArrowLeft size={13} /> Voltar pro Hub Fiscal
        </Link>
        <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight">NFSes Emitidas</h1>
            <p className="text-[13px] text-[#3D2314]/70 mt-1">
              {mostrarRecusadas ? 'Todas as tentativas' : 'Uma linha por documento'} · {total} {total === 1 ? (mostrarRecusadas ? 'registro' : 'documento') : (mostrarRecusadas ? 'registros' : 'documentos')}
            </p>
          </div>
          {companyId && (
            <div className="flex items-center gap-2 flex-wrap">
              {qtdProcessando > 0 && (
                <button type="button" onClick={consultarPendentes} disabled={consultando !== null}
                  data-testid="nfse-atualizar-pendentes"
                  className="inline-flex items-center gap-2 border border-[#3D2314]/15 hover:bg-[#3D2314]/5 text-[#3D2314] text-[12.5px] px-3 py-2 rounded-md disabled:opacity-50">
                  {consultando === 'all' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Atualizar pendentes ({qtdProcessando})
                </button>
              )}
              <button type="button" onClick={() => { setReemitir(null); setEmitirAberto(true) }}
                data-testid="nfse-nova"
                className="inline-flex items-center gap-2 bg-[#C8941A] hover:bg-[#B07F12] text-[#3D2314] font-medium text-[13px] px-4 py-2.5 rounded-md shadow-sm">
                <Plus size={14} /> Emitir NFS-e
              </button>
            </div>
          )}
        </header>

        {companyId && (
          <NFSeEmitirGovModal
            companyId={companyId}
            aberto={emitirAberto}
            onFechar={() => { setEmitirAberto(false); setReemitir(null) }}
            onEmitida={() => { setPagina(1); carregar() }}
            producaoDisponivel={producaoDisponivel}
            tomadorDocumento={reemitir?.tomadorDocumento}
            tomadorTipo={reemitir?.tomadorTipo}
            tomadorNome={reemitir?.tomadorNome}
            tomadorEmail={reemitir?.tomadorEmail}
            descricaoServico={reemitir?.descricaoServico}
            valorServicos={reemitir?.valorServicos}
            codigoServicoMunicipio={reemitir?.codigoServicoMunicipio}
            aliquotaIss={reemitir?.aliquotaIss}
            permitirObra={reemitir?.permitirObra}
          />
        )}

        {cancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/35 p-4" onClick={() => !cancelando && setCancelModal(null)}>
            <div className="bg-white rounded-2xl w-full max-w-[460px] p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[16px] font-bold text-[#3D2314]">Cancelar NFS-e{cancelModal.numero ? ` nº ${cancelModal.numero}` : ''}</h2>
                <button type="button" onClick={() => !cancelando && setCancelModal(null)} className="text-[#3D2314]/50 hover:text-[#3D2314]"><X size={18} /></button>
              </div>
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#FFF6E5] border border-[#BA7517]/40 px-3 py-2 text-[12px] text-[#8A4B08]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>O cancelamento depende do prazo da prefeitura. Se o prazo já venceu, ela pode recusar — o motivo aparece aqui e na linha do tempo da nota.</span>
              </div>
              <label className="block mt-3 text-[11.5px] text-[#6B5D4F]">Justificativa (mínimo 15 caracteres)
                <textarea value={cancelJust} onChange={(e) => { setCancelJust(e.target.value); if (cancelErro) setCancelErro(null) }} rows={3}
                  data-testid="nfse-cancelar-justificativa"
                  placeholder="Ex.: nota emitida em duplicidade para o mesmo serviço"
                  className="w-full mt-1 rounded-lg border border-[#E0D8CC] px-3 py-2 text-[13.5px] text-[#3D2314] focus:outline-none focus:border-[#C8941A]" />
              </label>
              <div className={`text-[11px] mt-1 ${cancelJust.trim().length < 15 ? 'text-[#B42318]' : 'text-[#166534]'}`}>{cancelJust.trim().length}/15</div>
              {cancelErro && <div className="mt-2 rounded-lg bg-[#FDECEC] border border-[#B42318]/30 px-3 py-2 text-[12px] text-[#B42318]">{cancelErro}</div>}
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setCancelModal(null)} disabled={cancelando} className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#E0D8CC] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50">Voltar</button>
                <button type="button" onClick={() => void cancelarNFSe()} disabled={cancelando || cancelJust.trim().length < 15}
                  data-testid="nfse-cancelar-confirmar"
                  className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-1.5 disabled:opacity-50">
                  {cancelando ? <><Loader2 size={13} className="animate-spin" /> Cancelando…</> : <><Ban size={13} /> Confirmar cancelamento</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {companyId && reenviarFocus && (
          <NFSePreviewModal
            open
            onClose={() => setReenviarFocus(null)}
            companyId={companyId}
            erpReceberId={reenviarFocus.erpReceberId}
            descricaoSugerida={reenviarFocus.descricao}
            valor={reenviarFocus.valor}
            onSucesso={() => { setReenviarFocus(null); setPagina(1); carregar() }}
          />
        )}

        <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">Buscar tomador / número / documento</label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
                <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && aplicarBusca()}
                  placeholder="Construtora ABC, 000001, PED-ORC..."
                  className="w-full pl-8 pr-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">Status (principal)</label>
              <select value={statusFiltro} onChange={(e) => { setStatusFiltro(e.target.value); setPagina(1) }}
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white">
                <option value="">Todos</option>
                <option value="autorizada">Autorizada</option>
                <option value="processando">Processando</option>
                <option value="rejeitada">Não emitida (só recusas)</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">De</label>
              <input type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setPagina(1) }}
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#3D2314]/70 block mb-1">Até</label>
              <input type="date" value={dataFim} onChange={(e) => { setDataFim(e.target.value); setPagina(1) }}
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-[12px] text-[#3D2314]/80 cursor-pointer select-none">
              <input type="checkbox" checked={mostrarRecusadas} onChange={(e) => { setMostrarRecusadas(e.target.checked); setPagina(1) }}
                data-testid="nfse-mostrar-recusadas" className="accent-[#C8941A]" />
              Mostrar tentativas recusadas (visão antiga)
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={resetFiltros}
                className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5">Limpar</button>
              <button type="button" onClick={aplicarBusca} data-testid="nfse-aplicar-filtro"
                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-1.5">
                <Search size={12} /> Filtrar
              </button>
            </div>
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
            <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-[#C8941A]" size={24} /></div>
          ) : documentos.length === 0 ? (
            <div className="py-12 text-center text-[12.5px] text-[#3D2314]/60">Nenhum documento encontrado com esses filtros.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 uppercase tracking-[0.5px]">
                  <tr>
                    <th className="px-3 py-2.5 w-8"></th>
                    <th className="text-left px-3 py-2.5 font-medium">Documento</th>
                    <th className="text-left px-3 py-2.5 font-medium">Data</th>
                    <th className="text-left px-3 py-2.5 font-medium">Tomador</th>
                    <th className="text-right px-3 py-2.5 font-medium">Valor</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((doc) => {
                    const aberto = chaveAberta === doc.grupo_chave
                    return (
                      <DocumentoLinhas
                        key={doc.grupo_chave}
                        doc={doc}
                        aberto={aberto}
                        onToggle={() => setAberta(aberto ? null : doc)}
                        timeline={aberto ? timeline : null}
                        obraLink={aberto ? obraLink : null}
                        obraPickerOpen={obraPickerOpen}
                        obraBusca={obraBusca}
                        obras={obras}
                        vinculando={vinculando}
                        confirmDesvincular={confirmDesvincular}
                        preparandoReenvio={preparandoReenvio}
                        baixando={baixando}
                        consultando={consultando}
                        onReenviar={() => corrigirEReenviar(doc)}
                        onCancelar={() => { setCancelJust(''); setCancelErro(null); setCancelModal({ id: doc.principal_id, numero: doc.numero }) }}
                        onConsultar={() => consultarStatus(doc.principal_id)}
                        onBaixar={(notaId, tipo, url) => baixarNota(notaId, tipo, url)}
                        onSetObraPicker={(v) => { setConfirmDesvincular(false); setObraPickerOpen(v) }}
                        onObraBusca={setObraBusca}
                        onVincular={(obraId) => vincularObra(doc.principal_id, obraId)}
                        onSetConfirmDesvincular={setConfirmDesvincular}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="px-4 py-3 border-t border-[#3D2314]/10 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[#3D2314]/70">
              <div>Mostrando {inicio}–{fim} de {total}</div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1}
                  className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-1">
                  <ChevronLeft size={12} /> Anterior
                </button>
                <span className="px-2 text-[12px]">Página {pagina} de {totalPaginas}</span>
                <button type="button" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas}
                  className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-1">
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

// ── Linha do documento + detalhe (linha do tempo, ações, obra) ─────────────────────────────────────
function DocumentoLinhas(props: {
  doc: Documento; aberto: boolean; onToggle: () => void
  timeline: TimelineEvento[] | null
  obraLink: ObraLite | null | 'loading'
  obraPickerOpen: boolean; obraBusca: string; obras: ObraLite[]; vinculando: boolean; confirmDesvincular: boolean
  preparandoReenvio: string | null; baixando: string | null; consultando: string | null
  onReenviar: () => void; onCancelar: () => void; onConsultar: () => void
  onBaixar: (notaId: string, tipo: 'xml' | 'pdf', url?: string | null) => void
  onSetObraPicker: (v: boolean) => void; onObraBusca: (v: string) => void
  onVincular: (obraId: string | null) => void; onSetConfirmDesvincular: (v: boolean) => void
}) {
  const {
    doc, aberto, onToggle, timeline, obraLink, obraPickerOpen, obraBusca, obras, vinculando, confirmDesvincular,
    preparandoReenvio, baixando, consultando, onReenviar, onCancelar, onConsultar, onBaixar,
    onSetObraPicker, onObraBusca, onVincular, onSetConfirmDesvincular,
  } = props
  const podeVincularObra = !doc.nao_emitida // só documento com nota real vincula obra

  return (
    <>
      <tr data-testid="nfse-list-row" className="border-t border-[#3D2314]/8 hover:bg-[#FAEEDA]/30 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2.5">{aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
        <td className="px-3 py-2.5">
          <div className="font-mono text-[12px] text-[#3D2314]">{doc.numero ?? (doc.nao_emitida ? 'sem número' : '—')}</div>
          {doc.origem_rotulo && <div className="text-[10.5px] text-[#3D2314]/55">{doc.origem_rotulo}</div>}
        </td>
        <td className="px-3 py-2.5 text-[12.5px]">{fmtData(doc.data)}</td>
        <td className="px-3 py-2.5">
          <div className="text-[12.5px] text-[#3D2314]">{doc.contraparte_nome ?? '—'}</div>
          <div className="text-[10.5px] text-[#3D2314]/60 font-mono">{fmtDoc(doc.contraparte_doc, null)}</div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmtBRL(doc.valor)}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {doc.nao_emitida ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-[#791F1F] bg-[#FDECEC] border border-[#B42318]/30">
                <XCircle size={11} /> Não emitida
              </span>
            ) : (
              <FiscalStatusBadge status={doc.status_principal} motivo={doc.motivo_rejeicao} />
            )}
            {doc.tentativas_recusadas > 0 && (
              <span title={`${doc.tentativas_recusadas} tentativa(s) recusada(s) neste documento`}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-[#8A4B08] bg-[#FFF6E5] border border-[#BA7517]/40">
                <AlertTriangle size={10} /> {doc.tentativas_recusadas} recusada{doc.tentativas_recusadas > 1 ? 's' : ''}
              </span>
            )}
            {doc.status_principal === 'processando' && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onConsultar() }}
                disabled={consultando === doc.principal_id || consultando === 'all'}
                data-testid="nfse-atualizar-status" title="Consultar retorno na Focus"
                className="text-[#BA7517] hover:text-[#8B5612] disabled:opacity-40">
                {consultando === doc.principal_id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              </button>
            )}
          </div>
        </td>
      </tr>
      {aberto && (
        <tr className="bg-[#FAF7F2]/60 border-t border-[#3D2314]/8">
          <td colSpan={6} className="px-5 py-4">
            {/* Ações do documento */}
            <div className="flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
              {doc.pode_reenviar && (
                <button type="button" onClick={onReenviar} disabled={preparandoReenvio === doc.grupo_chave}
                  data-testid="nfse-corrigir-reenviar"
                  className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-1.5 disabled:opacity-50">
                  {preparandoReenvio === doc.grupo_chave ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Corrigir e reenviar
                </button>
              )}
              {!doc.nao_emitida && (
                <>
                  <button type="button" onClick={() => onBaixar(doc.principal_id, 'xml')} disabled={baixando === `${doc.principal_id}-xml`}
                    data-testid="nfse-download-xml"
                    className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1.5 disabled:opacity-50">
                    {baixando === `${doc.principal_id}-xml` ? <Loader2 size={12} className="animate-spin" /> : <FileCode size={12} />} XML
                  </button>
                  <button type="button" onClick={() => onBaixar(doc.principal_id, 'pdf')} disabled={baixando === `${doc.principal_id}-pdf`}
                    data-testid="nfse-download-pdf"
                    className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1.5 disabled:opacity-50">
                    {baixando === `${doc.principal_id}-pdf` ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} PDF
                  </button>
                </>
              )}
              {doc.status_principal === 'autorizada' && (
                <button type="button" onClick={onCancelar} data-testid="nfse-cancelar"
                  className="px-3 py-1.5 text-[11.5px] font-medium rounded-lg border border-[#3D2314]/25 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1.5">
                  <Ban size={12} /> Cancelar NFS-e
                </button>
              )}
            </div>

            {/* Linha do tempo do documento */}
            <div className="mt-4">
              <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px] mb-2 flex items-center gap-1.5">
                <History size={12} /> Linha do tempo do documento
              </div>
              {timeline === null ? (
                <div className="text-[12px] text-[#3D2314]/55 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Carregando…</div>
              ) : timeline.length === 0 ? (
                <div className="text-[12px] text-[#3D2314]/55">Sem eventos registrados.</div>
              ) : (
                <ol className="relative border-l border-[#3D2314]/15 ml-1.5">
                  {timeline.map((ev, i) => <TimelineItem key={i} ev={ev} onBaixar={onBaixar} baixando={baixando} />)}
                </ol>
              )}
            </div>

            {/* Vínculo de obra (gerencial) — só documento com nota real */}
            {podeVincularObra ? (
              <div className="mt-4 pt-3 border-t border-[#3D2314]/8" onClick={(e) => e.stopPropagation()}>
                <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.5px] mb-1.5 flex items-center gap-1.5">
                  <Building2 size={12} /> Obra vinculada
                  <span className="normal-case tracking-normal text-[#3D2314]/45">— gerencial, não altera a nota</span>
                </div>
                {obraLink === 'loading' ? (
                  <div className="text-[12px] text-[#3D2314]/55 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Carregando…</div>
                ) : obraLink ? (
                  <div className="flex items-center gap-2 flex-wrap text-[12px]">
                    <span className="font-medium text-[#3D2314]">{obraLink.numero}</span>
                    <span className="text-[#3D2314]/60">{obraResumo(obraLink)}</span>
                    {obraIncompleta(obraLink) && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#B45309] bg-[#FEF3E2] border border-[#B45309]/30 rounded-full px-2 py-0.5">
                        <AlertTriangle size={10} /> incompleta
                      </span>
                    )}
                    <button type="button" onClick={() => onSetObraPicker(!obraPickerOpen)} className="text-[11.5px] text-[#BA7517] hover:text-[#8B5612] underline underline-offset-2">Trocar</button>
                    {confirmDesvincular ? (
                      <span className="inline-flex items-center gap-2 text-[11.5px] text-[#791F1F]">
                        Remover o vínculo? Perde o rastreio de custo desta nota.
                        <button type="button" onClick={() => onVincular(null)} disabled={vinculando} data-testid="nfse-desvincular-confirmar" className="font-semibold underline underline-offset-2 hover:text-[#5A1616] disabled:opacity-50">Confirmar</button>
                        <button type="button" onClick={() => onSetConfirmDesvincular(false)} className="text-[#3D2314]/55 hover:text-[#3D2314] underline underline-offset-2">Cancelar</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => onSetConfirmDesvincular(true)} className="text-[11.5px] text-[#3D2314]/55 hover:text-[#791F1F] underline underline-offset-2">Desvincular</button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="text-[#3D2314]/60">Nenhuma obra vinculada.</span>
                    <button type="button" onClick={() => onSetObraPicker(!obraPickerOpen)} data-testid="nfse-vincular-obra" className="text-[11.5px] font-medium text-[#BA7517] hover:text-[#8B5612] underline underline-offset-2">Vincular obra</button>
                  </div>
                )}
                {obraPickerOpen && (
                  <div className="mt-2 border border-[#3D2314]/12 rounded-lg bg-white p-2">
                    <div className="relative mb-2">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
                      <input type="text" value={obraBusca} onChange={(e) => onObraBusca(e.target.value)}
                        placeholder="Buscar obra por número, nome, cidade ou endereço"
                        className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-[#3D2314]/15 rounded-md focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40" />
                    </div>
                    <div className="max-h-52 overflow-y-auto divide-y divide-[#3D2314]/6">
                      {obras.length === 0 ? (
                        <div className="py-2 text-[11.5px] text-[#3D2314]/55">Nenhuma obra encontrada.</div>
                      ) : obras.map((o) => (
                        <button key={o.id} type="button" onClick={() => onVincular(o.id)} disabled={vinculando}
                          className="w-full text-left py-2 px-1.5 hover:bg-[#FAEEDA]/40 disabled:opacity-50 flex flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#3D2314]">
                            {o.numero}
                            {obraIncompleta(o) && <span className="text-[9.5px] font-semibold text-[#B45309] bg-[#FEF3E2] border border-[#B45309]/30 rounded-full px-1.5">incompleta</span>}
                          </span>
                          <span className="text-[11px] text-[#3D2314]/60">{obraResumo(o)}{o.cliente_nome ? ` · ${o.cliente_nome}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 pt-3 border-t border-[#3D2314]/8">
                <div className="flex items-start gap-1.5 text-[11.5px] text-[#791F1F]">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  <span>Documento ainda não emitido — não há nota fiscal para vincular obra. Use “Corrigir e reenviar”: a obra é informada na emissão.</span>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// item da linha do tempo
function TimelineItem({ ev, onBaixar, baixando }: {
  ev: TimelineEvento
  onBaixar: (notaId: string, tipo: 'xml' | 'pdf', url?: string | null) => void
  baixando: string | null
}) {
  const meta = ((): { icon: React.ReactNode; titulo: string; cor: string } => {
    switch (ev.categoria) {
      case 'recusa': return { icon: <XCircle size={13} />, titulo: 'Recusada pela prefeitura', cor: '#B42318' }
      case 'autorizacao': return { icon: <CheckCircle2 size={13} />, titulo: ev.numero ? `Autorizada · nº ${ev.numero}` : 'Autorizada', cor: '#166534' }
      case 'cancelamento': return { icon: <Ban size={13} />, titulo: 'Cancelada', cor: '#8A4B08' }
      case 'processando': return { icon: <Clock size={13} />, titulo: 'Enviada — aguardando retorno', cor: '#8A4B08' }
      case 'tentativa': {
        const rot = RESULTADO_ROTULO[ev.status] ?? { t: ev.status, cor: '#6B5D4F', bg: '#F0ECE3' }
        return { icon: <FileSignature size={13} />, titulo: `Tentativa: ${ev.operacao ?? '—'} · ${rot.t}`, cor: rot.cor }
      }
      default: return { icon: <History size={13} />, titulo: ev.categoria, cor: '#6B5D4F' }
    }
  })()
  const temArquivo = ev.categoria === 'autorizacao' && (ev.xml_url || ev.pdf_url || ev.xml_storage_path || ev.pdf_storage_path)
  return (
    <li className="ml-4 pb-3 last:pb-0">
      <span className="absolute -left-[6.5px] mt-0.5 flex h-3 w-3 items-center justify-center rounded-full" style={{ background: meta.cor }} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span style={{ color: meta.cor }} className="inline-flex items-center gap-1 text-[12px] font-semibold">{meta.icon} {meta.titulo}</span>
        <span className="text-[10.5px] text-[#3D2314]/50 font-mono">{fmtDataHora(ev.quando)}</span>
        {ev.http_status != null && <span className="text-[10.5px] text-[#3D2314]/45 font-mono">HTTP {ev.http_status}</span>}
        {ev.provider_codigo && <span className="text-[10.5px] text-[#3D2314]/60 font-mono">{ev.provider_codigo}</span>}
      </div>
      {ev.detalhe && <div className="text-[11.5px] text-[#3D2314]/75 mt-0.5">{ev.detalhe}</div>}
      {ev.chave && <div className="text-[10.5px] text-[#3D2314]/50 font-mono mt-0.5 break-all">chave: {ev.chave}</div>}
      {temArquivo && ev.nota_id && (
        <div className="flex gap-2 mt-1">
          <button type="button" onClick={() => onBaixar(ev.nota_id!, 'xml', ev.xml_url)} disabled={baixando === `${ev.nota_id}-xml`}
            className="px-2 py-1 text-[10.5px] font-medium rounded-md border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1 disabled:opacity-50">
            {baixando === `${ev.nota_id}-xml` ? <Loader2 size={10} className="animate-spin" /> : <FileCode size={10} />} XML
          </button>
          <button type="button" onClick={() => onBaixar(ev.nota_id!, 'pdf', ev.pdf_url)} disabled={baixando === `${ev.nota_id}-pdf`}
            className="px-2 py-1 text-[10.5px] font-medium rounded-md border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1 disabled:opacity-50">
            {baixando === `${ev.nota_id}-pdf` ? <Loader2 size={10} className="animate-spin" /> : <FileText size={10} />} PDF
          </button>
        </div>
      )}
    </li>
  )
}
