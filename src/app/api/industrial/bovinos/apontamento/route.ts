import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST — registra apontamento de produção do turno
export const POST = withAuth(async (req: NextRequest, { user }) => {
  const body = await req.json()
  const {
    unidade_id, data, turno,
    cabecas_abatidas, peso_total_kg, rendimento_pct,
    horas_efetivas, meta_cab_turno, paradas_min, operadores,
    // Qualidade
    condenados_total, ph_medio, ph_min, ph_max, temp_camara_c, causas_json,
    // Custo
    custo_animal, custo_mo, custo_energia, custo_insumos, custo_outros,
    // Financeiro
    receita_turno,
  } = body

  if (!unidade_id || !data || !turno)
    return NextResponse.json({ error: 'unidade_id, data e turno são obrigatórios' }, { status: 400 })

  // Upsert do turno
  const { data: turnoRec, error: errTurno } = await supabaseAdmin
    .from('ind_turnos')
    .upsert({ unidade_id, data, turno, supervisor: user.email }, { onConflict: 'unidade_id,data,turno' })
    .select().single()
  if (errTurno) return NextResponse.json({ error: errTurno.message }, { status: 400 })

  const turno_id = turnoRec.id
  const kg = peso_total_kg || (cabecas_abatidas * 280) // estimativa se não informado

  // Apontamento
  await supabaseAdmin.from('ind_apontamentos_bovinos').upsert({
    turno_id, unidade_id, cabecas_abatidas: cabecas_abatidas||0,
    peso_total_kg: kg, rendimento_pct: rendimento_pct||0,
    horas_efetivas: horas_efetivas||8, meta_cab_turno: meta_cab_turno||0,
    paradas_min: paradas_min||0, operadores: operadores||0,
  }, { onConflict: 'turno_id' })

  // Qualidade
  const cond_pct = cabecas_abatidas > 0 ? (condenados_total||0)/cabecas_abatidas*100 : 0
  const custo_cond = (condenados_total||0) * ((custo_animal||0) / Math.max(cabecas_abatidas,1))
  await supabaseAdmin.from('ind_qualidade_sif').upsert({
    turno_id, unidade_id,
    condenados_total: condenados_total||0, condenados_pct: cond_pct,
    ph_medio: ph_medio||null, ph_min: ph_min||null, ph_max: ph_max||null,
    carcacas_fora_ph: 0, temp_camara_c: temp_camara_c||null,
    custo_condenacao: custo_cond, causas_json: causas_json||[],
  }, { onConflict: 'turno_id' })

  // Custo do turno
  const custo_total_calc = (custo_animal||0)+(custo_mo||0)+(custo_energia||0)+(custo_insumos||0)+(custo_outros||0)
  const custo_kg = kg > 0 ? custo_total_calc/kg : 0
  const margem = (receita_turno||0) - custo_total_calc
  await supabaseAdmin.from('ind_custos_turno').upsert({
    turno_id, unidade_id,
    custo_animal: custo_animal||0, custo_mo: custo_mo||0,
    custo_energia: custo_energia||0, custo_insumos: custo_insumos||0,
    custo_outros: custo_outros||0, custo_por_kg: custo_kg,
    receita_turno: receita_turno||0, margem_bruta: margem, kg_produzido: kg,
  }, { onConflict: 'turno_id' })

  // Recalcula KPI diário
  await recalcularKpiDiario(unidade_id, data)

  return NextResponse.json({ success: true, turno_id, custo_kg, margem })
})

async function recalcularKpiDiario(unidade_id: string, data: string) {
  const { data: turnos } = await supabaseAdmin
    .from('ind_turnos').select('id').eq('unidade_id', unidade_id).eq('data', data)
  const ids = (turnos||[]).map((t:any)=>t.id)
  if (!ids.length) return

  const [{ data: apts }, { data: qualidades }, { data: custos }] = await Promise.all([
    supabaseAdmin.from('ind_apontamentos_bovinos').select('*').in('turno_id', ids),
    supabaseAdmin.from('ind_qualidade_sif').select('*').in('turno_id', ids),
    supabaseAdmin.from('ind_custos_turno').select('*').in('turno_id', ids),
  ])

  const cabecas = (apts||[]).reduce((s:number,a:any)=>s+(a.cabecas_abatidas||0),0)
  const kg_total = (apts||[]).reduce((s:number,a:any)=>s+(a.peso_total_kg||0),0)
  const receita = (custos||[]).reduce((s:number,c:any)=>s+(c.receita_turno||0),0)
  const custo_total = (custos||[]).reduce((s:number,c:any)=>s+((c.custo_total)||0),0)
  const custo_mo_total = (custos||[]).reduce((s:number,c:any)=>s+(c.custo_mo||0),0)
  const cond_total = (qualidades||[]).reduce((s:number,q:any)=>s+(q.condenados_total||0),0)
  const custo_cond = (qualidades||[]).reduce((s:number,q:any)=>s+(q.custo_condenacao||0),0)
  const ph_values = (qualidades||[]).filter((q:any)=>q.ph_medio).map((q:any)=>q.ph_medio)
  const ebitda = receita - custo_total
  const margem_pct = receita > 0 ? (ebitda/receita*100) : 0
  const horas = (apts||[]).reduce((s:number,a:any)=>s+(a.horas_efetivas||0),0)
  const paradas = (apts||[]).reduce((s:number,a:any)=>s+(a.paradas_min||0),0)
  const oee = horas > 0 ? Math.max(0, Math.min(100, ((horas*60-paradas)/(horas*60))*100)) : 0

  await supabaseAdmin.from('ind_kpis_diarios').upsert({
    unidade_id, data,
    cabecas_dia: cabecas, toneladas_dia: kg_total/1000, peso_medio_kg: cabecas>0?kg_total/cabecas:0,
    rendimento_pct: (apts||[]).length>0?(apts||[]).reduce((s:number,a:any)=>s+(a.rendimento_pct||0),0)/(apts||[]).length:0,
    oee_pct: oee,
    custo_kg_total: kg_total>0?custo_total/kg_total:0,
    custo_mo_kg: kg_total>0?custo_mo_total/kg_total:0,
    cmv_pct: receita>0?custo_total/receita*100:0,
    condenacao_pct: cabecas>0?cond_total/cabecas*100:0,
    ph_medio: ph_values.length>0?ph_values.reduce((a:number,b:number)=>a+b,0)/ph_values.length:null,
    custo_condenacao: custo_cond,
    receita_dia: receita, ebitda_dia: ebitda, margem_pct,
    calculado_em: new Date().toISOString(),
  }, { onConflict: 'unidade_id,data' })
}
