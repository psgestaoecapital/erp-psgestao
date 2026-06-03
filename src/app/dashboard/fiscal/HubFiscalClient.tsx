'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Receipt, FileText, AlertTriangle, Settings, Archive, Loader2, AlertCircle,
  CheckCircle2, ArrowRight,
} from 'lucide-react'

interface ResumoFiscal {
  nfse_emitidas?: {
    total?: number
    autorizadas?: number
    processando?: number
    erros?: number
    autorizadas_mes?: number
    valor_total?: number
    valor_mes?: number
  }
  nfe_emitidas?: {
    total?: number
    autorizadas?: number
    processando?: number
    erros?: number
    autorizadas_mes?: number
    valor_total?: number
    valor_mes?: number
  }
  pendencias?: {
    total_processando?: number
    total_erros?: number
  }
  configuracao?: {
    focus_configurado?: boolean
    ambiente?: string | null
    proxima_numeracao_nfse?: number | null
    proxima_numeracao_nfe?: number | null
  }
  storage?: {
    nfse_armazenadas?: number
    nfe_armazenadas?: number
    pendentes_fila?: number
  }
}

interface State {
  loading: boolean
  companyId: string | null
  resumo: ResumoFiscal | null
  erro: string | null
}

function resolveCompanyId(): { kind: 'ok'; id: string } | { kind: 'erro'; mensagem: string } {
  if (typeof window === 'undefined') return { kind: 'erro', mensagem: 'Carregando…' }
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado') {
    return { kind: 'erro', mensagem: 'Selecione uma empresa específica no trocador da TopNav.' }
  }
  if (sel.startsWith('group_')) {
    return { kind: 'erro', mensagem: 'Hub Fiscal é por empresa — selecione uma empresa do grupo.' }
  }
  return { kind: 'ok', id: sel }
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v ?? 0)

