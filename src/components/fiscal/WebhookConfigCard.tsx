'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Copy, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Zap } from 'lucide-react'
import { authFetch } from '@/lib/authFetch'

interface Props {
  companyId: string
  habilitado: boolean
}

interface WebhookConfig {
  webhookUrl: string
  webhookSecret: string | null
}

interface ConfigResultado {
  ok: boolean
  mensagem?: string
  webhookId?: string | null
  ambiente?: string
}

export default function WebhookConfigCard({ companyId, habilitado }: Props) {
  const [config, setConfig] = useState<WebhookConfig | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [configurando, setConfigurando] = useState(false)
  const [resultado, setResultado] = useState<ConfigResultado | null>(null)
  const [copiado, setCopiado] = useState(false)

  const carregar = useCallback(async () => {
    if (!habilitado) {
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      const resp = await authFetch(
        `/api/fiscal/webhook-config?companyId=${encodeURIComponent(companyId)}`
      )
      const json = await resp.json()
      if (!resp.ok || !json.ok) {
        setErro(json.mensagem ?? 'Erro ao carregar config webhook')
      } else {
        setConfig({ webhookUrl: json.webhookUrl, webhookSecret: json.webhookSecret })
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setCarregando(false)
    }
  }, [companyId, habilitado])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function copiarUrl() {
    if (!config?.webhookUrl) return
    try {
      await navigator.clipboard.writeText(config.webhookUrl)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // ignora
    }
  }

  async function configurarAuto() {
    setConfigurando(true)
    setResultado(null)
    try {
      const resp = await authFetch('/api/fiscal/webhook-config', {
        method: 'POST',
        body: JSON.stringify({ companyId }),
      })
      const json = (await resp.json()) as ConfigResultado
      setResultado({
        ok: !!json.ok,
        mensagem: json.mensagem,
        webhookId: json.webhookId ?? null,
        ambiente: json.ambiente,
      })
    } catch (e) {
      setResultado({ ok: false, mensagem: e instanceof Error ? e.message : 'Erro' })
    } finally {
      setConfigurando(false)
    }
  }

  return (
    <div className={`bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden ${!habilitado ? 'opacity-60' : ''}`}>
      <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between">
        <div>
          <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">Passo 3</div>
          <h2 className="text-[15px] font-medium text-[#3D2314] flex items-center gap-1.5">
            <Bell size={14} className="text-[#C8941A]" />
            Notificacoes Automaticas
          </h2>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-[12.5px] text-[#3D2314]/70 leading-relaxed">
          Configure no Focus NFe pra receber atualizacoes automaticas quando uma nota mudar de
          status. Sem isso, voce precisa atualizar manualmente.
        </p>

        {!habilitado && (
          <div className="flex items-start gap-2 text-[12.5px] text-[#633806] bg-[#FAEEDA] p-3 rounded-lg">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Complete os passos 1 e 2 (certificado + API key) primeiro</span>
          </div>
        )}

        {habilitado && carregando && (
          <div className="flex items-center gap-2 text-[12px] text-[#3D2314]/60 py-2">
            <Loader2 size={14} className="animate-spin" /> Carregando...
          </div>
        )}

        {habilitado && erro && (
          <div className="flex items-start gap-2 text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2.5 rounded-lg">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        {habilitado && !carregando && config && (
          <>
            <div>
              <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                URL do webhook (copie pro Focus NFe)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={config.webhookUrl}
                  className="flex-1 px-3 py-2 text-[12px] font-mono border border-[#3D2314]/15 rounded-lg bg-[#3D2314]/5 text-[#3D2314]"
                />
                <button
                  type="button"
                  onClick={copiarUrl}
                  data-testid="webhook-copy-url"
                  className="px-3 py-2 text-[12px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2] hover:bg-[#5A3522] flex items-center gap-1.5"
                >
                  {copiado ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                Secret (valida assinatura HMAC do webhook)
              </label>
              <div className="flex gap-2">
                <input
                  type={showSecret ? 'text' : 'password'}
                  readOnly
                  value={config.webhookSecret ?? '—'}
                  className="flex-1 px-3 py-2 text-[12px] font-mono border border-[#3D2314]/15 rounded-lg bg-[#3D2314]/5 text-[#3D2314]"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="px-3 py-2 text-[12px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 flex items-center gap-1.5"
                >
                  {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showSecret ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={configurarAuto}
                disabled={configurando}
                data-testid="webhook-configurar-auto"
                className="px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {configurando ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                Configurar automaticamente no Focus NFe
              </button>
            </div>

            {resultado && (
              <div
                className={`flex items-start gap-2 text-[12px] p-2.5 rounded-lg ${
                  resultado.ok
                    ? 'bg-[#E8F4DC] text-[#1B3608] border border-[#C0DD97]'
                    : 'bg-[#FCEBEB] text-[#791F1F] border border-[#E8A6A5]'
                }`}
              >
                {resultado.ok ? (
                  <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                )}
                <div>
                  {resultado.ok ? (
                    <>
                      Webhook configurado
                      {resultado.webhookId && (
                        <span className="font-mono ml-1">· ID {resultado.webhookId}</span>
                      )}
                      {resultado.ambiente && (
                        <span className="ml-1 text-[11px] opacity-80">({resultado.ambiente})</span>
                      )}
                    </>
                  ) : (
                    resultado.mensagem
                  )}
                </div>
              </div>
            )}

            <details className="text-[12px] text-[#3D2314]/70">
              <summary className="cursor-pointer hover:text-[#3D2314] py-1">
                Prefere configurar manualmente no painel Focus NFe?
              </summary>
              <div className="mt-2 p-3 bg-[#3D2314]/5 rounded-lg text-[11.5px] leading-relaxed space-y-1">
                <p>
                  <strong>1.</strong> Acesse{' '}
                  <a
                    href="https://app.focusnfe.com.br"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#BA7517] underline"
                  >
                    app.focusnfe.com.br
                  </a>
                </p>
                <p>
                  <strong>2.</strong> Menu Empresa → Webhooks
                </p>
                <p>
                  <strong>3.</strong> Adicione novo webhook com a URL acima
                </p>
                <p>
                  <strong>4.</strong> Eventos: NFe Status, NFSe Status, MDe Disponivel
                </p>
                <p>
                  <strong>5.</strong> Salve
                </p>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
