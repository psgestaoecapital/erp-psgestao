'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Unidade = { id: string; nome: string }

export default function ApontamentoPage() {
  const router = useRouter()
  const hoje = new Date().toISOString().slice(0,10)
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

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
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregandoUni, setCarregandoUni] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({...f,[k]:v}))

  // Carrega as unidades/plantas ativas da empresa selecionada (via API com guarda de empresa).
  // Sem este seletor, unidade_id ia sempre vazio e o POST voltava 400 (RD-98 p1, critério c).
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => {
    let vivo = true
    setForm(f => ({ ...f, unidade_id: '' }))
    setUnidades([])
    if (!companyId) return
    setCarregandoUni(true)
    fetch('/api/industrial/unidades?company_id='+encodeURIComponent(companyId), { credentials:'include' })
      .then(r => r.json())
      .then(d => {
        if (!vivo) return
        const us: Unidade[] = d?.unidades || []
        setUnidades(us)
        if (us.length === 1) setForm(f => ({ ...f, unidade_id: us[0].id })) // única planta: já seleciona
      })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregandoUni(false) })
    return () => { vivo = false }
  }, [companyId])

  async function salvar() {
    if (!form.unidade_id) { setMsg('✗ Escolha a unidade/planta antes de registrar o turno.'); return }
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
    } catch(e:any) { setMsg('✗ '+erroAmigavel(e, 'Não foi possível registrar o turno agora.')) } finally { setLoading(false) }
  }

  const campo = (k: string, l: string, t='number', obrig=false) => (
    <label key={k} className='block'>
      <span className='text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center'>{l}{obrig?' *':''}<AjudaCampo chave={'industria.apontamento.'+k} /></span>
      <input type={t} value={(form as any)[k]} onChange={e=>set(k,e.target.value)}
        className='w-full border rounded px-3 py-2 text-sm' />
    </label>
  )

  const semEmpresa = !companyId
  const semUnidade = !!companyId && !carregandoUni && unidades.length === 0

  return (
    <div className='p-6 max-w-2xl mx-auto space-y-6'>
      <h1 className='text-xl font-bold'>Apontamento de Produção — Bovinos</h1>
      {msg && <div className={'p-3 rounded text-sm '+(msg.startsWith('✓')?'bg-green-50 text-green-800':'bg-red-50 text-red-800')}>{msg}</div>}

      {semEmpresa && (
        <div className='p-3 rounded text-sm bg-amber-50 text-amber-800'>
          Escolha uma <strong>empresa específica</strong> no seletor de empresa, no topo da tela, para apontar a produção (não funciona no consolidado nem em grupo).
        </div>
      )}
      {semUnidade && (
        <div className='p-4 rounded text-sm bg-amber-50 text-amber-900 space-y-1'>
          <div className='font-medium'>Nenhuma unidade/planta cadastrada nesta empresa.</div>
          <div>O apontamento é sempre por unidade (planta/frigorífico). Cadastre ao menos uma unidade da empresa para liberar o apontamento de produção.</div>
        </div>
      )}

      <div className='space-y-4'>
        <label className='block'>
          <span className='text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center'>Unidade / Planta *<AjudaCampo chave='industria.apontamento.unidade_id' /></span>
          <select value={form.unidade_id} onChange={e=>set('unidade_id',e.target.value)}
            disabled={semEmpresa || carregandoUni || unidades.length === 0}
            className='w-full border rounded px-3 py-2 text-sm bg-background disabled:opacity-50'>
            <option value=''>{carregandoUni ? 'Carregando unidades…' : semEmpresa ? 'Escolha uma empresa no topo' : unidades.length === 0 ? 'Nenhuma unidade cadastrada' : 'Selecione a unidade/planta'}</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>

        <div className='grid grid-cols-3 gap-3'>
          <label className='block'>
            <span className='text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center'>Data *<AjudaCampo chave='industria.apontamento.data' /></span>
            <input type='date' value={form.data} onChange={e=>set('data',e.target.value)} className='w-full border rounded px-3 py-2 text-sm'/>
          </label>
          <label className='block'>
            <span className='text-xs text-muted-foreground uppercase tracking-wide mb-1 flex items-center'>Turno *<AjudaCampo chave='industria.apontamento.turno' /></span>
            <select value={form.turno} onChange={e=>set('turno',e.target.value)} className='w-full border rounded px-3 py-2 text-sm bg-background'>
              <option value='A'>A (manhã)</option><option value='B'>B (tarde)</option><option value='C'>C (noite)</option>
            </select>
          </label>
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
          {campo('receita_turno','Receita do turno (integração)')}
        </div>
      </div>

      <button onClick={salvar} disabled={loading || !form.unidade_id}
        className='w-full bg-primary text-primary-foreground py-3 rounded font-medium disabled:opacity-50'>
        {loading ? 'Salvando...' : 'Registrar Turno →'}
      </button>
    </div>
  )
}