export default function HubFiscalClient() {
  const [state, setState] = useState<State>({ loading: true, companyId: null, resumo: null, erro: null })

  const carregar = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const sel = resolveCompanyId()
    if (sel.kind === 'erro') {
      setState({ loading: false, companyId: null, resumo: null, erro: sel.mensagem })
      return
    }
    try {
      const { data, error } = await supabase.rpc('fn_hub_fiscal_resumo', { p_company_id: sel.id })
      if (error) throw error
      setState({ loading: false, companyId: sel.id, resumo: (data ?? {}) as ResumoFiscal, erro: null })
    } catch (err) {
      setState({
        loading: false,
        companyId: sel.id,
        resumo: null,
        erro: err instanceof Error ? err.message : 'Erro ao carregar hub fiscal',
      })
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  if (state.loading) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C8941A]" size={28} />
      </div>
    )
  }

  if (state.erro && !state.companyId) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] px-4 py-6">
        <div className="max-w-3xl mx-auto bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={18} />
          <div className="text-[13px] text-[#791F1F]">{state.erro}</div>
        </div>
      </div>
    )
  }

  const r = state.resumo ?? {}
  const nfse = r.nfse_emitidas ?? {}
  const nfe = r.nfe_emitidas ?? {}
  const pendencias = r.pendencias ?? {}
  const config = r.configuracao ?? {}
  const storage = r.storage ?? {}
  const totalPendencias = (pendencias.total_processando ?? 0) + (pendencias.total_erros ?? 0)
  const focusOk = !!config.focus_configurado

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-5">
        <header>
          <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
            Gestão Empresarial · Fiscal
          </div>
          <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight">Hub Fiscal</h1>
          <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
            Visão consolidada · NFSes/NFes emitidas · pendências · configuração · armazenamento SINIEF.
          </p>
        </header>

        {state.erro && (
          <div className="bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={16} />
            <div className="text-[12px] text-[#791F1F]">{state.erro}</div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card
            href="/dashboard/fiscal/nfse"
            testId="hub-fiscal-card-nfse"
            icon={<Receipt className="text-[#C8941A]" size={22} />}
            label="NFSes Emitidas"
            valor={String(nfse.autorizadas_mes ?? 0)}
            sufixo="no mês"
            sub={fmtBRL(nfse.valor_mes ?? 0)}
            pill={
              (nfse.processando ?? 0) > 0
                ? { color: 'amber', text: `${nfse.processando} processando` }
                : null
            }
          />

          <Card
            href="/dashboard/fiscal/nfe"
            testId="hub-fiscal-card-nfe"
            icon={<FileText className="text-[#C8941A]" size={22} />}
            label="NFes Emitidas"
            valor={String(nfe.autorizadas_mes ?? 0)}
            sufixo="no mês"
            sub={fmtBRL(nfe.valor_mes ?? 0)}
            pill={
              (nfe.processando ?? 0) > 0
                ? { color: 'amber', text: `${nfe.processando} processando` }
                : null
            }
          />

          <div
            data-testid="hub-fiscal-card-pendencias"
            className="bg-white border border-[#3D2314]/10 rounded-xl p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <AlertTriangle
                size={22}
                className={
                  (pendencias.total_erros ?? 0) > 0
                    ? 'text-[#C94544]'
                    : (pendencias.total_processando ?? 0) > 0
                      ? 'text-[#C8941A]'
                      : 'text-[#3F7012]'
                }
              />
            </div>
            <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium mb-1">
              Pendências
            </div>
            <div className="text-[28px] font-medium text-[#3D2314] leading-none mb-2">
              {totalPendencias}
            </div>
            <div className="text-[11.5px] text-[#3D2314]/70 space-y-0.5">
              <div>{pendencias.total_processando ?? 0} processando</div>
              <div className={(pendencias.total_erros ?? 0) > 0 ? 'text-[#791F1F] font-medium' : ''}>
                {pendencias.total_erros ?? 0} com erro
              </div>
            </div>
          </div>

          <Link
            href="/dashboard/configuracoes/fiscal"
            data-testid="hub-fiscal-card-config"
            className="bg-white border border-[#3D2314]/10 rounded-xl p-5 hover:border-[#C8941A]/45 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <Settings className="text-[#C8941A]" size={22} />
              <span className="text-[10px] text-[#3D2314]/55 flex items-center gap-1">
                EDITAR <ArrowRight size={11} />
              </span>
            </div>
            <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium mb-1">
              Configuração
            </div>
            <div className="text-[14px] font-medium mb-1.5 flex items-center gap-1.5">
              {focusOk ? (
                <span className="text-[#1B3608] flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> Ativa
                </span>
              ) : (
                <span className="text-[#633806] flex items-center gap-1.5">
                  <AlertCircle size={14} /> Pendente
                </span>
              )}
            </div>
            {focusOk ? (
              <div className="text-[11px] text-[#3D2314]/70 space-y-0.5">
                <div>Ambiente: {config.ambiente ?? '—'}</div>
                <div>Próx NFSe nº {config.proxima_numeracao_nfse ?? '—'}</div>
                <div>Próx NFe nº {config.proxima_numeracao_nfe ?? '—'}</div>
              </div>
            ) : (
              <div className="text-[11px] text-[#633806]">
                Configure A1 + Focus NFe pra emitir
              </div>
            )}
          </Link>
        </div>

        <div className="bg-white border border-[#3D2314]/10 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Archive className="text-[#C8941A] mt-0.5 flex-shrink-0" size={20} />
            <div className="flex-1">
              <h2 className="text-[14px] font-medium text-[#3D2314] mb-1">
                Armazenamento XML/PDF · 11 anos (SINIEF)
              </h2>
              <p className="text-[12px] text-[#3D2314]/70 mb-3">
                Arquivos guardados em bucket privado · compliance Receita Federal.
              </p>
              <div className="grid grid-cols-3 gap-4 text-[12px]">
                <Metric label="NFSes armazenadas" value={String(storage.nfse_armazenadas ?? 0)} />
                <Metric label="NFes armazenadas" value={String(storage.nfe_armazenadas ?? 0)} />
                <Metric
                  label="Fila pendente"
                  value={String(storage.pendentes_fila ?? 0)}
                  highlight={(storage.pendentes_fila ?? 0) > 0}
                />
              </div>
            </div>
          </div>
        </div>

        {!focusOk && (
          <div className="bg-[#FAEEDA] border border-[#E8C387] rounded-xl p-4 text-[12.5px] text-[#633806]">
            <strong className="font-medium">Sistema pronto pra emitir notas.</strong>{' '}
            Falta configurar o certificado A1 e a API key Focus NFe em{' '}
            <Link href="/dashboard/configuracoes/fiscal" className="text-[#BA7517] underline font-medium">
              Configurações › Fiscal
            </Link>
            .
          </div>
        )}
      </div>
    </div>
  )
}

interface CardProps {
  href: string
  testId: string
  icon: React.ReactNode
  label: string
  valor: string
  sufixo?: string
  sub?: string
  pill?: { color: 'amber' | 'red'; text: string } | null
}
function Card({ href, testId, icon, label, valor, sufixo, sub, pill }: CardProps) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="bg-white border border-[#3D2314]/10 rounded-xl p-5 hover:border-[#C8941A]/45 transition-colors block"
    >
      <div className="flex items-start justify-between mb-3">
        {icon}
        <span className="text-[10px] text-[#3D2314]/55 flex items-center gap-1">
          VER <ArrowRight size={11} />
        </span>
      </div>
      <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium mb-1">
        {label}
      </div>
      <div className="text-[28px] font-medium text-[#3D2314] leading-none mb-1.5">
        {valor}
        {sufixo && <span className="text-[12px] text-[#3D2314]/60 font-normal ml-1.5">{sufixo}</span>}
      </div>
      {sub && <div className="text-[12px] text-[#3D2314]/70">{sub}</div>}
      {pill && (
        <div
          className={`mt-2 inline-block text-[10.5px] px-2 py-0.5 rounded ${
            pill.color === 'amber'
              ? 'text-[#633806] bg-[#FAEEDA] border border-[#E8C387]'
              : 'text-[#791F1F] bg-[#FCEBEB] border border-[#E8A6A5]'
          }`}
        >
          {pill.text}
        </div>
      )}
    </Link>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium">{label}</div>
      <div className={`text-[20px] font-medium ${highlight ? 'text-[#633806]' : 'text-[#3D2314]'}`}>
        {value}
      </div>
    </div>
  )
}
