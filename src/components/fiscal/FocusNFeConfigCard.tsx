'use client'

import { useEffect, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { Loader2, Save, AlertCircle } from 'lucide-react'

type Ambiente = 'homologacao' | 'producao'
type Regime = 'simples_nacional' | 'simples_nacional_excesso' | 'regime_normal' | 'mei'

interface Props {
  companyId: string
  configAtual: Record<string, unknown> | null
  certificadoOk: boolean
  onAtualizado: () => void
}

export default function FocusNFeConfigCard({ companyId, configAtual, certificadoOk, onAtualizado }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [ambiente, setAmbiente] = useState<Ambiente>('homologacao')
  const [serieNfse, setSerieNfse] = useState('1')
  const [proxNumNfse, setProxNumNfse] = useState('1')
  const [serieNfe, setSerieNfe] = useState('1')
  const [proxNumNfe, setProxNumNfe] = useState('1')
  const [cnaePadrao, setCnaePadrao] = useState('')
  const [regime, setRegime] = useState<Regime>('simples_nacional')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)

  useEffect(() => {
    if (!configAtual) return
    const c = configAtual as Record<string, unknown>
    setAmbiente(((c.ambiente as Ambiente) ?? 'homologacao'))
    setSerieNfse(String(c.serie_nfse_padrao ?? '1'))
    setProxNumNfse(String(c.proxima_numeracao_nfse ?? '1'))
    setSerieNfe(String(c.serie_nfe_padrao ?? '1'))
    setProxNumNfe(String(c.proxima_numeracao_nfe ?? '1'))
    setCnaePadrao((c.cnae_padrao as string) ?? '')
    setRegime(((c.regime_tributario as Regime) ?? 'simples_nacional'))
  }, [configAtual])

  async function salvar() {
    setSalvando(true)
    setErro(null)
    setSucesso(false)
    try {
      const payload: Record<string, unknown> = {
        companyId,
        ambiente,
        serieNfsePadrao: serieNfse,
        proximaNumeracaoNfse: parseInt(proxNumNfse, 10) || 1,
        serieNfePadrao: serieNfe,
        proximaNumeracaoNfe: parseInt(proxNumNfe, 10) || 1,
        cnaePadrao: cnaePadrao || null,
        regimeTributario: regime,
      }
      if (apiKey.trim()) payload.apiKey = apiKey.trim()

      const resp = await authFetch('/api/fiscal/provider-config', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.erro ?? 'Erro ao salvar')

      setApiKey('')
      setSucesso(true)
      onAtualizado()
      setTimeout(() => setSucesso(false), 3000)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const podeEditar = certificadoOk

  return (
    <div className={`bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden ${!podeEditar ? 'opacity-60' : ''}`}>
      <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between">
        <div>
          <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">Passo 2</div>
          <h2 className="text-[15px] font-medium text-[#3D2314]">Focus NFe</h2>
        </div>
        {configAtual && (
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium tracking-[0.3px] ${
            ambiente === 'producao' ? 'bg-[#C0DD97] text-[#173404]' : 'bg-[#FAEEDA] text-[#633806]'
          }`}>
            {ambiente === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!podeEditar && (
          <div className="flex items-start gap-2 text-[12.5px] text-[#633806] bg-[#FAEEDA] p-3 rounded-lg">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Suba o certificado A1 primeiro (Passo 1)</span>
          </div>
        )}

        <div>
          <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
            API Key Focus NFe{' '}
            {configAtual && <span className="text-[#3D2314]/50 font-normal">(deixe vazio para manter a atual)</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={!podeEditar}
            placeholder={configAtual ? '••••••••••••••••' : 'Token gerado em focusnfe.com.br'}
            className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 focus:border-[#C8941A]/40 font-mono disabled:bg-[#3D2314]/5"
          />
        </div>

        <div>
          <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Ambiente</label>
          <div className="grid grid-cols-2 gap-2">
            {(['homologacao', 'producao'] as const).map((amb) => (
              <button
                key={amb}
                type="button"
                disabled={!podeEditar}
                onClick={() => setAmbiente(amb)}
                className={`px-3 py-2.5 text-[12.5px] font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                  ambiente === amb
                    ? 'bg-[#C8941A]/10 border-[#C8941A]/45 text-[#633806]'
                    : 'bg-white border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5'
                }`}
              >
                {amb === 'homologacao' ? 'Homologação' : 'Produção'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Série NFSe</label>
            <input type="text" value={serieNfse} onChange={(e) => setSerieNfse(e.target.value)} disabled={!podeEditar}
              className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Próximo nº NFSe</label>
            <input type="number" min={1} value={proxNumNfse} onChange={(e) => setProxNumNfse(e.target.value)} disabled={!podeEditar}
              className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Série NFe</label>
            <input type="text" value={serieNfe} onChange={(e) => setSerieNfe(e.target.value)} disabled={!podeEditar}
              className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Próximo nº NFe</label>
            <input type="number" min={1} value={proxNumNfe} onChange={(e) => setProxNumNfe(e.target.value)} disabled={!podeEditar}
              className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5" />
          </div>
        </div>

        <div>
          <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">Regime Tributário</label>
          <select value={regime} onChange={(e) => setRegime(e.target.value as Regime)} disabled={!podeEditar}
            className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5 bg-white">
            <option value="simples_nacional">Simples Nacional</option>
            <option value="simples_nacional_excesso">Simples Nacional · excesso de sublimite</option>
            <option value="regime_normal">Regime Normal (Lucro Real / Presumido)</option>
            <option value="mei">MEI</option>
          </select>
        </div>

        <div>
          <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">CNAE padrão (opcional)</label>
          <input type="text" value={cnaePadrao} onChange={(e) => setCnaePadrao(e.target.value)} disabled={!podeEditar}
            placeholder="Ex: 6920-6/01"
            className="block w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5" />
        </div>

        {erro && <div className="text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2.5 rounded-lg">{erro}</div>}
        {sucesso && <div className="text-[12px] text-[#1B3608] bg-[#E8F4DC] p-2.5 rounded-lg">Configuração salva</div>}

        <button
          type="button"
          disabled={!podeEditar || salvando}
          onClick={salvar}
          data-testid="focus-config-salvar"
          className="w-full sm:w-auto px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Salvar configuração
        </button>
      </div>
    </div>
  )
}
