// Indústria · Produtividade pelo MIX de entrada (CEO 25/11). Prova COMO USUÁRIO (RD-82) que o posto de uma raia tem
// horas padrão = entrada da raia × tempo padrão do posto, horas reais = ponto das pessoas escaladas, e produtividade =
// padrão ÷ real. Também que, sem tempo padrão / sem escala / sem entrada, aparece o motivo em vez de zero.
// Migration 20261127120110 → @pos-migration. Roda na DEMO Indústria; limpa tudo no afterAll.
import { test, expect } from '../../support/fixtures'
import { rpcComoRobo, dbSelect, dbInsert, dbInsertMany, dbDelete } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000005'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const M = `Z${RUN}` // marcador deste run

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpcComoRobo<T>(fn, args)
  if (r.status < 200 || r.status >= 300) throw new Error(`rpc ${fn} falhou: ${r.status} ${r.texto}`)
  return r.corpo as T
}
const diaISO = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return `${d.toISOString().slice(0, 10)}T00:00:00.000Z` }
const diaData = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

type Posto = { posto_nome: string; seg_por_kg: number | null; horas_padrao: number | null; horas_reais: number | null; produtividade_pct: number | null; kg_por_homem_hora: number | null; status: string }
type Raia = { fluxo_nome: string; entrada_kg: number | null; saida_kg: number | null; fonte: string | null; postos: Posto[] }
type Resp = { ok: boolean; raias: Raia[] }

