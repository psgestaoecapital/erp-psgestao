'use client'

// NFE-F5 · Entrega 5 · Painel "Reforma Tributária — o que já está chegando". SÓ informativo (RD-51):
// mostra o IBS/CBS que já veio nas compras. Não simula alíquota nem carga futura (ainda em definição).

import { useCallback, useEffect, useState } from 'react'
import { Landmark, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Mes = { mes: string; ibs: number; cbs: number; ibs_cbs: number; notas_com_reforma: number }
type Painel = {
  ok?: boolean; erro?: string
  ibs_total: number; cbs_total: number; ibs_cbs_total: number
  notas_com_reforma: number; notas_total: number
  fornecedores_com_reforma: number; fornecedores_total: number
  por_mes: Mes[]; aviso: string
}
const brl = (v: number | null | undefined) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const mesLabel = (m: string) => { const [y, mm] = m.split('-'); return `${mm}/${y.slice(2)}` }

export default function PainelReformaPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [dados, setDados] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setDados(null); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_fiscal_reforma_painel', { p_company_id: empresa, p_competencia: null })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as Painel | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao carregar'); return }
    setDados(r)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const maxMes = dados ? Math.max(1, ...dados.por_mes.map((m) => m.ibs_cbs)) : 1

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Fiscal</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <Landmark size={22} className="text-[#C8941A]" /> Reforma Tributária — o que já está chegando
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-2xl">
          O <strong>IBS e a CBS</strong> que já vieram destacados nas suas compras. <strong>Informativo</strong> — mostra o que
          chegou, não uma previsão. As alíquotas ainda estão em definição, então não simulamos carga futura.
        </p>

        {loading ? (
          <div className="mt-6 px-4 py-16 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Carregando…</div>
        ) : erro ? (
          <div className="mt-6 px-4 py-6 text-[12px] text-[#A32D2D] bg-white border border-[#3D2314]/10 rounded-xl">Não consegui carregar: {erro}</div>
        ) : dados ? (
          <>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4">
                <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.5px]">IBS + CBS recebidos</div>
                <div className="text-[26px] font-semibold text-[#3F7012] tabular-nums mt-1">{brl(dados.ibs_cbs_total)}</div>
                <div className="text-[11px] text-[#3D2314]/55 mt-1">IBS {brl(dados.ibs_total)} · CBS {brl(dados.cbs_total)}</div>
              </div>
              <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4">
                <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.5px]">Notas com os campos novos</div>
                <div className="text-[26px] font-semibold text-[#3D2314] tabular-nums mt-1">{dados.notas_com_reforma}<span className="text-[15px] text-[#3D2314]/45"> / {dados.notas_total}</span></div>
                <div className="text-[11px] text-[#3D2314]/55 mt-1">notas de compra do período</div>
              </div>
              <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4">
                <div className="text-[11px] text-[#3D2314]/55 uppercase tracking-[0.5px]">Fornecedores já emitindo</div>
                <div className="text-[26px] font-semibold text-[#3D2314] tabular-nums mt-1">{dados.fornecedores_com_reforma}<span className="text-[15px] text-[#3D2314]/45"> / {dados.fornecedores_total}</span></div>
                <div className="text-[11px] text-[#3D2314]/55 mt-1">com IBS/CBS na nota</div>
              </div>
            </div>

            <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl p-4">
              <div className="text-[13px] font-medium text-[#3D2314] mb-3">Evolução mês a mês</div>
              {dados.por_mes.length === 0 ? (
                <div className="text-[12px] text-[#3D2314]/55 py-6 text-center">Nenhuma compra com IBS/CBS ainda.</div>
              ) : (
                <div className="space-y-2">
                  {dados.por_mes.map((m) => (
                    <div key={m.mes} className="flex items-center gap-3">
                      <div className="w-14 text-[12px] text-[#3D2314]/70 tabular-nums">{mesLabel(m.mes)}</div>
                      <div className="flex-1 bg-[#3D2314]/5 rounded-full h-5 overflow-hidden">
                        <div className="h-full bg-[#C8941A]/70 rounded-full" style={{ width: `${Math.max(4, (m.ibs_cbs / maxMes) * 100)}%` }} />
                      </div>
                      <div className="w-24 text-right text-[12px] tabular-nums text-[#3D2314] font-medium">{brl(m.ibs_cbs)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="mt-3 text-[11px] text-[#3D2314]/55">{dados.aviso}</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
