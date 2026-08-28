'use client'

// NFE-F0 · E6 · Produtos com margem negativa (venda < custo). Só LISTA — corrigir preço é decisão
// comercial (RD-55). Fonte: fn_nfe_produtos_margem_negativa (custo médio, senão custo). Link p/ editar.
// ⚠️ O custo do estoque ainda não inclui frete/IPI/ST (Fase 1) — esta lista é um alerta, não a verdade final.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Row = { codigo: string; nome: string; venda: number; custo: number; diferenca: number }

const brl = (v: number) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function MargemNegativaPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setRows([]); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_nfe_produtos_margem_negativa', { p_company_id: empresa })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; produtos?: Row[]; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao carregar'); setRows([]); return }
    setRows(r.produtos ?? [])
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Alertas</div>
        <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
          <AlertTriangle size={22} className="text-[#C8941A]" /> Produtos com margem negativa
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-2xl">
          Produtos com <strong>preço de venda menor que o custo</strong>. Só alerta — a correção do preço é
          decisão comercial. <span className="text-[#3D2314]/55">O custo ainda não inclui frete/IPI/ST (Fase 1),
          então trate como sinal, não verdade final.</span>
        </p>

        <div className="mt-5 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]">
              <Loader2 className="animate-spin" size={15} /> Carregando…
            </div>
          ) : erro ? (
            <div className="px-4 py-6 text-[12px] text-[#A32D2D]">Não consegui carregar: {erro}</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-[#3D2314]/60">Nenhum produto com margem negativa. 🎉</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#3D2314]/10 text-[12px] text-[#3D2314]/70">
                <strong className="text-[#3D2314]">{rows.length}</strong> produto(s) vendendo abaixo do custo
              </div>
              <div className="divide-y divide-[#3D2314]/8">
                {rows.map((p) => (
                  <div key={p.codigo} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#3D2314] truncate">{p.nome}</div>
                      <div className="text-[11px] text-[#3D2314]/55 mt-0.5">cód {p.codigo}</div>
                    </div>
                    <div className="flex items-center gap-4 text-[12px] tabular-nums">
                      <div className="text-right"><div className="text-[10px] text-[#3D2314]/50">venda</div><div className="text-[#3D2314] font-medium">{brl(p.venda)}</div></div>
                      <div className="text-right"><div className="text-[10px] text-[#3D2314]/50">custo</div><div className="text-[#3D2314] font-medium">{brl(p.custo)}</div></div>
                      <div className="text-right"><div className="text-[10px] text-[#3D2314]/50">diferença</div><div className="text-[#A32D2D] font-semibold">-{brl(p.diferenca)}</div></div>
                      <Link href={`/dashboard/produtos?busca=${encodeURIComponent(p.codigo)}`}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810]">Editar</Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
