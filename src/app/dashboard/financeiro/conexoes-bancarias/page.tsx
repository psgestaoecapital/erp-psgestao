'use client'

// FEAT-PLUGGY-CONCILIACAO-FASE1-v1 · Conexoes bancarias via Pluggy.
// Lista itens financeiros, conecta novo banco (consentimento +
// connect-token + widget), atualiza on-demand.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { PluggyWidgetWrapper } from '@/components/wealth/pluggy-widget-wrapper'
import { ArrowLeft, Plus, RefreshCw, Loader2, AlertCircle, CheckCircle2, Banknote } from 'lucide-react'

interface PluggyItem {
  id: string
  pluggy_item_id: string
  connector_name: string | null
  connector_type: string | null
  connector_image_url: string | null
  status: string
  ultimo_sync_em: string | null
  ultimo_erro_msg: string | null
  metadata: Record<string, unknown> | null
}

interface ConnectTokenResp {
  connect_token?: string
  company_nome?: string
  consent_id?: string | null
  error?: string
}

const TEXTO_CONSENTIMENTO_V1 = `Autorizo a conexão da minha conta bancária via Pluggy (Open Finance) pra leitura
de transações e saldos, com finalidade de conciliação bancária no PS Gestão ERP.
Posso revogar a qualquer momento na tela de conexões.`

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return '—' }
}

const STATUS_COR: Record<string, string> = {
  UPDATED: 'bg-[#EAF3DE] text-[#3B6D11]',
  UPDATING: 'bg-[#FAEEDA] text-[#BA7517]',
  LOGIN_IN_PROGRESS: 'bg-[#FAEEDA] text-[#BA7517]',
  WAITING_USER_INPUT: 'bg-[#FAEEDA] text-[#BA7517]',
  OUTDATED: 'bg-[#3D2314]/10 text-[#3D2314]/70',
  LOGIN_ERROR: 'bg-[#FCEBEB] text-[#791F1F]',
  REVOKED: 'bg-[#3D2314]/10 text-[#3D2314]/50',
  DELETED: 'bg-[#3D2314]/10 text-[#3D2314]/50',
}

