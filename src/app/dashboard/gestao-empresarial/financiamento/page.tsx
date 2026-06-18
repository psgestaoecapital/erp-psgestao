'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Financiamento = {
  id: string
  banco: string | null
  tipo: string | null
  operacao: string | null
  contrato: string | null
  valor_original: number | null
  valor_liquido: number | null
  saldo_devedor: number | null
  saldo_total_parcelas: number | null
  taxa_mensal: number | null
  taxa_anual: number | null
  parcelas: number | null
  parcelas_restantes: number | null
  valor_parcela: number | null
  parcela_futura: number | null
  vencimento: string | null
  data_origem: string | null
  garantia: string | null
  status: string | null
  situacao: string | null
  em_carencia: boolean | null
  observacao: string | null
}

type Kpis = {
  contratos_ativos: number
  saldo_quitacao: number
  saldo_total_parcelas: number
  juros_embutidos: number
  compromisso_mensal: number
  contratos_em_carencia: number
}

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'

function KpiCard({ titulo, valor, destaque, sub }: { titulo: string; valor: string; destaque?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: OFFWHITE, minHeight: 76 }}>
      <div className="text-[11px] uppercase opacity-60 leading-tight">{titulo}</div>
      <div className="font-bold leading-tight" style={{ color: destaque ? DOURADO : ESPRESSO }}>{valor}</div>
      {sub && <div className="text-[11px] opacity-60 leading-tight">{sub}</div>}
    </div>
  )
}

export default function FinanciamentoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [rows, setRows] = useState<Financiamento[]>([])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!empresaUnica) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([])
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKpis(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      const [lista, kpiResp] = await Promise.all([
        supabase
          .from('financiamentos')
          .select('*')
          .eq('company_id', empresaUnica)
          .order('saldo_devedor', { ascending: false }),
        supabase.rpc('fn_financiamentos_kpis', { p_company_id: empresaUnica }),
      ])
      if (!alive) return
      setRows((lista.data ?? []) as Financiamento[])
      setKpis((kpiResp.data ?? null) as Kpis | null)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [empresaUnica])

  if (!empresaUnica) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: ESPRESSO }}>
        <header className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">🏦 Financiamento</h1>
        </header>
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm opacity-70">Use o trocador da TopNav para escolher uma empresa.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-5xl mx-auto" style={{ color: ESPRESSO }}>
      <header className="mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">🏦 Financiamento</h1>
        <p className="text-sm opacity-70">Contratos de financiamento e empréstimo da empresa.</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
        <KpiCard titulo="Contratos ativos" valor={String(kpis?.contratos_ativos ?? 0)} />
        <KpiCard titulo="Saldo de quitação" valor={brl(kpis?.saldo_quitacao)} destaque />
        <KpiCard titulo="Saldo em parcelas" valor={brl(kpis?.saldo_total_parcelas)} />
        <KpiCard titulo="Juros embutidos" valor={brl(kpis?.juros_embutidos)} />
        <KpiCard titulo="Compromisso mensal" valor={brl(kpis?.compromisso_mensal)} />
        <KpiCard titulo="Em carência" valor={String(kpis?.contratos_em_carencia ?? 0)} />
      </div>

      {loading && <p className="opacity-60">Carregando…</p>}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Nenhum financiamento cadastrado</p>
          <p className="text-sm opacity-70">Quando esta empresa tiver contratos de financiamento, eles aparecem aqui.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const restantes = r.parcelas_restantes ?? '—'
          const total = r.parcelas ?? '—'
          const taxa = r.taxa_anual != null ? `${r.taxa_anual}% a.a.` :
                       r.taxa_mensal != null ? `${r.taxa_mensal}% a.m.` : null
          return (
            <div key={r.id} className="rounded-xl border p-4" style={{ borderColor: BORDA, background: '#fff' }}>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div className="font-semibold">{r.banco ?? '—'}</div>
                <div className="flex gap-1">
                  {r.em_carencia && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: '#FFF3D6', color: '#7A5A0F' }}>em carência</span>
                  )}
                  {r.situacao && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: OFFWHITE }}>{r.situacao}</span>
                  )}
                </div>
              </div>
              <div className="text-2xl font-bold mb-1" style={{ color: DOURADO }}>{brl(r.saldo_devedor)}</div>
              {r.saldo_total_parcelas != null && r.saldo_total_parcelas !== r.saldo_devedor && (
                <div className="text-xs opacity-70 mb-2">saldo em parcelas: {brl(r.saldo_total_parcelas)}</div>
              )}
              <div className="text-sm opacity-80 flex flex-wrap gap-x-4 gap-y-1">
                <span>Parcela {brl(r.valor_parcela)}</span>
                <span>{restantes}/{total} restantes</span>
                {taxa && <span>{taxa}</span>}
                {r.vencimento && <span>vence {r.vencimento}</span>}
              </div>
              {(r.operacao || r.tipo || r.contrato || r.garantia || r.data_origem) && (
                <div className="text-xs opacity-60 mt-2 flex flex-wrap gap-x-3">
                  {r.operacao && <span>{r.operacao}</span>}
                  {r.tipo && <span>· {r.tipo}</span>}
                  {r.contrato && <span>· contrato {r.contrato}</span>}
                  {r.garantia && <span>· garantia: {r.garantia}</span>}
                  {r.data_origem && <span>· desde {r.data_origem}</span>}
                </div>
              )}
              {r.observacao && (
                <div className="text-xs opacity-70 mt-2 pt-2 border-t" style={{ borderColor: BORDA }}>
                  {r.observacao}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
