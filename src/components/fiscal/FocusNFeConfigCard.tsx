'use client'

import { useEffect, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { Loader2, Save, AlertCircle, CheckCircle2, Landmark, Radio } from 'lucide-react'
import { verificarMunicipioAderido, type GovNFSeMunicipioStatus } from '@/lib/fiscal/gov-nfse-provider'

type Ambiente = 'homologacao' | 'producao'
type Regime = 'simples_nacional' | 'simples_nacional_excesso' | 'regime_normal' | 'mei'
type Provider = 'gov_nfse_nacional' | 'focusnfe'

interface Props {
  companyId: string
  configAtual: Record<string, unknown> | null
  certificadoOk: boolean
  onAtualizado: () => void
}

export default function FocusNFeConfigCard({ companyId, configAtual, certificadoOk, onAtualizado }: Props) {
  const [provider, setProvider] = useState<Provider>('gov_nfse_nacional')
  const [municipioIbge, setMunicipioIbge] = useState('')
  const [municipioStatus, setMunicipioStatus] = useState<GovNFSeMunicipioStatus | null>(null)
  const [verificandoMunicipio, setVerificandoMunicipio] = useState(false)
  const [municipioErro, setMunicipioErro] = useState<string | null>(null)

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
    setProvider(((c.provider as Provider) ?? 'gov_nfse_nacional'))
    setMunicipioIbge(((c.gov_nfse_municipio_codigo as string) ?? ''))
    setAmbiente(((c.ambiente as Ambiente) ?? 'homologacao'))
    setSerieNfse(String(c.serie_nfse_padrao ?? '1'))
    setProxNumNfse(String(c.proxima_numeracao_nfse ?? '1'))
    setSerieNfe(String(c.serie_nfe_padrao ?? '1'))
    setProxNumNfe(String(c.proxima_numeracao_nfe ?? '1'))
    setCnaePadrao((c.cnae_padrao as string) ?? '')
    setRegime(((c.regime_tributario as Regime) ?? 'simples_nacional'))
  }, [configAtual])

  async function verificarAdesao() {
    setMunicipioStatus(null)
    setMunicipioErro(null)
    const codigo = municipioIbge.replace(/\D/g, '')
    if (codigo.length !== 7) {
      setMunicipioErro('Código IBGE deve ter 7 dígitos')
      return
    }
    setVerificandoMunicipio(true)
    try {
      const res = await verificarMunicipioAderido(codigo)
      setMunicipioStatus(res)
    } catch (e) {
      setMunicipioErro(e instanceof Error ? e.message : 'Erro ao consultar')
    } finally {
      setVerificandoMunicipio(false)
    }
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    setSucesso(false)
    try {
      const payload: Record<string, unknown> = {
        companyId,
        provider,
        ambiente,
        serieNfsePadrao: serieNfse,
        proximaNumeracaoNfse: parseInt(proxNumNfse, 10) || 1,
        serieNfePadrao: serieNfe,
        proximaNumeracaoNfe: parseInt(proxNumNfe, 10) || 1,
        cnaePadrao: cnaePadrao || null,
        regimeTributario: regime,
      }
      if (provider === 'gov_nfse_nacional') {
        const codigo = municipioIbge.replace(/\D/g, '')
        if (codigo.length !== 7) throw new Error('Código IBGE do município (7 dígitos) obrigatório')
        payload.govNfseMunicipioCodigo = codigo
        payload.govNfseMunicipioAderido = municipioStatus?.aderido ?? false
      } else if (apiKey.trim()) {
        payload.apiKey = apiKey.trim()
      }

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
          <h2 className="text-[15px] font-medium text-[#3D2314]">Provider NFSe</h2>
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
          <label className="text-[12px] font-medium text-[#3D2314] block mb-2">
            Tipo de emissão NFSe
          </label>
          <div className="grid grid-cols-1 gap-2">
            <label
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                provider === 'gov_nfse_nacional'
                  ? 'border-[#C8941A]/45 bg-[#C8941A]/8'
                  : 'border-[#3D2314]/15 hover:bg-[#3D2314]/3'
              } ${!podeEditar ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="provider"
                value="gov_nfse_nacional"
                checked={provider === 'gov_nfse_nacional'}
                onChange={() => setProvider('gov_nfse_nacional')}
                disabled={!podeEditar}
                className="mt-1 accent-[#C8941A]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[#3D2314] flex items-center gap-1.5">
                  <Landmark size={13} className="text-[#C8941A] flex-shrink-0" />
                  NFSe Nacional gov.br <span className="text-[10px] uppercase tracking-wider bg-[#C0DD97] text-[#173404] px-1.5 py-0.5 rounded">Recomendado</span>
                </div>
                <div className="text-[12px] text-[#3D2314]/75 mt-1">
                  Sistema oficial Receita Federal · GRÁTIS · obrigatório a partir de SET/2026 pra Simples Nacional.
                </div>
                <div className="text-[11px] text-[#1B3608] mt-1">
                  Sem custo recorrente · 5.500+ municípios · padrão único nacional
                </div>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                provider === 'focusnfe'
                  ? 'border-[#C8941A]/45 bg-[#C8941A]/8'
                  : 'border-[#3D2314]/15 hover:bg-[#3D2314]/3'
              } ${!podeEditar ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="provider"
                value="focusnfe"
                checked={provider === 'focusnfe'}
                onChange={() => setProvider('focusnfe')}
                disabled={!podeEditar}
                className="mt-1 accent-[#C8941A]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[#3D2314] flex items-center gap-1.5">
                  <Radio size={13} className="text-[#C8941A] flex-shrink-0" />
                  Focus NFe (alternativo)
                </div>
                <div className="text-[12px] text-[#3D2314]/75 mt-1">
                  Provider terceirizado · R$ 89-548/mês · útil pra prefeituras que ainda não aderiram ao NFSe Nacional.
                </div>
              </div>
            </label>
          </div>
        </div>

        {provider === 'gov_nfse_nacional' && (
          <div>
            <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
              Código IBGE do município emissor (7 dígitos)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={municipioIbge}
                onChange={(e) => { setMunicipioIbge(e.target.value); setMunicipioStatus(null); setMunicipioErro(null) }}
                disabled={!podeEditar}
                placeholder="Ex: 4216701 (São Miguel do Oeste/SC)"
                maxLength={7}
                className="flex-1 px-3 py-2 text-[13px] font-mono border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 disabled:bg-[#3D2314]/5"
              />
              <button
                type="button"
                onClick={verificarAdesao}
                disabled={!podeEditar || verificandoMunicipio || municipioIbge.replace(/\D/g, '').length !== 7}
                data-testid="gov-nfse-verificar-municipio"
                className="px-3 py-2 text-[12px] font-medium rounded-lg border border-[#C8941A]/45 text-[#633806] bg-[#C8941A]/10 hover:bg-[#C8941A]/15 disabled:opacity-40 flex items-center gap-1.5"
              >
                {verificandoMunicipio ? <Loader2 size={13} className="animate-spin" /> : null}
                Verificar adesão
              </button>
            </div>
            {municipioErro && (
              <div className="mt-2 text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2 rounded">{municipioErro}</div>
            )}
            {municipioStatus && (
              <div
                className={`mt-2 flex items-start gap-2 text-[12px] p-2.5 rounded-lg border ${
                  municipioStatus.aderido
                    ? 'bg-[#E8F4DC] text-[#1B3608] border-[#C0DD97]'
                    : 'bg-[#FAEEDA] text-[#633806] border-[#E8C387]'
                }`}
              >
                {municipioStatus.aderido ? (
                  <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                )}
                <div>
                  {municipioStatus.aderido ? (
                    <>
                      <strong>{municipioStatus.nome ?? 'Município'}/{municipioStatus.uf ?? '—'}</strong> aderiu ao SN NFS-e
                      {municipioStatus.data_adesao && (
                        <span className="ml-1 opacity-75">
                          (desde {new Date(municipioStatus.data_adesao).toLocaleDateString('pt-BR')})
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <strong>{municipioStatus.nome ?? 'Município'}</strong> ainda não aderiu ao SN NFS-e · considere Focus NFe
                    </>
                  )}
                </div>
              </div>
            )}
            <p className="text-[11px] text-[#3D2314]/55 mt-1.5">
              Consulta o cache local de municípios aderidos · sincronizado periodicamente via gov.br.
            </p>
          </div>
        )}

        {provider === 'focusnfe' && (
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
        )}

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
