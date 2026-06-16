'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Financiamento = {
  id: string; banco: string | null; tipo: string | null; operacao: string | null; contrato: string | null
  valor_original: number | null; valor_liquido: number | null; saldo_devedor: number | null
  taxa_mensal: number | null; parcelas: number | null; parcelas_restantes: number | null
  valor_parcela: number | null; vencimento: string | null; garantia: string | null
  status: string | null; situacao: string | null
}

const brl = (n: number | null) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function FinanciamentoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [rows, setRows] = useState<Financiamento[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!empresaUnica) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('financiamentos')
        .select('*')
        .eq('company_id', empresaUnica)
        .order('saldo_devedor', { ascending: false })
      if (!alive) return
      setRows((data ?? []) as Financiamento[])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [empresaUnica])

  const dividaTotal = rows.reduce((s, r) => s + (r.saldo_devedor ?? 0), 0)
  const mensal = rows.reduce((s, r) => s + (r.valor_parcela ?? 0), 0)

  if (!empresaUnica) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: '#3D2314' }}>
        <header className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">🏦 Financiamento</h1>
        </header>
        <div className="rounded-xl p-6 text-center" style={{ background: '#FAF7F2' }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm opacity-70">Use o trocador da TopNav para escolher uma empresa.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto" style={{ color: '#3D2314' }}>
      <header className="mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">🏦 Financiamento</h1>
        <p className="text-sm opacity-70">Contratos de financiamento e empréstimo da empresa.</p>
      </header>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="rounded-xl p-3" style={{ background: '#FAF7F2' }}>
          <div className="text-[11px] uppercase opacity-60">Dívida total</div>
          <div className="font-bold" style={{ color: '#C8941A' }}>{brl(dividaTotal)}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: '#FAF7F2' }}>
          <div className="text-[11px] uppercase opacity-60">Contratos</div>
          <div className="font-bold">{rows.length}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: '#FAF7F2' }}>
          <div className="text-[11px] uppercase opacity-60">Compromisso mensal</div>
          <div className="font-bold">{brl(mensal)}</div>
        </div>
      </div>

      {loading && <p className="opacity-60">Carregando…</p>}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: '#FAF7F2' }}>
          <p className="font-medium">Nenhum financiamento cadastrado</p>
          <p className="text-sm opacity-70">Quando esta empresa tiver contratos de financiamento, eles aparecem aqui.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border p-4" style={{ borderColor: '#E7DED3', background: '#fff' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{r.banco ?? '—'}</div>
              {r.situacao && (
                <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#FAF7F2' }}>{r.situacao}</span>
              )}
            </div>
            <div className="text-2xl font-bold mb-2" style={{ color: '#C8941A' }}>{brl(r.saldo_devedor)}</div>
            <div className="text-sm opacity-80 flex flex-wrap gap-x-4 gap-y-1">
              <span>Parcela {brl(r.valor_parcela)}</span>
              <span>{r.parcelas_restantes ?? '—'}/{r.parcelas ?? '—'} restantes</span>
              {r.taxa_mensal != null && <span>{r.taxa_mensal}% a.m.</span>}
              {r.vencimento && <span>vence {r.vencimento}</span>}
            </div>
            {(r.operacao || r.tipo || r.contrato || r.garantia) && (
              <div className="text-xs opacity-60 mt-2 flex flex-wrap gap-x-3">
                {r.operacao && <span>{r.operacao}</span>}
                {r.tipo && <span>· {r.tipo}</span>}
                {r.contrato && <span>· contrato {r.contrato}</span>}
                {r.garantia && <span>· garantia: {r.garantia}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
