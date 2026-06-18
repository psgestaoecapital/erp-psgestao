'use client'

// nfe-recebidas-f1 · Documentos Recebidos (Compras)
// Mostra NFes recebidas (modelo 55) destinadas ao CNPJ da empresa.
// "Buscar agora" chama a edge nfe-distribuicao (Focus DF-e).
// Lancar em Contas a Pagar -> em breve (F2).

import { useEffect, useMemo, useState } from 'react'
import { Inbox, Loader2, RefreshCw, Search, FileText, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

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
  if (s === 'completa') return { cor: '#3F7012', bg: '#E8F4DC', texto: 'Completa' }
  if (s === 'lancada') return { cor: '#3F7012', bg: '#E8F4DC', texto: 'Lançada' }
  if (s === 'ignorada') return { cor: 'rgba(61,35,20,0.55)', bg: 'rgba(61,35,20,0.06)', texto: 'Ignorada' }
  return { cor: '#BA7517', bg: '#FAEEDA', texto: 'Resumo' }
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
          </div>
          <button
            type="button"
            onClick={() => void buscarAgora()}
            disabled={buscando}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C8941A] text-white text-[13px] font-medium hover:bg-[#A87810] disabled:opacity-50 min-h-[44px]"
          >
            {buscando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            {buscando ? 'Buscando…' : 'Buscar agora'}
          </button>
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
              <option value="completa">Completa</option>
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
                return (
                  <div key={n.id} className="px-4 py-3 sm:px-5 sm:py-4 flex items-start justify-between gap-3 flex-wrap">
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
                      <button
                        type="button"
                        disabled
                        title="Em breve (F2)"
                        className="text-[11px] px-2.5 py-1 rounded-md border border-[#3D2314]/15 text-[#3D2314]/45 cursor-not-allowed"
                      >
                        Lançar em Contas a Pagar (F2)
                      </button>
                    </div>
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
