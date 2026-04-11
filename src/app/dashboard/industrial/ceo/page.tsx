'use client'
import React, { useState, useEffect, useCallback } from 'react'

interface KpiDiario {
  data: string
  cabecas_dia: number
  toneladas_dia: number
  rendimento_pct: number
  oee_pct: number
  custo_kg_total: number
  condenacao_pct: number
  ph_medio: number | null
  receita_dia: number
  ebitda_dia: number
  margem_pct: number
  custo_condenacao: number
}

interface Alerta { id: string; titulo: string; urgencia: string; descricao: string }

export default function IndustrialCEOPage() {
  const [unidades, setUnidades] = useState<any[]>([])
  const [unidadeId, setUnidadeId] = useState<string>('')
  const [periodo, setPeriodo] = useState<'today'|'week'|'month'>('today')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const brl = (v: number) => 'R$ '+(v||0).toLocaleString('pt-BR',{maximumFractionDigits:0})
  const pct = (v: number, d=1) => (v||0).toFixed(d)+'%'
  const num = (v: number, d=0) => (v||0).toLocaleString('pt-BR',{maximumFractionDigits:d})

  useEffect(() => {
    // Busca unidades da empresa logada
    fetch('/api/industrial/unidades?company_id='+encodeURIComponent(window.location.search.includes('company_id') ? new URLSearchParams(window.location.search).get('company_id')||'' : ''))
      .then(r=>r.json()).then(d=>{ if(d.unidades?.length) { setUnidades(d.unidades); setUnidadeId(d.unidades[0].id) } })
      .catch(()=>{})
  }, [])

  const carregar = useCallback(async () => {
    if (!unidadeId) return
    setLoading(true)
    try {
      const r = await fetch(`/api/industrial/bovinos/kpis?unidade_id=${unidadeId}&periodo=${periodo}`)
      const d = await r.json()
      setData(d)
    } finally { setLoading(false) }
  }, [unidadeId, periodo])

  useEffect(() => { if (unidadeId) carregar() }, [unidadeId, periodo, carregar])

  const agg = data?.agregados || {}
  const ultimo = data?.ultimo_dia as KpiDiario | null
  const alertas = (data?.alertas || []) as Alerta[]
  const criticos = alertas.filter(a => a.urgencia === 'critico' || a.urgencia === 'alto')

  return (
    <div className='p-6 max-w-7xl mx-auto space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between flex-wrap gap-3'>
        <div>
          <h1 className='text-2xl font-bold'>Painel CEO — Bovinos 🐄</h1>
          <p className='text-sm text-muted-foreground mt-0.5'>
            Visão N5 · Presidente · Dados em tempo real
          </p>
        </div>
        <div className='flex gap-2 flex-wrap'>
          {unidades.length > 1 && (
            <select value={unidadeId} onChange={e=>setUnidadeId(e.target.value)}
              className='border rounded px-3 py-1.5 text-sm bg-background'>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          )}
          {(['today','week','month'] as const).map(p => (
            <button key={p} onClick={()=>setPeriodo(p)}
              className={'px-3 py-1.5 text-sm rounded border '+
                (periodo===p?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-muted')}>
              {p==='today'?'Hoje':p==='week'?'7 dias':'Mês'}
            </button>
          ))}
          <button onClick={carregar} disabled={loading}
            className='px-3 py-1.5 text-sm border rounded hover:bg-muted disabled:opacity-50'>
            {loading ? '...' : '↻'}
          </button>
        </div>
      </div>

      {/* Alertas críticos */}
      {criticos.length > 0 && (
        <div className='bg-red-50 border border-red-200 rounded-xl p-4'>
          <p className='font-semibold text-red-800 mb-2'>⚠ {criticos.length} alerta(s) crítico(s)</p>
          <div className='space-y-1'>
            {criticos.map(a => (
              <p key={a.id} className='text-sm text-red-700'>• {a.titulo}</p>
            ))}
          </div>
        </div>
      )}

      {/* KPIs principais — grid */}
      {loading && <div className='text-sm text-muted-foreground text-center py-8'>Carregando KPIs...</div>}

      {!loading && (
        <>
        {/* Produção */}
        <div>
          <p className='text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3'>Produção</p>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
            {[
              { l:'Cabeças',      v:num(agg.cabecas_total),    s:'cab período', c:'text-foreground' },
              { l:'Toneladas',    v:num(agg.toneladas_total,1),s:'ton período', c:'text-foreground' },
              { l:'Rendimento',   v:pct(ultimo?.rendimento_pct||0), s:'% carcaça/vivo', c:'text-blue-600' },
              { l:'OEE',          v:pct(ultimo?.oee_pct||0),   s:'eficiência linha', c:((ultimo?.oee_pct||0)>80?'text-green-600':'text-amber-600') },
            ].map((k,i)=>(
              <div key={i} className='bg-card border rounded-xl p-4'>
                <p className={'text-2xl font-bold '+k.c}>{k.v}</p>
                <p className='text-sm font-medium mt-1'>{k.l}</p>
                <p className='text-xs text-muted-foreground'>{k.s}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Custo */}
        <div>
          <p className='text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3'>Custo</p>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
            {[
              { l:'Custo/kg total',  v:'R$ '+((ultimo?.custo_kg_total||0)).toFixed(2), s:'último dia', c:'text-foreground' },
              { l:'CMV %',           v:pct(ultimo?.condenacao_pct||0*0+(agg.ebitda_total||0)*0||0), s:'do faturamento', c:'text-foreground' },
              { l:'Custo Condenação',v:brl(agg.custo_condenacao_total||0), s:'período', c:'text-red-600' },
              { l:'EBITDA',          v:brl(agg.ebitda_total),  s:pct(Number(agg.margem_media_pct||0))+' margem', c:(agg.ebitda_total>=0?'text-green-600':'text-red-600') },
            ].map((k,i)=>(
              <div key={i} className='bg-card border rounded-xl p-4'>
                <p className={'text-2xl font-bold '+k.c}>{k.v}</p>
                <p className='text-sm font-medium mt-1'>{k.l}</p>
                <p className='text-xs text-muted-foreground'>{k.s}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Qualidade */}
        <div>
          <p className='text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3'>Qualidade SIF</p>
          <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
            {[
              { l:'Condenação SIF',  v:pct(ultimo?.condenacao_pct||0,2), s:'últimas 24h', c:((ultimo?.condenacao_pct||0)<2?'text-green-600':'text-red-600') },
              { l:'pH Médio',        v:(ultimo?.ph_medio||0).toFixed(2)||'—', s:'ideal: 5,5–6,2', c:((ultimo?.ph_medio||0)>=5.5&&(ultimo?.ph_medio||0)<=6.2?'text-green-600':'text-amber-600') },
              { l:'Receita total',   v:brl(agg.receita_total), s:'período', c:'text-foreground' },
            ].map((k,i)=>(
              <div key={i} className='bg-card border rounded-xl p-4'>
                <p className={'text-2xl font-bold '+k.c}>{k.v}</p>
                <p className='text-sm font-medium mt-1'>{k.l}</p>
                <p className='text-xs text-muted-foreground'>{k.s}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Histórico */}
        {data?.historico?.length > 1 && (
          <div className='bg-card border rounded-xl p-4'>
            <p className='font-semibold mb-3'>Histórico do Período</p>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='text-xs text-muted-foreground border-b'>
                    <th className='text-left py-2 pr-4'>Data</th>
                    <th className='text-right py-2 px-2'>Cabeças</th>
                    <th className='text-right py-2 px-2'>Rend.</th>
                    <th className='text-right py-2 px-2'>OEE</th>
                    <th className='text-right py-2 px-2'>Custo/kg</th>
                    <th className='text-right py-2 px-2'>Cond. SIF</th>
                    <th className='text-right py-2 px-2'>EBITDA</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.historico as KpiDiario[]).map((k,i) => (
                    <tr key={i} className='border-b hover:bg-muted/30'>
                      <td className='py-2 pr-4 text-muted-foreground'>{k.data}</td>
                      <td className='py-2 px-2 text-right'>{num(k.cabecas_dia)}</td>
                      <td className='py-2 px-2 text-right'>{pct(k.rendimento_pct)}</td>
                      <td className={'py-2 px-2 text-right '+(k.oee_pct>80?'text-green-600':'text-amber-600')}>{pct(k.oee_pct)}</td>
                      <td className='py-2 px-2 text-right font-mono'>R${(k.custo_kg_total||0).toFixed(2)}</td>
                      <td className={'py-2 px-2 text-right '+(k.condenacao_pct<2?'text-green-600':'text-red-600')}>{pct(k.condenacao_pct,2)}</td>
                      <td className={'py-2 px-2 text-right '+(k.ebitda_dia>=0?'text-green-600':'text-red-600')}>{brl(k.ebitda_dia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
      )}

      {/* Botão apontamento */}
      <div className='flex gap-3 pt-2'>
        <a href='/dashboard/industrial/apontamento'
           className='text-sm border rounded-lg px-4 py-2 hover:bg-muted'>
          + Registrar Turno
        </a>
        <a href='/dashboard/industrial/lote-animal'
           className='text-sm border rounded-lg px-4 py-2 hover:bg-muted'>
          + Lote de Animais
        </a>
      </div>
    </div>
  )
}
