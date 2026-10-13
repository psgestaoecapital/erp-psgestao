'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import {
  ArrowLeft, Landmark, Loader2, AlertCircle, RefreshCw, MapPin, FileText, CheckCircle2,
} from 'lucide-react'

interface DPSPendente {
  id: string
  company_id: string
  numero_dps: number | null
  status: string | null
  cnpj_prestador: string | null
  cnpj_tomador: string | null
  cpf_tomador: string | null
  valor_servico: number | null
  descricao_servico: string | null
  criado_em: string | null
}

interface MunicipioAderido {
  codigo_ibge: string
  nome: string | null
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

export default function GovNFSeStatusClient() {
  const [pendentes, setPendentes] = useState<DPSPendente[]>([])
  const [municipios, setMunicipios] = useState<MunicipioAderido[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [sincResultado, setSincResultado] = useState<SyncResultado | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const [dpsRes, municRes] = await Promise.all([
        supabase
          .from('v_gov_nfse_dps_pendentes')
          .select('*')
          .order('criado_em', { ascending: false })
          .limit(50),
        supabase
          .from('erp_gov_nfse_municipios')
          .select('codigo_ibge, nome, uf, aderido, data_adesao')
          .eq('aderido', true)
          .order('nome'),
      ])
      if (dpsRes.error) throw dpsRes.error
      if (municRes.error) throw municRes.error
      setPendentes((dpsRes.data ?? []) as DPSPendente[])
      setMunicipios((municRes.data ?? []) as MunicipioAderido[])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }, [])

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
      if (json.ok) await carregar()
    } catch (e) {
      setSincResultado({ ok: false, erro: e instanceof Error ? e.message : 'Erro' })
    } finally {
      setSincronizando(false)
    }
  }

  const fmtBRL = (v: number | null) =>
    v == null
      ? '—'
      : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const fmtData = (iso: string | null) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('pt-BR')
    } catch {
      return '—'
    }
  }

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

        {erro && (
          <div className="bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-lg p-3 flex items-start gap-2 mb-4">
            <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={16} />
            <div className="text-[12.5px] text-[#791F1F]">{erro}</div>
          </div>
        )}

        <div className="bg-[#FAEEDA] border border-[#E8C387] rounded-xl p-4 mb-5 text-[12.5px] text-[#633806] leading-relaxed">
          <strong className="font-medium">Status atual:</strong> sistema preparado pra registrar DPSes
          localmente. A transmissão efetiva (mTLS com certificado A1 + endpoint{' '}
          <code className="text-[11px] bg-[#3D2314]/8 px-1 rounded">sefin.nfse.gov.br/sefinnacional/dps</code>)
          será habilitada na Fase 2 (próximo PR).
        </div>

        <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-[#3D2314]/10 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium">
                Municípios aderidos (cache local)
              </div>
              <div className="text-[13.5px] font-medium text-[#3D2314] mt-0.5 flex items-center gap-1.5">
                <MapPin size={13} className="text-[#C8941A]" /> {municipios.length} municípios
              </div>
            </div>
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

          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={20} />
            </div>
          ) : municipios.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-[#3D2314]/60">
              Cache vazio · clique em &ldquo;Sincronizar municípios&rdquo; pra carregar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 uppercase tracking-[0.5px]">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Código IBGE</th>
                    <th className="text-left px-4 py-2 font-medium">Nome</th>
                    <th className="text-left px-4 py-2 font-medium">UF</th>
                    <th className="text-left px-4 py-2 font-medium">Aderiu em</th>
                  </tr>
                </thead>
                <tbody>
                  {municipios.map((m) => (
                    <tr key={m.codigo_ibge} className="border-t border-[#3D2314]/8">
                      <td className="px-4 py-2 font-mono text-[12px]">{m.codigo_ibge}</td>
                      <td className="px-4 py-2">{m.nome ?? '—'}</td>
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
            <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.8px] font-medium">
              DPSes pendentes (últimas 50)
            </div>
            <div className="text-[13.5px] font-medium text-[#3D2314] mt-0.5 flex items-center gap-1.5">
              <FileText size={13} className="text-[#C8941A]" /> {pendentes.length}{' '}
              {pendentes.length === 1 ? 'pendente' : 'pendentes'}
            </div>
          </div>
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={20} />
            </div>
          ) : pendentes.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-[#3D2314]/60">
              Nenhuma DPS pendente.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 uppercase tracking-[0.5px]">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Nº DPS</th>
                    <th className="text-left px-4 py-2 font-medium">Data</th>
                    <th className="text-left px-4 py-2 font-medium">Descrição</th>
                    <th className="text-right px-4 py-2 font-medium">Valor</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pendentes.map((d) => (
                    <tr key={d.id} className="border-t border-[#3D2314]/8">
                      <td className="px-4 py-2 font-mono text-[12px]">{d.numero_dps ?? '—'}</td>
                      <td className="px-4 py-2 text-[12px]">{fmtData(d.criado_em)}</td>
                      <td className="px-4 py-2 text-[12px]">{d.descricao_servico ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtBRL(d.valor_servico)}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-medium bg-[#FAEEDA] text-[#633806] border border-[#E8C387]">
                          {d.status ?? 'processando'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
