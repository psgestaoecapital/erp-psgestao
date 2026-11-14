'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { useCompanyIds } from '@/lib/useCompanyIds'

type Unidade = { id: string; nome: string }
type Turno = { turno_id: string; data: string; turno: string; unidade_id: string; unidade_nome: string; custo_por_kg: number | null; kg_produzido: number | null; margem_bruta: number | null }

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
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [novaUnidadeNome, setNovaUnidadeNome] = useState('')
  const [criandoUnidade, setCriandoUnidade] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({...f,[k]:v}))

  // Últimos turnos JÁ registrados da empresa (ver o que salvou / corrigir) — RD-98 p2.
  const recarregarTurnos = React.useCallback(() => {
    if (!companyId) { setTurnos([]); return }
    fetch('/api/industrial/bovinos/apontamento?company_id='+encodeURIComponent(companyId), { credentials:'include' })
      .then(r => r.json())
      .then(d => setTurnos(Array.isArray(d?.turnos) ? d.turnos : []))
      .catch(() => {})
  }, [companyId])
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { recarregarTurnos() }, [recarregarTurnos])

  // Carrega um turno salvo no formulário para CORRIGIR (o POST faz upsert por unidade+data+turno).
  const corrigir = (t: Turno) => {
    setForm(f => ({ ...f, unidade_id: t.unidade_id, data: t.data, turno: t.turno }))
    setMsg('✎ Corrigindo o turno '+t.turno+' de '+t.data.split('-').reverse().join('/')+' — revise os números e clique em Registrar para substituir.')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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

  // Cadastro rápido da unidade no próprio estado vazio (critério d do PDCA): quem ainda não tem planta
  // cadastrada cria uma aqui mesmo e já libera o apontamento, sem precisar sair da tela procurar onde cadastrar.
  async function criarUnidade() {
    if (!companyId) { setMsg('✗ Escolha uma empresa específica no topo antes de cadastrar a unidade.'); return }
    const nome = novaUnidadeNome.trim()
    if (!nome) { setMsg('✗ Dê um nome para a unidade/planta antes de cadastrar.'); return }
    setCriandoUnidade(true); setMsg('')
    try {
      const r = await fetch('/api/industrial/unidades', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, nome }),
      })
      const d = await r.json()
      if (!r.ok || !d?.unidade) throw new Error(d?.error)
      const nova: Unidade = { id: d.unidade.id, nome: d.unidade.nome }
      setUnidades(us => [...us, nova].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
      setForm(f => ({ ...f, unidade_id: nova.id }))
      setNovaUnidadeNome('')
      setMsg('✓ Unidade “' + nova.nome + '” cadastrada. Já pode apontar a produção do turno.')
    } catch (e: any) {
      setMsg('✗ ' + erroAmigavel(e, 'Não foi possível cadastrar a unidade agora.'))
    } finally { setCriandoUnidade(false) }
  }

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
      recarregarTurnos()
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
        <div className='p-4 rounded text-sm bg-amber-50 text-amber-900 space-y-3'>
          <div className='space-y-1'>
            <div className='font-medium'>Nenhuma unidade/planta cadastrada nesta empresa.</div>
            <div>O apontamento é sempre por unidade (planta/frigorífico). Cadastre a primeira unidade abaixo para liberar o apontamento de produção.</div>
          </div>
          <div className='flex flex-wrap gap-2 items-end'>
            <label className='flex-1 min-w-[200px] block'>
              <span className='text-xs uppercase tracking-wide flex items-center mb-1'>Nome da unidade / planta<AjudaCampo chave='industria.apontamento.nova_unidade' /></span>
              <input
                value={novaUnidadeNome}
                onChange={e => setNovaUnidadeNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); criarUnidade() } }}
                placeholder='Ex.: Planta Matriz — Abate'
                className='w-full border rounded px-3 py-2 text-sm bg-white' />
            </label>
            <button type='button' onClick={criarUnidade} disabled={criandoUnidade || !novaUnidadeNome.trim()}
              className='rounded px-4 py-2 text-sm font-medium bg-amber-700 text-white disabled:opacity-50'>
              {criandoUnidade ? 'Cadastrando…' : 'Cadastrar unidade'}
            </button>
          </div>
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

      {!!companyId && (
        <div className='space-y-2 pt-2'>
          <div className='flex items-center'>
            <span className='text-xs font-bold text-muted-foreground uppercase tracking-wider'>Últimos turnos registrados</span>
            <AjudaCampo chave='industria.apontamento.ultimos_turnos' />
          </div>
          {turnos.length === 0 ? (
            <div className='text-sm text-muted-foreground p-3 border rounded bg-muted/30'>
              Nenhum turno registrado ainda nesta empresa. Preencha o formulário acima e clique em <strong>Registrar Turno</strong> — os turnos aparecem aqui para conferência e correção.
            </div>
          ) : (
            <table className='w-full text-sm border rounded overflow-hidden'>
              <thead>
                <tr className='bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground'>
                  <th className='px-3 py-2'>Data</th>
                  <th className='px-3 py-2'>Turno</th>
                  <th className='px-3 py-2'>Unidade</th>
                  <th className='px-3 py-2 text-right'>Kg produzido</th>
                  <th className='px-3 py-2 text-right'>Custo/kg</th>
                  <th className='px-3 py-2'></th>
                </tr>
              </thead>
              <tbody>
                {turnos.map(t => (
                  <tr key={t.turno_id} className='border-t'>
                    <td className='px-3 py-2'>{t.data.split('-').reverse().join('/')}</td>
                    <td className='px-3 py-2'>{t.turno}</td>
                    <td className='px-3 py-2'>{t.unidade_nome}</td>
                    <td className='px-3 py-2 text-right'>{t.kg_produzido != null ? t.kg_produzido.toLocaleString('pt-BR') : '—'}</td>
                    <td className='px-3 py-2 text-right'>{t.custo_por_kg != null ? 'R$ '+t.custo_por_kg.toFixed(4) : '—'}</td>
                    <td className='px-3 py-2 text-right'>
                      <button onClick={() => corrigir(t)} className='text-xs text-primary underline underline-offset-2'>Corrigir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
