'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ApontamentoPage() {
  const router = useRouter()
  const hoje = new Date().toISOString().slice(0,10)
  const [form, setForm] = useState({
    unidade_id: '', data: hoje, turno: 'A',
    cabecas_abatidas: '', peso_total_kg: '', rendimento_pct: '',
    horas_efetivas: '8', meta_cab_turno: '', paradas_min: '0', operadores: '',
    condenados_total: '0', ph_medio: '', temp_camara_c: '',
    custo_animal: '', custo_mo: '', custo_energia: '', custo_insumos: '',
    receita_turno: '',
  })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const set = (k: string, v: string) => setForm(f => ({...f,[k]:v}))

  async function salvar() {
    setLoading(true); setMsg('')
    try {
      const payload = { ...form }
      Object.keys(payload).forEach(k => {
        if ((payload as any)[k] !== '' && !isNaN(Number((payload as any)[k])))
          (payload as any)[k] = Number((payload as any)[k])
      })
      const r = await fetch('/api/industrial/bovinos/apontamento', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setMsg('✓ Turno registrado! Custo/kg: R$ '+d.custo_kg?.toFixed(4))
      setTimeout(()=>router.push('/dashboard/industrial/ceo'), 1500)
    } catch(e:any) { setMsg('✗ '+e.message) } finally { setLoading(false) }
  }

  const campo = (k: string, l: string, t='number', obrig=false) => (
    <div key={k}>
      <label className='text-xs text-muted-foreground uppercase tracking-wide block mb-1'>{l}{obrig?' *':''}</label>
      <input type={t} value={(form as any)[k]} onChange={e=>set(k,e.target.value)}
        className='w-full border rounded px-3 py-2 text-sm' />
    </div>
  )

  return (
    <div className='p-6 max-w-2xl mx-auto space-y-6'>
      <h1 className='text-xl font-bold'>Apontamento de Produção — Bovinos</h1>
      {msg && <div className={'p-3 rounded text-sm '+(msg.startsWith('✓')?'bg-green-50 text-green-800':'bg-red-50 text-red-800')}>{msg}</div>}

      <div className='space-y-4'>
        <div className='grid grid-cols-3 gap-3'>
          <div>
            <label className='text-xs text-muted-foreground uppercase tracking-wide block mb-1'>Data *</label>
            <input type='date' value={form.data} onChange={e=>set('data',e.target.value)} className='w-full border rounded px-3 py-2 text-sm'/>
          </div>
          <div>
            <label className='text-xs text-muted-foreground uppercase tracking-wide block mb-1'>Turno *</label>
            <select value={form.turno} onChange={e=>set('turno',e.target.value)} className='w-full border rounded px-3 py-2 text-sm bg-background'>
              <option value='A'>A (manhã)</option><option value='B'>B (tarde)</option><option value='C'>C (noite)</option>
            </select>
          </div>
          {campo('operadores','Operadores')}
        </div>

        <p className='text-xs font-bold text-muted-foreground uppercase tracking-wider'>Produção</p>
        <div className='grid grid-cols-2 gap-3'>
          {campo('cabecas_abatidas','Cabeças abatidas','number',true)}
          {campo('peso_total_kg','Peso total carcaça (kg)')}
          {campo('rendimento_pct','Rendimento carcaça (%)')}
          {campo('horas_efetivas','Horas efetivas')}
          {campo('meta_cab_turno','Meta cabeças turno')}
          {campo('paradas_min','Paradas (min)')}
        </div>

        <p className='text-xs font-bold text-muted-foreground uppercase tracking-wider'>Qualidade SIF</p>
        <div className='grid grid-cols-3 gap-3'>
          {campo('condenados_total','Condenados total')}
          {campo('ph_medio','pH médio')}
          {campo('temp_camara_c','Temp. câmara (°C)')}
        </div>

        <p className='text-xs font-bold text-muted-foreground uppercase tracking-wider'>Custo do Turno (R$)</p>
        <div className='grid grid-cols-2 gap-3'>
          {campo('custo_animal','Custo animais')}
          {campo('custo_mo','Mão de obra')}
          {campo('custo_energia','Energia')}
          {campo('custo_insumos','Insumos/outros')}
          {campo('receita_turno','Receita do turno (Omie)')}
        </div>
      </div>

      <button onClick={salvar} disabled={loading}
        className='w-full bg-primary text-primary-foreground py-3 rounded font-medium disabled:opacity-50'>
        {loading ? 'Salvando...' : 'Registrar Turno →'}
      </button>
    </div>
  )
}
