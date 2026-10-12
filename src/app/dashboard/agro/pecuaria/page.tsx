'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/hooks/useEmpresaSelecionada'

type Painel = {
  total_cabecas: number
  por_categoria: Array<{ categoria: string; qtd: number }>
  lotes_ativos: number
  areas: number
  propriedades: number
}

export default function PecuariaPainel() {
  const { companyId } = useEmpresaSelecionada()
  const [p, setP] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.rpc('fn_pec_painel_rebanho', { p_company_id: companyId, p_propriedade_id: null })
      if (alive) { setP(data as Painel); setLoading(false) }
    })()
    return () => { alive = false }
  }, [companyId])

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa especifica no topo do menu para abrir a pecuaria.
    </div>
  )

  const Card = ({ label, value }: { label: string; value: number | undefined }) => (
    <div className="rounded-2xl bg-white p-4 shadow-sm border border-[#E7DECF]">
      <div className="text-2xl font-bold text-[#3D2314]">{value ?? '—'}</div>
      <div className="text-xs text-[#3D2314]/60 mt-1">{label}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4">
      <header className="flex items-center gap-2">
        <span className="text-2xl">🐂</span>
        <h1 className="text-xl font-bold text-[#3D2314]">Pecuária de Corte</h1>
      </header>

      {loading ? <div className="text-[#3D2314]/50 text-sm">Carregando rebanho…</div> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card label="Cabeças ativas" value={p?.total_cabecas} />
            <Card label="Lotes ativos" value={p?.lotes_ativos} />
            <Card label="Áreas" value={p?.areas} />
            <Card label="Propriedades" value={p?.propriedades} />
          </div>

          <section className="rounded-2xl bg-white p-4 border border-[#E7DECF]">
            <h2 className="text-sm font-semibold text-[#3D2314] mb-2">Rebanho por categoria</h2>
            <div className="space-y-1">
              {(p?.por_categoria ?? []).length === 0 && (
                <div className="text-xs text-[#3D2314]/50">Nenhum animal cadastrado ainda.</div>
              )}
              {(p?.por_categoria ?? []).map((c) => (
                <div key={c.categoria} className="flex justify-between text-sm">
                  <span className="capitalize text-[#3D2314]">{c.categoria.replace('_', ' ')}</span>
                  <span className="font-semibold text-[#3D2314]">{c.qtd}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <Link href="/dashboard/agro/pecuaria/rebanho" className="rounded-2xl bg-[#3D2314] text-white p-4 text-center font-semibold">
              Rebanho &amp; Lotes
            </Link>
            <Link href="/dashboard/agro/pecuaria/manejo" className="rounded-2xl bg-[#C8941A] text-white p-4 text-center font-semibold">
              Manejo &amp; Pesagem
            </Link>
            <Link href="/dashboard/agro/pecuaria/propriedades" className="rounded-2xl bg-white border border-[#3D2314] text-[#3D2314] p-4 text-center font-semibold col-span-2">
              Propriedades &amp; Áreas
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
