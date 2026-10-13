'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Copy, Loader2, AlertCircle, CheckCircle2, Zap } from 'lucide-react'
import { authFetch } from '@/lib/authFetch'

interface Props {
  companyId: string
  habilitado: boolean
}

interface WebhookConfig {
  webhookUrl: string
  authorizationHeader: string
  webhookAtivo: boolean
}

interface EventoResultado { evento: string; acao: string; ok: boolean; id: string | null; erro?: string }
interface ConfigResultado {
  ok: boolean
  mensagem?: string
  eventos?: EventoResultado[]
  ambiente?: string
}

export default function WebhookConfigCard({ companyId, habilitado }: Props) {
  const [config, setConfig] = useState<WebhookConfig | null>(null)
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
        setConfig({ webhookUrl: json.webhookUrl, authorizationHeader: json.authorizationHeader ?? 'X-PS-Webhook-Token', webhookAtivo: !!json.webhookAtivo })
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
      setResultado({ ok: !!json.ok, mensagem: json.mensagem, eventos: json.eventos, ambiente: json.ambiente })
      await carregar() // reflete o aviso automático ativo/inativo
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
            Notificações Automáticas
          </h2>
        </div>
        {habilitado && !carregando && config && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            config.webhookAtivo
              ? 'bg-[#E8F4DC] text-[#1B3608] border border-[#C0DD97]'
              : 'bg-[#FAEEDA] text-[#633806] border border-[#E8C387]'
          }`}>
            {config.webhookAtivo ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            Aviso automático: {config.webhookAtivo ? 'ativo' : 'inativo'}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        <p className="text-[12.5px] text-[#3D2314]/70 leading-relaxed">
          Com o aviso automático ativo, a Focus NFe avisa o sistema assim que uma nota muda de status
          (autorizada/recusada) e a atualização acontece sozinha. Sem ele, é preciso usar “Consultar na
          prefeitura” manualmente.
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
                URL do webhook (a Focus chama esta URL)
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
              <p className="text-[11px] text-[#3D2314]/55 mt-1.5">
                A validação é por token no cabeçalho <code className="font-mono">{config.authorizationHeader}</code>,
                gerado e guardado no servidor — não é exibido aqui por segurança.
              </p>
            </div>

            <div className="pt-1 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={configurarAuto}
                disabled={configurando}
                data-testid="webhook-configurar-auto"
                className="px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {configurando ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                {config.webhookAtivo ? 'Reconfigurar aviso automático' : 'Ativar aviso automático na Focus NFe'}
              </button>
            </div>

            {resultado && (
              <div
                className={`text-[12px] p-2.5 rounded-lg ${
                  resultado.ok
                    ? 'bg-[#E8F4DC] text-[#1B3608] border border-[#C0DD97]'
                    : 'bg-[#FCEBEB] text-[#791F1F] border border-[#E8A6A5]'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {resultado.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {resultado.ok ? 'Aviso automático configurado' : (resultado.mensagem ?? 'Falha ao configurar')}
                  {resultado.ambiente && <span className="text-[11px] opacity-80">({resultado.ambiente})</span>}
                </div>
                {resultado.eventos && resultado.eventos.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {resultado.eventos.map((ev) => (
                      <li key={ev.evento} className="flex items-center gap-1.5">
                        {ev.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                        <span className="font-mono">{ev.evento}</span>
                        <span className="opacity-80">— {ev.ok ? ev.acao : (ev.erro ?? 'falha')}</span>
                        {ev.id && <span className="font-mono opacity-60">· {ev.id}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