export default function ConexoesBancariasPage() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  const [itens, setItens] = useState<PluggyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [conectando, setConectando] = useState(false)
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [consentId, setConsentId] = useState<string | null>(null)
  const [aceitando, setAceitando] = useState(false)
  const [showConsent, setShowConsent] = useState(false)
  const [aceito, setAceito] = useState(false)
  const [acaoItem, setAcaoItem] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase
      .from('wealth_pluggy_items')
      .select('id, pluggy_item_id, connector_name, connector_type, connector_image_url, status, ultimo_sync_em, ultimo_erro_msg, metadata')
      .eq('company_id', empresaUnica)
      .filter('metadata->>contexto', 'eq', 'financeiro')
      .order('created_at', { ascending: false })
    if (error) setErro(error.message)
    else setItens((data ?? []) as PluggyItem[])
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { carregar() }, [carregar])

  async function aceitarConsentimentoEConectar() {
    if (!empresaUnica) return
    setAceitando(true)
    setErro(null)
    try {
      // 1. Registra consentimento (RPC SECURITY DEFINER)
      const { data: cId, error: cErr } = await supabase.rpc('sp_pluggy_consent_financeiro_aceitar', {
        p_company_id: empresaUnica,
        p_texto_versao: 'pluggy-financeiro-v1',
        p_texto_md5: null,
        p_ip: null,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      if (cErr) throw new Error(cErr.message)
      setConsentId(cId as string)

      // 2. Pede connect_token
      const { data: tokenResp, error: tErr } = await supabase.functions.invoke<ConnectTokenResp>(
        'pluggy-connect-token-financeiro',
        { body: { company_id: empresaUnica, consent_id: cId } },
      )
      if (tErr) throw new Error(tErr.message)
      if (!tokenResp?.connect_token) throw new Error(tokenResp?.error ?? 'Sem connect_token')

      setConnectToken(tokenResp.connect_token)
      setShowConsent(false)
      setConectando(true)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao iniciar conexão')
    } finally {
      setAceitando(false)
    }
  }

  async function onWidgetSuccess(data: { item: { id: string; connector: { id: number; name: string; type?: string } } }) {
    if (!empresaUnica) return
    try {
      // 3. Registra item no DB (client_id NULL, metadata.contexto=financeiro)
      const { data: itemUuid, error: rErr } = await supabase.rpc('sp_pluggy_register_item_financeiro', {
        p_company_id: empresaUnica,
        p_pluggy_item_id: data.item.id,
        p_connector_id: data.item.connector.id,
        p_connector_name: data.item.connector.name,
        p_connector_type: data.item.connector.type ?? 'PERSONAL_BANK',
        p_connector_image_url: null,
        p_consent_id: consentId,
      })
      if (rErr) throw new Error(rErr.message)

      // 4. Dispara sync (reusa o pipeline wealth)
      await supabase.rpc('sp_pluggy_dispatch_sync', {
        p_item_id: itemUuid,
        p_origem: 'item_created',
      })

      setConnectToken(null)
      setConectando(false)
      setConsentId(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao registrar item')
    }
  }

  function onWidgetClose() {
    setConnectToken(null)
    setConectando(false)
  }

  async function atualizarAgora(itemId: string) {
    setAcaoItem(itemId)
    try {
      const { error } = await supabase.rpc('sp_pluggy_dispatch_sync', {
        p_item_id: itemId,
        p_origem: 'cliente_refresh',
      })
      if (error) throw new Error(error.message)
      await carregar()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao atualizar')
    } finally {
      setAcaoItem(null)
    }
  }

  async function promoverAgora(itemId: string) {
    setAcaoItem(itemId + '-promover')
    try {
      const { data, error } = await supabase.rpc('sp_pluggy_promover_para_conciliacao', {
        p_item_id: itemId,
      })
      if (error) throw new Error(error.message)
      const r = data as { ok?: boolean; erro?: string; qtd_movimentos_inseridos?: number; qtd_movimentos_ja_existiam?: number; qtd_contas_bank?: number } | null
      if (r && r.ok === false) throw new Error(r.erro ?? 'Falha')
      alert(`Promovidos · ${r?.qtd_contas_bank ?? 0} contas BANK · ${r?.qtd_movimentos_inseridos ?? 0} novos · ${r?.qtd_movimentos_ja_existiam ?? 0} ja existiam.`)
      await carregar()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao promover')
    } finally {
      setAcaoItem(null)
    }
  }

  if (!empresaUnica) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] px-4 py-6">
        <div className="max-w-3xl mx-auto text-[13px] text-[#3D2314]/70">
          Selecione uma empresa específica no trocador da TopNav.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <Link
          href="/dashboard/financeiro/conciliacao/inbox"
          className="inline-flex items-center gap-1.5 text-[12px] text-[#BA7517] hover:text-[#8B5612] mb-3"
        >
          <ArrowLeft size={13} /> Voltar para conciliação
        </Link>

        <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight">
              Conexões bancárias
            </h1>
            <p className="text-[13px] text-[#3D2314]/70 mt-1">
              Open Finance via Pluggy · transações entram na conciliação automaticamente
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setAceito(false); setShowConsent(true) }}
            data-testid="pluggy-conectar-banco"
            className="inline-flex items-center gap-2 bg-[#C8941A] hover:bg-[#B07F12] text-[#3D2314] font-medium text-[13px] px-4 py-2.5 rounded-md shadow-sm"
          >
            <Plus size={14} /> Conectar banco
          </button>
        </header>

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
          ) : itens.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[#3D2314]/60 px-6">
              <Banknote size={28} className="mx-auto mb-2 text-[#3D2314]/30" />
              <div>Nenhum banco conectado ainda.</div>
              <div className="text-[12px] mt-1">Clique em "Conectar banco" pra começar.</div>
            </div>
          ) : (
            <ul className="divide-y divide-[#3D2314]/8">
              {itens.map((it) => (
                <li key={it.id} className="px-4 py-4 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[14px] text-[#3D2314]">
                      {it.connector_name ?? 'Banco'}
                    </div>
                    <div className="text-[11.5px] text-[#3D2314]/60 mt-0.5">
                      Último sync: {fmtData(it.ultimo_sync_em)}
                    </div>
                    {it.ultimo_erro_msg && (
                      <div className="text-[11.5px] text-[#791F1F] mt-1">⚠ {it.ultimo_erro_msg}</div>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded ${STATUS_COR[it.status] ?? 'bg-[#3D2314]/10 text-[#3D2314]/70'}`}>
                    {it.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => atualizarAgora(it.id)}
                    disabled={acaoItem === it.id}
                    className="inline-flex items-center gap-1.5 text-[12px] border border-[#3D2314]/15 hover:bg-[#3D2314]/5 px-3 py-1.5 rounded-md disabled:opacity-50"
                  >
                    {acaoItem === it.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Atualizar
                  </button>
                  <button
                    type="button"
                    onClick={() => promoverAgora(it.id)}
                    disabled={acaoItem === it.id + '-promover'}
                    title="Lê o último sync e grava movimentos na conciliação"
                    className="inline-flex items-center gap-1.5 text-[12px] bg-[#3D2314] hover:bg-[#2A1810] text-[#FAF7F2] px-3 py-1.5 rounded-md disabled:opacity-50"
                  >
                    {acaoItem === it.id + '-promover' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Promover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showConsent && (
          <div
            role="dialog"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4 py-0 sm:py-6"
            onClick={(e) => { if (e.target === e.currentTarget && !aceitando) setShowConsent(false) }}
          >
            <div className="w-full sm:max-w-md bg-[#FAF7F2] sm:rounded-xl shadow-xl">
              <div className="px-5 py-4 border-b border-[#3D2314]/10">
                <h2 className="text-[16px] font-medium text-[#3D2314]">Conectar via Pluggy</h2>
                <p className="text-[12px] text-[#3D2314]/65 mt-1">
                  Open Finance · você precisa aceitar pra continuar.
                </p>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="bg-white border border-[#3D2314]/10 rounded-md p-3 text-[12.5px] text-[#3D2314] leading-relaxed whitespace-pre-wrap">
                  {TEXTO_CONSENTIMENTO_V1}
                </div>
                <label className="flex items-start gap-2 text-[13px] text-[#3D2314] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aceito}
                    onChange={(e) => setAceito(e.target.checked)}
                    className="mt-1"
                  />
                  <span>Li e aceito os termos de consentimento</span>
                </label>
              </div>
              <div className="px-5 py-4 border-t border-[#3D2314]/10 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowConsent(false)}
                  disabled={aceitando}
                  className="flex-1 px-4 py-2 rounded-md border border-[#3D2314]/15 text-[#3D2314] text-[13px] hover:bg-[#3D2314]/5 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={aceitarConsentimentoEConectar}
                  disabled={!aceito || aceitando}
                  data-testid="pluggy-aceitar-conectar"
                  className="flex-1 px-4 py-2 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {aceitando ? <Loader2 size={13} className="animate-spin" /> : null}
                  Aceitar e conectar
                </button>
              </div>
            </div>
          </div>
        )}

        {conectando && connectToken && (
          <PluggyWidgetWrapper
            connectToken={connectToken}
            onSuccess={onWidgetSuccess}
            onError={(e) => setErro(e instanceof Error ? e.message : 'Falha widget')}
            onClose={onWidgetClose}
          />
        )}
      </div>
    </div>
  )
}
