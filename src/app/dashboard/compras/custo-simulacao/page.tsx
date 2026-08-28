'use client'

// NFE-F1 · E6 · Simulação do custo real (custo hoje × custo real × margem). SÓ SIMULA — nada é gravado.
// Aplicar o custo médio histórico exige autorização do CEO (RD-55). Fonte: fn_nfe_custo_simular.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Calculator, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Row = {
  produto_id: string; codigo: string; nome: string
  custo_hoje: number; custo_real: number; diferenca: number; preco_venda: number
  margem_hoje_pct: number | null; margem_real_pct: number | null
}

const brl = (v: number | null) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number | null) => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

export default function CustoSimulacaoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setRows([]); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_custo_simular', { p_company_id: empresa })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; produtos?: Row[]; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao simular'); setRows([]); return }
    setRows(r.produtos ?? [])
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  const sobem = rows.filter((r) => r.diferenca > 0).length

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Custo</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <Calculator size={22} className="text-[#C8941A]" /> Simulação do custo real
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
          Compara o custo atual do cadastro com o <strong>custo real</strong> (item + tributos que são custo +
          rateio de frete, conforme a config da empresa). <strong>Nada é gravado.</strong>
        </p>
        <div className="mt-3 flex items-start gap-2 text-[12px] text-[#8a5a12] bg-[#FBF3E0] border border-[#C8941A]/25 rounded-lg px-3 py-2 max-w-3xl">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          <span>Aplicar o custo médio histórico exige autorização do CEO (RD-55) — backup e contagem antes/depois.
          O custo real tende a subir; produtos de margem negativa podem aumentar. É informação, não regressão.</span>
        </div>

        <div className="mt-5 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]">
              <Loader2 className="animate-spin" size={15} /> Simulando…
            </div>
          ) : erro ? (
            <div className="px-4 py-6 text-[12px] text-[#A32D2D]">Não consegui simular: {erro}</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-[#3D2314]/60">
              Nenhum produto com custo divergente ainda. Dê entrada em notas para o custo real ser calculado.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#3D2314]/10 text-[12px] text-[#3D2314]/70">
                <strong className="text-[#3D2314]">{rows.length}</strong> produto(s) com custo divergente · {sobem} sobe(m)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#3D2314]/55 text-left border-b border-[#3D2314]/8">
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 font-medium text-right">Custo hoje</th>
                      <th className="px-3 py-2 font-medium text-right">Custo real</th>
                      <th className="px-3 py-2 font-medium text-right">Diferença</th>
                      <th className="px-3 py-2 font-medium text-right">Venda</th>
                      <th className="px-3 py-2 font-medium text-right">Margem hoje</th>
                      <th className="px-3 py-2 font-medium text-right">Margem real</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.produto_id} className="border-b border-[#3D2314]/6">
                        <td className="px-3 py-2"><div className="text-[#3D2314] font-medium truncate max-w-[240px]">{r.nome}</div><div className="text-[10px] text-[#3D2314]/50">cód {r.codigo}</div></td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]">{brl(r.custo_hoje)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314] font-medium">{brl(r.custo_real)}</td>
                        <td className={'px-3 py-2 text-right tabular-nums font-semibold ' + (r.diferenca > 0 ? 'text-[#A32D2D]' : 'text-[#3F7012]')}>{r.diferenca > 0 ? '+' : ''}{brl(r.diferenca)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/70">{brl(r.preco_venda)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#3D2314]/70">{pct(r.margem_hoje_pct)}</td>
                        <td className={'px-3 py-2 text-right tabular-nums font-medium ' + ((r.margem_real_pct ?? 0) < 0 ? 'text-[#A32D2D]' : 'text-[#3D2314]')}>{pct(r.margem_real_pct)}</td>
                        <td className="px-3 py-2 text-right"><Link href={`/dashboard/produtos?busca=${encodeURIComponent(r.codigo)}`} className="text-[11px] text-[#BA7517] font-medium hover:underline">editar</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
