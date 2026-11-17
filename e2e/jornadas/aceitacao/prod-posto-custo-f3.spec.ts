// RD-82 (@pos-migration) · Tarefa b759a587 / F3 (custeio por kg — custos do posto, CEO 11/11).
// fn_prod_posto_custo_salvar passa a aceitar GÁS, MANUTENÇÃO e DEPRECIAÇÃO (aditivo, RD-97) além do
// que já existia (energia/água/vapor/frio/ar comprimido/outros). Prova, como USUÁRIO real (robô),
// que os 3 custos novos são gravados em prod_posto_custo. Usa um posto DESCARTÁVEL na DEMO Indústria
// (RD-69) e apaga tudo o que criou no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbDelete, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000005' // Indústria Modelo - DEMO

type Salvar = { ok?: boolean; id?: string; erro?: string }
type Posto = { ok?: boolean; id?: string; erro?: string }
type Custo = { id: string; gas_mes: string | null; manutencao_mes: string | null; depreciacao_mes: string | null; energia_mes: string | null }

test.describe('Aceitação b759a587/F3 — custos do posto ganham gás, manutenção e depreciação', () => {
  let setorId = ''
  let plantId = ''
  let postoId = ''
  const numero = 'F3-CUSTO-' + Date.now()

  test.beforeAll(async () => {
    const setor = (await dbSelect<{ id: string; plant_id: string }>('prod_setor',
      `company_id=eq.${DEMO}&plant_id=not.is.null&select=id,plant_id&limit=1`))[0]
    setorId = setor?.id ?? ''
    plantId = setor?.plant_id ?? ''
  })

  test.afterAll(async ({}, testInfo) => {
    if (postoId) {
      await dbDelete('prod_posto_custo', `posto_id=eq.${postoId}`)
      await dbDelete('prod_posto', `id=eq.${postoId}`)
    }
    await registrarJornada('aceitacao-prod-posto-custo-f3-b759a587',
      testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('grava gás/manutenção/depreciação junto dos custos já existentes', { tag: '@pos-migration' }, async () => {
    expect(setorId, 'a DEMO Indústria precisa ter ao menos um setor com planta').not.toBe('')

    const novo = await rpcComoRobo<Posto>('fn_prod_posto_salvar',
      { p_dados: { company_id: DEMO, plant_id: plantId, setor_id: setorId, numero, atividade: 'Posto de teste F3' }, p_user: null })
    expect(novo.corpo?.ok, `criar posto: ${novo.corpo?.erro ?? novo.texto}`).toBe(true)
    postoId = novo.corpo?.id ?? ''
    expect(postoId).not.toBe('')

    const r = await rpcComoRobo<Salvar>('fn_prod_posto_custo_salvar',
      { p_dados: { posto_id: postoId, mao_obra_mes: '5000', energia_mes: '800', gas_mes: '300', manutencao_mes: '450', depreciacao_mes: '200' } })
    expect(r.corpo?.ok, `salvar custo: ${r.corpo?.erro ?? r.texto}`).toBe(true)

    const custo = (await dbSelect<Custo>('prod_posto_custo',
      `posto_id=eq.${postoId}&deleted_at=is.null&select=id,gas_mes,manutencao_mes,depreciacao_mes,energia_mes`))[0]
    expect(custo, 'o custo gravado deve existir').toBeTruthy()
    expect(Number(custo.gas_mes), 'gás gravado').toBe(300)
    expect(Number(custo.manutencao_mes), 'manutenção gravada').toBe(450)
    expect(Number(custo.depreciacao_mes), 'depreciação gravada').toBe(200)
    expect(Number(custo.energia_mes), 'energia (campo antigo) preservado').toBe(800)
  })
})
