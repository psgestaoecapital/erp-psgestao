'use client'

// nfe-recebidas · Documentos Recebidos (Compras)
// Mostra NFes recebidas (modelo 55) destinadas ao CNPJ da empresa.
// "Buscar agora" chama a edge nfe-distribuicao (Focus DF-e).
// "Lancar em Contas a Pagar (F2)" chama a edge nfe-recebida-processar
// (manifesta ciencia, baixa XML completo, popula itens + duplicatas,
// gera contas a pagar).

import { useEffect, useMemo, useState } from 'react'
import { Inbox, Loader2, RefreshCw, Search, FileText, AlertCircle, PowerOff, Power, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { ItensNfeRecebida } from './_components/ItensNfeRecebida'

interface Linha {
  id: string
  chave_acesso: string
  numero: string | null
  serie: string | null
  fornecedor: string | null
  cnpj: string | null
  data_emissao: string | null
  valor_total: number | null
  status: string
  manifestacao: string
  lancado_pagar: boolean
  qtd_itens: number
  qtd_duplicatas: number
}

interface ListaResp {
  ok: boolean
  total: number
  itens: Linha[]
  erro?: string
}

interface BuscaResp {
  ok: boolean
  erro?: string
  ambiente?: string
  recebidas?: number
  novas?: number
  atualizadas?: number
  body_preview?: string
}

function fmtData(s: string | null): string {
  if (!s) return '—'
  const d = s.split('T')[0]
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

function fmtBRL(v: number | null): string {
  return 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCNPJ(s: string | null): string {
  if (!s) return '—'
  const c = s.replace(/\D/g, '')
  if (c.length !== 14) return s
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

function chipManifestacao(m: string): { cor: string; bg: string; texto: string } {
  if (m === 'confirmada') return { cor: '#3F7012', bg: '#E8F4DC', texto: 'Confirmada' }
  if (m === 'ciencia') return { cor: '#BA7517', bg: '#FAEEDA', texto: 'Ciência' }
  if (m === 'desconhecida') return { cor: '#A32D2D', bg: '#FCEBEB', texto: 'Desconhecida' }
  if (m === 'nao_realizada') return { cor: '#A32D2D', bg: '#FCEBEB', texto: 'Não realizada' }
  return { cor: 'rgba(61,35,20,0.65)', bg: 'rgba(61,35,20,0.08)', texto: 'Pendente' }
}

function chipStatus(s: string): { cor: string; bg: string; texto: string } {
  if (s === 'completa') return { cor: '#3F7012', bg: '#E8F4DC', texto: 'Pronta' }
  if (s === 'lancada') return { cor: '#3F7012', bg: '#E8F4DC', texto: 'Lançada' }
  if (s === 'aguardando_xml') return { cor: '#BA7517', bg: '#FAEEDA', texto: 'Aguardando SEFAZ (~2h)' }
  if (s === 'ignorada') return { cor: 'rgba(61,35,20,0.55)', bg: 'rgba(61,35,20,0.06)', texto: 'Ignorada' }
  return { cor: 'rgba(61,35,20,0.65)', bg: 'rgba(61,35,20,0.08)', texto: 'Resumo' }
}

export default function DocumentosRecebidosPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [lista, setLista] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  // Habilitacao DF-e por empresa · RPC valida cert A1 + token no vault + admin
  const [habilitado, setHabilitado] = useState<boolean | null>(null)
  const [habilitando, setHabilitando] = useState(false)
  // Onda 2.2 · sincronizacao automatica
  const [ultimoCiclo, setUltimoCiclo] = useState<string | null>(null)
  const [autoCiencia, setAutoCiencia] = useState<boolean>(true)
  // F2 · estado por card pra "Lancar em Contas a Pagar"
  const [processando, setProcessando] = useState<Record<string, boolean>>({})
  const [processandoTodos, setProcessandoTodos] = useState(false)
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null)
  // Onda 3 · expansao por card pra ver/vincular itens
  const [expandido, setExpandido] = useState<Record<string, boolean>>({})

  async function carregar() {
    if (!empresaUnica) return
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_recebidas_listar', {
      p_company_id: empresaUnica,
      p_status: filtroStatus === 'todos' ? null : filtroStatus,
      p_limit: 200,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as ListaResp
    if (!r.ok) { setErro(r.erro ?? 'Erro ao carregar'); return }
    setLista(r.itens ?? [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaUnica, filtroStatus])

  async function toggleAutoCiencia(novo: boolean) {
    if (!empresaUnica) return
    const anterior = autoCiencia
    // sem otimismo · so reflete na UI quando o servidor confirmar.
    // (UPDATE direto era silenciosamente bloqueado pelo RLS · agora vai
    //  via RPC SECURITY DEFINER com check de get_user_company_ids/is_admin.)
    const { data, error } = await supabase.rpc('fn_nfe_distribuicao_set_auto_ciencia', {
      p_company_id: empresaUnica,
      p_auto: novo,
    })
    if (error) {
      setErro('Não foi possível alterar a ciência automática: ' + error.message)
      setAutoCiencia(anterior)
      return
    }
    const r = data as { ok: boolean; auto_ciencia?: boolean; erro?: string } | null
    if (!r?.ok) {
      setErro('Não foi possível alterar a ciência automática: ' + (r?.erro ?? 'sem retorno'))
      setAutoCiencia(anterior)
      return
    }
    setAutoCiencia(r.auto_ciencia === true)
    setToast(r.auto_ciencia ? 'Ciência automática LIGADA' : 'Ciência automática DESLIGADA')
    setTimeout(() => setToast(null), 3000)
  }

  async function loadHabilitacao() {
    if (!empresaUnica) { setHabilitado(null); setUltimoCiclo(null); return }
    const { data } = await supabase
      .from('erp_nfe_distribuicao_controle')
      .select('habilitado, ultimo_ciclo_em, auto_ciencia')
      .eq('company_id', empresaUnica)
      .maybeSingle()
    setHabilitado(!!data?.habilitado)
    setUltimoCiclo((data?.ultimo_ciclo_em as string | undefined) ?? null)
    setAutoCiencia(data?.auto_ciencia !== false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHabilitacao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaUnica])

  async function habilitarDfe(novo: boolean) {
    if (!empresaUnica) return
    setHabilitando(true); setErro(null); setToast(null)
    const { data, error } = await supabase.rpc('fn_nfe_distribuicao_habilitar', {
      p_company_id: empresaUnica,
      p_habilitar: novo,
    })
    setHabilitando(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; habilitado: boolean; motivo?: string } | null
    if (!r || !r.ok) {
      const motivo = r?.motivo === 'cert_a1_ausente_ou_expirado'
        ? 'Certificado A1 ausente ou expirado.'
        : r?.motivo === 'token_focus_ausente_no_cofre'
        ? 'Token Focus ausente no cofre.'
        : (r?.motivo ?? 'motivo desconhecido')
      setErro('Nao foi possivel habilitar: ' + motivo)
      return
    }
    setHabilitado(novo)
    setToast(novo ? 'DF-e habilitado para esta empresa.' : 'DF-e desabilitado.')
    setTimeout(() => setToast(null), 4000)
  }

  async function buscarAgora() {
    if (!empresaUnica) return
    setBuscando(true)
    setErro(null)
    setToast(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
      const r = await fetch(`${baseUrl}/functions/v1/nfe-distribuicao`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ company_id: empresaUnica }),
      })
      const json = (await r.json()) as BuscaResp
      if (!r.ok || !json.ok) {
        setErro(json.erro ?? `Erro HTTP ${r.status}`)
        return
      }
      setToast(
        `✅ BUSCOU na Focus · ${json.recebidas ?? 0} resumos · ${json.novas ?? 0} novas · ${json.atualizadas ?? 0} atualizadas`
      )
      await carregar()
      setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro de rede')
    } finally {
      setBuscando(false)
    }
  }

  async function lancarPagar(nfeId: string): Promise<{ ok: boolean; msg: string }> {
    if (!empresaUnica) return { ok: false, msg: 'sem empresa' }
    // Onda 3.2 · wrapper RPC: gera pagar + da entrada no estoque (itens
    // elegiveis pelo CFOP + produto vinculado).
    const { data, error } = await supabase.rpc('fn_nfe_recebida_lancar', {
      p_nfe_recebida_id: nfeId,
    })
    if (error) return { ok: false, msg: `Não consegui lançar: ${error.message}` }
    const r = data as {
      ok: boolean
      erro?: string
      pagar?: {
        ok: boolean
        pagar_criadas?: number
        ja_lancado?: boolean
        fornecedor_id?: string | null
        valor_total?: number | null
      }
      estoque?: {
        ok: boolean
        itens_movidos?: number
        pendentes_vinculo?: number
        valor_entrada?: number
      }
    } | null
    if (!r?.ok) return { ok: false, msg: `Não consegui lançar: ${r?.erro ?? 'sem retorno'}` }

    const linha = lista.find((l) => l.id === nfeId)
    const forn = linha?.fornecedor ?? 'fornecedor'
    const criadas = r.pagar?.pagar_criadas ?? 0
    const jaLancado = r.pagar?.ja_lancado === true
    const mov = r.estoque?.itens_movidos ?? 0
    const pend = r.estoque?.pendentes_vinculo ?? 0

    const partes: string[] = []
    if (jaLancado) {
      partes.push(`Já tinha sido lançada antes — ${forn}`)
    } else {
      partes.push(`✅ CRIOU ${criadas} conta(s) a pagar de ${forn}`)
    }
    if (mov > 0) partes.push(`${mov} item(ns) deram entrada no estoque`)
    if (pend > 0) partes.push(`${pend} pendente(s) de vínculo`)
    return { ok: true, msg: partes.join(' · ') }
  }

  async function lancarUma(nfeId: string) {
    setProcessando((p) => ({ ...p, [nfeId]: true }))
    setErro(null)
    setToast(null)
    const r = await lancarPagar(nfeId)
    setProcessando((p) => ({ ...p, [nfeId]: false }))
    if (r.ok) {
      setToast(r.msg)
      await carregar()
      setTimeout(() => setToast(null), 4000)
    } else {
      setErro(r.msg)
    }
  }

  async function lancarPendentes() {
    const pendentes = lista.filter((l) => l.status === 'resumo' && !l.lancado_pagar)
    if (pendentes.length === 0) {
      setToast('Nenhum resumo pendente — todas já estão lançadas.')
      setTimeout(() => setToast(null), 3000)
      return
    }
    if (!confirm(`Processar ${pendentes.length} nota(s) pendente(s)? (throttle 2s/nota — respeitando limite SEFAZ)`)) return
    setProcessandoTodos(true)
    setErro(null)
    setToast(null)
    setProgresso({ feitas: 0, total: pendentes.length })
    let ok = 0
    let falha = 0
    for (let idx = 0; idx < pendentes.length; idx++) {
      const nfe = pendentes[idx]
      setProcessando((p) => ({ ...p, [nfe.id]: true }))
      const r = await lancarPagar(nfe.id)
      setProcessando((p) => ({ ...p, [nfe.id]: false }))
      if (r.ok) ok++; else falha++
      setProgresso({ feitas: idx + 1, total: pendentes.length })
      // Throttle 2s entre chamadas Focus (limite recomendado SEFAZ)
      if (idx < pendentes.length - 1) await new Promise((r) => setTimeout(r, 2000))
    }
    setProcessandoTodos(false)
    setProgresso(null)
    await carregar()
    setToast(`Processado: ${ok} ok · ${falha} falha(s) · pendentes voltarão sozinhas quando o XML chegar.`)
    setTimeout(() => setToast(null), 6000)
  }

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((n) =>
      (n.fornecedor ?? '').toLowerCase().includes(q) ||
      (n.cnpj ?? '').includes(q.replace(/\D/g, '')) ||
      (n.chave_acesso ?? '').includes(q.replace(/\D/g, ''))
    )
  }, [lista, busca])

  if (!empresaUnica) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] p-6">
        <div className="max-w-3xl mx-auto bg-white border border-[#3D2314]/10 rounded-xl p-6 text-center text-[#3D2314]">
          Selecione uma empresa específica no trocador da TopNav.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
              Compras · Documentos Recebidos
            </div>
            <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
              <Inbox size={22} className="text-[#C8941A]" /> NFes Recebidas
            </h1>
            <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-2xl">
              Notas emitidas contra o CNPJ desta empresa · puxa direto da Distribuição DF-e (Focus NFe).
              Os itens e duplicatas chegam quando a manifestação for feita (F2).
            </p>
            {habilitado === true && (
              <div className="mt-3 flex items-center gap-3 flex-wrap text-[11.5px] text-[#3D2314]/70">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#E8F4DC] text-[#3F7012] font-medium"
                  title="O cron de 1h busca notas novas e dá ciência automática. O cron de 30min baixa o XML quando a SEFAZ liberar."
                >
                  ● Sincronização automática ativa
                  {ultimoCiclo && (
                    <span className="text-[#3F7012]/70 font-normal">
                      · última {new Date(ultimoCiclo).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCiencia}
                    onChange={(e) => void toggleAutoCiencia(e.target.checked)}
                    className="cursor-pointer"
                  />
                  Dar ciência automática
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {habilitado === false && (
              <button
                type="button"
                onClick={() => void habilitarDfe(true)}
                disabled={habilitando}
                title="Cria/ativa o controle de Distribuicao DF-e para esta empresa (valida cert A1 + token)"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3F7012] text-white text-[13px] font-medium hover:bg-[#2F5510] disabled:opacity-50 min-h-[44px]"
              >
                {habilitando ? <Loader2 className="animate-spin" size={15} /> : <Power size={15} />}
                {habilitando ? 'Habilitando…' : 'Habilitar recebimento'}
              </button>
            )}
            {habilitado === true && (
              <button
                type="button"
                onClick={() => { if (confirm('Desabilitar recebimento DF-e desta empresa?')) void habilitarDfe(false) }}
                disabled={habilitando}
                title="Pausa o recebimento automatico para esta empresa (controle nao e apagado)"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#3D2314]/15 text-[12px] font-medium text-[#3D2314]/65 hover:bg-[#3D2314]/5 disabled:opacity-50 min-h-[44px]"
              >
                <PowerOff size={14} />
                Desabilitar
              </button>
            )}
            <button
              type="button"
              onClick={() => void buscarAgora()}
              disabled={buscando || habilitado === false}
              title={habilitado === false ? 'Habilite o recebimento DF-e primeiro' : undefined}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C8941A] text-white text-[13px] font-medium hover:bg-[#A87810] disabled:opacity-50 min-h-[44px]"
            >
              {buscando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              {buscando ? 'Buscando…' : 'Buscar agora'}
            </button>
            {habilitado === true && lista.some((l) => l.status === 'resumo' && !l.lancado_pagar) && (
              <button
                type="button"
                onClick={() => void lancarPendentes()}
                disabled={processandoTodos}
                title="Manifesta e lança em pagar todas as notas em resumo"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3D2314] text-[#FAF7F2] text-[13px] font-medium hover:bg-[#5A3520] disabled:opacity-50 min-h-[44px]"
              >
                {processandoTodos ? <Loader2 className="animate-spin" size={15} /> : <Zap size={15} />}
                {processandoTodos
                  ? `Processando ${progresso?.feitas ?? 0}/${progresso?.total ?? 0}…`
                  : 'Processar pendentes'}
              </button>
            )}
          </div>
        </header>

        <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#3D2314]/10 flex items-center gap-2 flex-wrap">
            <Search size={15} className="text-[#3D2314]/50" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por fornecedor, CNPJ ou chave..."
              className="flex-1 text-[13px] outline-none bg-transparent text-[#3D2314] min-w-[200px]"
            />
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="text-[12px] bg-white border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[#3D2314]"
            >
              <option value="todos">Todos os status</option>
              <option value="resumo">Resumo</option>
              <option value="aguardando_xml">Aguardando SEFAZ</option>
              <option value="completa">Pronta</option>
              <option value="lancada">Lançada</option>
              <option value="ignorada">Ignorada</option>
            </select>
          </div>

          {erro && (
            <div className="bg-[#FCEBEB] border-l-4 border-[#C94544] px-4 py-3 text-[12px] text-[#791F1F] flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}
          {toast && (
            <div className="bg-[#E8F4DC] border-l-4 border-[#3F7012] px-4 py-3 text-[12px] text-[#1B3608]">
              {toast}
            </div>
          )}

          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]">
              <Loader2 className="animate-spin" size={15} /> Carregando…
            </div>
          ) : filtrada.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <FileText size={36} className="mx-auto mb-3 text-[#3D2314]/30" />
              <div className="text-[14px] text-[#3D2314] font-medium mb-1">
                {lista.length === 0 ? 'Nenhuma nota recebida ainda' : 'Nenhuma nota para o filtro atual'}
              </div>
              {lista.length === 0 && (
                <div className="text-[12px] text-[#3D2314]/65 max-w-md mx-auto">
                  Confirme a habilitação fiscal (certificado + token + Recebimento de NFes na Focus).{' '}
                  <a href="/dashboard/configuracoes/fiscal" className="underline text-[#BA7517] font-medium">
                    Ir para Configurações › Fiscal
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#3D2314]/8">
              {filtrada.map((n) => {
                const cm = chipManifestacao(n.manifestacao)
                const cs = chipStatus(n.status)
                const podeExpandir = n.status !== 'ignorada'
                const isExpandido = !!expandido[n.id]
                return (
                  <div key={n.id} className="px-4 py-3 sm:px-5 sm:py-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[220px]">
                        <div className="text-[13.5px] font-medium text-[#3D2314]">
                          {n.fornecedor ?? '(sem fornecedor)'}
                        </div>
                        <div className="text-[11px] text-[#3D2314]/60 mt-0.5">
                          {fmtCNPJ(n.cnpj)} · NFe {n.numero ?? '—'}/{n.serie ?? '—'} · {fmtData(n.data_emissao)}
                        </div>
                        <div className="text-[10.5px] text-[#3D2314]/45 mt-0.5 font-mono break-all">
                          {n.chave_acesso}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ background: cm.bg, color: cm.cor }} className="px-2 py-0.5 rounded-full text-[10.5px] font-medium">
                          {cm.texto}
                        </span>
                        <span style={{ background: cs.bg, color: cs.cor }} className="px-2 py-0.5 rounded-full text-[10.5px] font-medium">
                          {cs.texto}
                        </span>
                        <div className="text-[14px] font-semibold text-[#C8941A] tabular-nums min-w-[100px] text-right">
                          {fmtBRL(n.valor_total)}
                        </div>
                        {podeExpandir && (
                          <button
                            type="button"
                            onClick={() => setExpandido((p) => ({ ...p, [n.id]: !p[n.id] }))}
                            title={isExpandido ? 'Ocultar itens' : 'Ver itens da nota'}
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70 hover:bg-[#3D2314]/5"
                          >
                            {isExpandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {isExpandido ? 'Ocultar' : 'Itens'}
                          </button>
                        )}
                        {n.lancado_pagar || n.status === 'lancada' ? (
                          <span className="text-[11px] px-2.5 py-1 rounded-md bg-[#E8F4DC] text-[#3F7012] font-medium">
                            ✓ Lançada
                          </span>
                        ) : n.status === 'aguardando_xml' ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-[#BA7517]/30 text-[#BA7517] font-medium bg-[#FAEEDA]"
                            title="A SEFAZ libera o XML completo em até 2h após a manifestação. A conta é criada sozinha assim que chegar."
                          >
                            <Loader2 className="animate-pulse" size={11} />
                            Aguardando SEFAZ
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void lancarUma(n.id)}
                            disabled={!!processando[n.id] || processandoTodos}
                            title={
                              n.status === 'completa'
                                ? 'Gera contas a pagar + dá entrada no estoque dos itens elegíveis (CFOP + produto vinculado).'
                                : 'Gera contas a pagar pela total (sem itens vinculados ainda).'
                            }
                            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-[#3D2314] text-[#FAF7F2] font-medium hover:bg-[#5A3520] disabled:opacity-50"
                          >
                            {processando[n.id] ? <Loader2 className="animate-spin" size={11} /> : <Zap size={11} />}
                            {processando[n.id] ? 'Lançando…' : 'Lançar em Contas a Pagar'}
                          </button>
                        )}
                      </div>
                    </div>
                    {isExpandido && empresaUnica && (
                      <ItensNfeRecebida
                        nfeId={n.id}
                        companyId={empresaUnica}
                        onChange={() => void carregar()}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-[11px] text-[#3D2314]/55 mt-4">
          F1: traz só o cabeçalho/resumo da nota. F2 vai puxar o XML completo após manifestação e
          permitir lançar como Contas a Pagar.
        </p>
      </div>
    </div>
  )
}
