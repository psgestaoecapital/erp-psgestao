'use client'
import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function ReformaPage() {
  const params = useParams()
  const id = params?.id as string
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const brl = (v:number) => 'R$ '+(v||0).toLocaleString('pt-BR',{maximumFractionDigits:0})
  const pct = (v:number) => (v||0).toFixed(2)+'%'

  useEffect(() => {
    fetch('/api/contador/empresas/'+id+'/reforma')
      .then(r=>r.json()).then(setData).finally(()=>setLoading(false))
  }, [id])

  if (loading) return <div className='p-6 text-sm'>Calculando simulação...</div>
  if (!data || data.error) return <div className='p-6 text-sm text-red-600'>{data?.error||'Erro'}</div>

  return (
    <div className='p-6 max-w-4xl mx-auto space-y-6'>
      <div>
        <h1 className='text-2xl font-bold'>Simulador — Reforma Tributária 2026</h1>
        <p className='text-sm text-muted-foreground mt-1'>
          Regime: <b className='capitalize'>{data.regime_atual}</b>  ·  
          Receita média: <b>{brl(data.receita_media_mensal)}/mês</b>
        </p>
      </div>

      <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
        {[
          {l:'Carga Atual',    v:brl(data.carga_atual?.valor),     s:pct(data.carga_atual?.pct),   c:'text-foreground'},
          {l:'CBS 2026',       v:brl(data.reforma_2026?.cbs),      s:'0,9% — informativo',          c:'text-amber-600'},
          {l:'IBS 2026',       v:brl(data.reforma_2026?.ibs),      s:'0,1% — informativo',          c:'text-amber-600'},
          {l:'Float Perdido',  v:brl(data.split_payment?.float_perdido_mes), s:'Split Payment/mês', c:'text-red-600'},
        ].map((k,i) => (
          <div key={i} className='bg-card border rounded-xl p-4'>
            <p className={'text-xl font-bold '+k.c}>{k.v}</p>
            <p className='text-sm font-medium mt-1'>{k.l}</p>
            <p className='text-xs text-muted-foreground'>{k.s}</p>
          </div>
        ))}
      </div>

      <div className='bg-amber-50 border border-amber-200 rounded-xl p-4'>
        <h3 className='font-semibold text-amber-900 mb-1'>⚠ Impacto do Split Payment</h3>
        <p className='text-sm text-amber-800'>
          Com Split Payment obrigatório (previsto a partir de 2028), esta empresa perderá
          <b> {brl(data.split_payment?.float_perdido_mes)}/mês</b> de capital de giro.
          No ano: <b>{brl(data.split_payment?.float_perdido_ano)}</b>.
          O banco separará automaticamente o tributo no momento do Pix/cartão/boleto.
        </p>
      </div>

      <div className='bg-card border rounded-xl p-4'>
        <h3 className='font-semibold mb-3'>Regime Ótimo Calculado</h3>
        <div className='space-y-2'>
          {Object.entries(data.regime_otimo?.cargas||{}).map(([regime,valor]:any) => (
            <div key={regime} className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                {regime === data.regime_otimo?.recomendado && <span className='text-green-600 text-xs font-bold'>★ ÓTIMO</span>}
                <span className='text-sm capitalize'>{regime}</span>
              </div>
              <span className={'text-sm font-medium '+(regime===data.regime_otimo?.recomendado?'text-green-600':'text-foreground')}>{brl(valor)}/mês</span>
            </div>
          ))}
        </div>
        {data.regime_otimo?.economia_vs_atual > 0 && (
          <p className='text-sm text-green-600 mt-3 font-medium'>
            Potencial de economia: {brl(data.regime_otimo.economia_vs_atual)}/mês mudando de regime.
          </p>
        )}
      </div>
    </div>
  )
}
