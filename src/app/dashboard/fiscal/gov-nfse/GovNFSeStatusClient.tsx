'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import {
  ArrowLeft, Landmark, Loader2, AlertCircle, RefreshCw, MapPin, FileText, CheckCircle2, RotateCw,
} from 'lucide-react'

// DPS pendente: espelha exatamente a view v_gov_nfse_dps_pendentes (Fase 1 — diagnóstico).
interface DPSPendente {
  id: string
  company_id: string | null
  nfse_emitida_id: string | null
  numero_dps: number | null
  chave_acesso: string | null
  status_gov: string | null
  enviado_em: string | null
  minutos_aguardando: number | null
}

interface MunicipioAderido {
  codigo_ibge: string
  nome_municipio: string | null
  uf: string | null
  aderido: boolean | null
  data_adesao: string | null
}

interface SyncResultado {
  ok?: boolean
  total?: number
  atualizados?: number
  erro?: string
}

const ROTA = '/dashboard/fiscal/gov-nfse'

export default function GovNFSeStatusClient() {
  const [pendentes, setPendentes] = useState<DPSPendente[]>([])
  const [municipios, setMunicipios] = useState<MunicipioAderido[]>([])
  // Carregamento e erro SEPARADOS por seção: uma consulta que falha nunca
  // apaga a tela inteira nem zera o indicador da outra seção (RD-38: distinguir
  // "sem dado" de "falha ao carregar").
  const [loadingMunic, setLoadingMunic] = useState(true)
  const [loadingDps, setLoadingDps] = useState(true)
  const [erroMunic, setErroMunic] = useState<string | null>(null)
  const [erroDps, setErroDps] = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [sincResultado, setSincResultado] = useState<SyncResultado | null>(null)

  const carregarMunicipios = useCallback(async () => {
    setLoadingMunic(true)
    setErroMunic(null)
    try {
      const { data, error } = await supabase
        .from('erp_gov_nfse_municipios')
        .select('codigo_ibge, nome_municipio, uf, aderido, data_adesao')
        .eq('aderido', true)
        .order('nome_municipio')
      if (error) throw error
      setMunicipios((data ?? []) as MunicipioAderido[])
    } catch (e) {
      setErroMunic(e instanceof Error ? e.message : 'Não foi possível carregar os municípios.')
    } finally {
      setLoadingMunic(false)
    }
  }, [])

  const carregarDps = useCallback(async () => {
    setLoadingDps(true)
    setErroDps(null)
    try {
      const { data, error } = await supabase
        .from('v_gov_nfse_dps_pendentes')
        .select('id, company_id, nfse_emitida_id, numero_dps, chave_acesso, status_gov, enviado_em, minutos_aguardando')
        .order('enviado_em', { ascending: false })
        .limit(50)
      if (error) throw error
      setPendentes((data ?? []) as DPSPendente[])
    } catch (e) {
      setErroDps(e instanceof Error ? e.message : 'Não foi possível carregar as DPSes pendentes.')
    } finally {
      setLoadingDps(false)
    }
  }, [])

  const carregar = useCallback(async () => {
    await Promise.all([carregarMunicipios(), carregarDps()])
  }, [carregarMunicipios, carregarDps])

  useEffect(() => { carregar() }, [carregar])

  async function sincronizarMunicipios() {
    setSincronizando(true)
    setSincResultado(null)
    try {
      const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
      const resp = await authFetch(`${baseUrl}/functions/v1/gov-nfse-sync-municipios`, {
        method: 'POST',
      })
      const json = (await resp.json()) as SyncResultado
      setSincResultado({ ok: !!json.ok, ...json })
      if (json.ok) await carregarMunicipios()
    } catch (e) {
      setSincResultado({ ok: false, erro: e instanceof Error ? e.message : 'Erro' })
    } finally {
      setSincronizando(false)
    }
  }

  const fmtData = (iso: string | null) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('pt-BR')
    } catch {
      return '—'
    }
  }

  const fmtEspera = (min: number | null) => {
    if (min == null) return null
    const m = Math.max(0, Math.round(min))
    if (m < 60) return `há ${m} min`
    const h = Math.floor(m / 60)
    return `há ${h} h`
  }

  // Bloco de falha reutilizável, com botão "Tentar de novo" — nunca um zero silencioso.
  const BlocoErro = ({ msg, onRetry }: { msg: string; onRetry: () => void }) => (
    <div className="py-8 px-5 text-center">
      <AlertCircle className="text-[#C94544] mx-auto mb-2" size={20} />
      <div className="text-[12.5px] text-[#791F1F] mb-3">Não foi possível carregar · {msg}</div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2] hover:bg-[#5A3522]"
      >
        <RotateCw size={13} /> Tentar de novo
      </button>
    </div>
  )

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
          <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
            Gestão Empresarial · Fiscal
          </div>
          <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
            <Landmark className="text-[#C8941A]" size={22} /> NFSe Nacional gov.br
          </h1>
          <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
            Diagnóstico da emissão via Sistema Nacional NFS-e (Receita Federal). Lista DPSes
            pendentes e municípios aderidos. <strong>Fase 1</strong> · emissão real via mTLS chega na Fase 2.
          </p>
        </header>

        <div className="bg-[#FAEEDA] border border-[#E8C387] rounded-xl p-4 mb-5 text-[12.5px] text-[#633806] leading-relaxed">
          <strong className="font-medium">Status atual:</strong> sistema preparado pra registrar DPSes
          localmente. A transmissão efetiva (mTLS com certificado A1 + endpoint{' '}
          <code className="text-[11px] bg-[#3D2314]/8 px-1 rounded">sefin.nfse.gov.br/sefinnacional/dps</code>)
          será habilitada na Fase 2 (próximo PR).
        </div>

        <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-[#3D2314]/10 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium flex items-center">
                Municípios aderidos (cache local)
                <AjudaCampo chave="fiscal.gov_nfse.ind.municipios_aderidos" rota={ROTA} />
              </div>
              <div className="text-[13.5px] font-medium text-[#3D2314] mt-0.5 flex items-center gap-1.5">
                <MapPin size={13} className="text-[#C8941A]" />{' '}
                {erroMunic ? '—' : `${municipios.length} municípios`}
              </div>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={sincronizarMunicipios}
                disabled={sincronizando}
                data-testid="gov-nfse-sync"
                className="px-3 py-2 text-[12px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2] hover:bg-[#5A3522] disabled:opacity-50 flex items-center gap-1.5"
              >
                {sincronizando ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Sincronizar municípios
              </button>
              <AjudaCampo chave="fiscal.gov_nfse.acao.sincronizar" rota={ROTA} alinhar="fim" />
            </div>
          </div>

          {sincResultado && (
            <div
              className={`px-5 py-2 text-[12px] flex items-start gap-2 ${
                sincResultado.ok
                  ? 'bg-[#E8F4DC] text-[#1B3608]'
                  : 'bg-[#FCEBEB] text-[#791F1F]'
              }`}
            >
              {sincResultado.ok ? (
                <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              )}
              <div>
                {sincResultado.ok ? (
                  <>
                    Sincronização concluída
                    {sincResultado.total != null && ` · ${sincResultado.total} municípios`}
                    {sincResultado.atualizados != null && ` · ${sincResultado.atualizados} atualizados`}
                  </>
                ) : (
                  sincResultado.erro ?? 'Erro'
                )}
              </div>
            </div>
          )}

          {loadingMunic ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={20} />
            </div>
          ) : erroMunic ? (
            <BlocoErro msg={erroMunic} onRetry={carregarMunicipios} />
          ) : municipios.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-[#3D2314]/60">
              Cache vazio · clique em &ldquo;Sincronizar municípios&rdquo; pra carregar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 uppercase tracking-[0.5px]">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">Código IBGE<AjudaCampo chave="fiscal.gov_nfse.munic.codigo_ibge" rota={ROTA} /></span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">Nome<AjudaCampo chave="fiscal.gov_nfse.munic.nome" rota={ROTA} /></span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">UF<AjudaCampo chave="fiscal.gov_nfse.munic.uf" rota={ROTA} /></span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">Aderiu em<AjudaCampo chave="fiscal.gov_nfse.munic.aderiu_em" rota={ROTA} /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {municipios.map((m) => (
                    <tr key={m.codigo_ibge} className="border-t border-[#3D2314]/8">
                      <td className="px-4 py-2 font-mono text-[12px]">{m.codigo_ibge}</td>
                      <td className="px-4 py-2">{m.nome_municipio ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-[12px]">{m.uf ?? '—'}</td>
                      <td className="px-4 py-2 text-[12px] text-[#3D2314]/75">
                        {m.data_adesao ? new Date(m.data_adesao).toLocaleDateString('pt-BR') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#3D2314]/10">
            <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium flex items-center">
              DPSes pendentes (últimas 50)
              <AjudaCampo chave="fiscal.gov_nfse.ind.dps_pendentes" rota={ROTA} />
            </div>
            <div className="text-[13.5px] font-medium text-[#3D2314] mt-0.5 flex items-center gap-1.5">
              <FileText size={13} className="text-[#C8941A]" />{' '}
              {erroDps ? '—' : (
                <>
                  {pendentes.length} {pendentes.length === 1 ? 'pendente' : 'pendentes'}
                </>
              )}
            </div>
          </div>
          {loadingDps ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={20} />
            </div>
          ) : erroDps ? (
            <BlocoErro msg={erroDps} onRetry={carregarDps} />
          ) : pendentes.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-[#3D2314]/60">
              Nenhuma DPS pendente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 uppercase tracking-[0.5px]">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">Nº DPS<AjudaCampo chave="fiscal.gov_nfse.dps.numero" rota={ROTA} /></span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">Enviado em<AjudaCampo chave="fiscal.gov_nfse.dps.data" rota={ROTA} /></span></th>
                    <th className="text-left px-4 py-2 font-medium"><span className="inline-flex items-center">Status<AjudaCampo chave="fiscal.gov_nfse.dps.status" rota={ROTA} /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {pendentes.map((d) => {
                    const espera = fmtEspera(d.minutos_aguardando)
                    return (
                      <tr key={d.id} className="border-t border-[#3D2314]/8">
                        <td className="px-4 py-2">
                          <div className="font-mono text-[12px]">{d.numero_dps ?? '—'}</div>
                          {d.chave_acesso && (
                            <div className="font-mono text-[10.5px] text-[#3D2314]/45 truncate max-w-[220px]">{d.chave_acesso}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-[12px]">{fmtData(d.enviado_em)}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-medium bg-[#FAEEDA] text-[#633806] border border-[#E8C387]">
                            {d.status_gov ?? 'processando'}
                          </span>
                          {espera && (
                            <span className="ml-2 text-[10.5px] text-[#3D2314]/50">{espera}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