test.describe('Indústria · produtividade pelo mix de entrada', { tag: '@pos-migration' }, () => {
  let plant = '', setor = ''
  const ids: Record<string, string> = {}
  const cpf = `${M}CPF`

  test.beforeAll(async () => {
    const [pl] = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO}&select=id&limit=1`)
    expect(pl, 'a DEMO Indústria tem planta').toBeTruthy()
    plant = pl.id
    const [sf] = await dbSelect<{ setor_id: string }>('prod_fluxo', `company_id=eq.${DEMO}&setor_id=not.is.null&select=setor_id&limit=1`)
    expect(sf, 'há um setor na DEMO').toBeTruthy()
    setor = sf.setor_id

    ids.fluxo = (await dbInsert<{ id: string }>('prod_fluxo', { company_id: DEMO, plant_id: plant, setor_id: setor, nome: `${M}_raia`, ativo: true })).id
    ids.o = (await dbInsert<{ id: string }>('prod_produto', { company_id: DEMO, plant_id: plant, codigo: `${M}O`, nome: `prod ${M}O`, papel: 'intermediario', chave_externa: `${M}O`, ativo: true })).id
    ids.c = (await dbInsert<{ id: string }>('prod_produto', { company_id: DEMO, plant_id: plant, codigo: `${M}C`, nome: `prod ${M}C`, papel: 'acabado', chave_externa: `${M}C`, preco_venda_ref: 10, ativo: true })).id
    await dbInsert('prod_estrutura', { company_id: DEMO, plant_id: plant, origem_produto_id: ids.o, produto_id: ids.c, fluxo_id: ids.fluxo, tipo_saida: 'principal', rendimento_padrao_pct: 30, fonte_padrao: 'manual', status: 'validado', ativo: true })
    ids.posto = (await dbInsert<{ id: string }>('prod_posto', { company_id: DEMO, plant_id: plant, setor_id: setor, numero: `${M}P`, atividade: 'Serra', ativo: true })).id
    ids.etapa = (await dbInsert<{ id: string }>('prod_fluxo_etapa', { company_id: DEMO, plant_id: plant, fluxo_id: ids.fluxo, posto_id: ids.posto, ordem: 1, nome: `${M}E`, tipo: 'manual' })).id
    ids.tarefa = (await dbInsert<{ id: string }>('prod_tarefa', { company_id: DEMO, plant_id: plant, etapa_id: ids.etapa, ordem: 1, nome: `${M}T`, ativo: true })).id
    // seg_por_kg é coluna gerada (tempo_seg / peso_kg): 36 / 1 = 36 s/kg
    await dbInsert('prod_tarefa_tempo', { company_id: DEMO, plant_id: plant, tarefa_id: ids.tarefa, tempo_seg: 36, peso_kg: 1 })
    await dbInsert('prod_posto_pessoa', { company_id: DEMO, plant_id: plant, posto_id: ids.posto, cpf, vigencia_inicio: diaData(40) })
    await dbInsert('ind_ponto_dia', { company_id: DEMO, plant_id: plant, cpf, data: diaData(5), worked_seconds: 7200 }) // 2 h
    await dbInsertMany('ind_atak_fato', [
      { company_id: DEMO, dominio: 'producao_frigorifico', chave_fato: `E2E${RUN}e`, raw: { PERFIL_TMV: 'PCP0301', COD_TIPO_MV: 'F630', COD_PRODUTO: `${M}O`, QTDE_KG: 100, DATA_ESTOQUE: diaISO(5) } },
      { company_id: DEMO, dominio: 'producao_frigorifico', chave_fato: `E2E${RUN}s`, raw: { PERFIL_TMV: 'PCP0302', COD_TIPO_MV: 'F621', COD_PRODUTO: `${M}C`, QTDE_KG: 70, DATA_ESTOQUE: diaISO(5) } },
    ])
  })

  test.afterAll(async () => {
    await dbDelete('ind_atak_fato', `company_id=eq.${DEMO}&chave_fato=like.E2E${RUN}*`).catch(() => {})
    await dbDelete('ind_ponto_dia', `company_id=eq.${DEMO}&cpf=eq.${cpf}`).catch(() => {})
    await dbDelete('prod_posto_pessoa', `company_id=eq.${DEMO}&cpf=eq.${cpf}`).catch(() => {})
    if (ids.tarefa) await dbDelete('prod_tarefa_tempo', `company_id=eq.${DEMO}&tarefa_id=eq.${ids.tarefa}`).catch(() => {})
    if (ids.etapa) await dbDelete('prod_tarefa', `company_id=eq.${DEMO}&etapa_id=eq.${ids.etapa}`).catch(() => {})
    if (ids.fluxo) await dbDelete('prod_fluxo_etapa', `company_id=eq.${DEMO}&fluxo_id=eq.${ids.fluxo}`).catch(() => {})
    if (ids.c) await dbDelete('prod_estrutura', `company_id=eq.${DEMO}&produto_id=eq.${ids.c}`).catch(() => {})
    if (ids.posto) await dbDelete('prod_posto', `company_id=eq.${DEMO}&id=eq.${ids.posto}`).catch(() => {})
    for (const k of ['o', 'c']) if (ids[k]) await dbDelete('prod_produto', `company_id=eq.${DEMO}&id=eq.${ids[k]}`).catch(() => {})
    if (ids.fluxo) await dbDelete('prod_fluxo', `company_id=eq.${DEMO}&id=eq.${ids.fluxo}`).catch(() => {})
  })

  test('posto: horas padrão × horas reais = produtividade, e kg por homem-hora', async () => {
    const r = await rpc<Resp>('fn_prod_produtividade_mix', { p_company_id: DEMO, p_plant_id: plant, p_data_ini: diaData(10), p_data_fim: diaData(0) })
    expect(r.ok).toBe(true)
    const raia = r.raias.find((x) => x.fluxo_nome === `${M}_raia`)!
    expect(raia, 'a raia de teste aparece').toBeTruthy()
    expect(raia.entrada_kg).toBe(100)
    expect(raia.saida_kg).toBe(70)
    expect(raia.fonte).toBe('sistema_vinculado')
    const p = raia.postos.find((x) => x.posto_nome.includes(`${M}P`))!
    expect(Number(p.seg_por_kg)).toBeCloseTo(36, 2)
    expect(Number(p.horas_padrao)).toBeCloseTo(1, 2)   // 100 kg × 36 s/kg ÷ 3600
    expect(Number(p.horas_reais)).toBeCloseTo(2, 2)     // 7200 s ÷ 3600
    expect(Number(p.produtividade_pct)).toBeCloseTo(50, 1)
    expect(Number(p.kg_por_homem_hora)).toBeCloseTo(35, 1) // 70 kg ÷ 2 h
    expect(p.status).toBe('ok')
  })

  test('sem escala → motivo "sem_escala" (não zero)', async () => {
    // tira a escala do posto e confirma que o motivo aparece
    await dbDelete('prod_posto_pessoa', `company_id=eq.${DEMO}&cpf=eq.${cpf}`)
    const r = await rpc<Resp>('fn_prod_produtividade_mix', { p_company_id: DEMO, p_plant_id: plant, p_data_ini: diaData(10), p_data_fim: diaData(0) })
    const p = r.raias.find((x) => x.fluxo_nome === `${M}_raia`)!.postos.find((x) => x.posto_nome.includes(`${M}P`))!
    expect(p.status).toBe('sem_escala')
    expect(p.horas_reais).toBeNull()
    expect(p.produtividade_pct).toBeNull()
    // repõe para o afterAll não depender da ordem
    await dbInsert('prod_posto_pessoa', { company_id: DEMO, plant_id: plant, posto_id: ids.posto, cpf, vigencia_inicio: diaData(40) })
  })
})
