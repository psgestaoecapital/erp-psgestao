// Fila PSGC sem starvation (Eng. Chefe + CEO 02/10). Migration 20261002210000 · @pos-migration.
// Na "Comércio (GE) - DEMO" (RD-69):
//   1) atualizar um título SEM mudar campo da DRE (só ultima_sync, como o ETL Omie faz a cada 5 min) não cria job;
//   2) mudar o valor enfileira o recálculo da DRE daquele mês (e o valor volta ao original no fim);
//   3) o vigia da fila responde (ok + tipos parados) — é o que entra no briefing.

import { test, expect } from '../../support/fixtures'
import { dbPatch, dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
type Titulo = { id: string; valor: number; data_emissao: string }
type Job = { id: number; tipo: string; ano: number; mes: number; status: string; completed_at: string | null }

test.describe('Fila PSGC — só enfileira o que muda a DRE; vigia de tipo parado', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-psgc-fila', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('update sem mudança não enfileira; mudança de valor enfileira', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [t] = await dbSelect<Titulo>('erp_pagar',
      `company_id=eq.${DEMO_GE}&data_emissao=not.is.null&deleted_at=is.null&select=id,valor,data_emissao&order=id&limit=1`)
    expect(t, 'a demo tem título a pagar').toBeTruthy()
    const d = new Date(String(t.data_emissao).slice(0, 10) + 'T12:00:00Z')
    const ano = d.getUTCFullYear(), mes = d.getUTCMonth() + 1
    const ultimoId = async () => (await dbSelect<{ id: number }>('psgc_job_queue', `select=id&order=id.desc&limit=1`))[0]?.id ?? 0

    // 1) só ultima_sync (o que o ETL Omie faz): nenhuma linha nova na fila
    const antes = await ultimoId()
    await dbPatch('erp_pagar', `id=eq.${t.id}`, { ultima_sync: new Date().toISOString() })
    const novos = await dbSelect<Job>('psgc_job_queue', `company_id=eq.${DEMO_GE}&id=gt.${antes}&select=id,tipo,ano,mes,status,completed_at`)
    expect(novos.length, 'update sem mudança de DRE não cria job').toBe(0)

    // 2) mudança de valor: recálculo da DRE do mês fica na fila (ou já foi feito pelo worker)
    const t0 = new Date(Date.now() - 2000).toISOString()
    try {
      await dbPatch('erp_pagar', `id=eq.${t.id}`, { valor: Number(t.valor) + 0.01 })
      const dre = await dbSelect<Job>('psgc_job_queue',
        `company_id=eq.${DEMO_GE}&tipo=eq.recalcular_dre_mes&ano=eq.${ano}&mes=eq.${mes}&or=(status.in.(pendente,processando),completed_at.gte.${t0})&select=id,tipo,ano,mes,status,completed_at`)
      expect(dre.length, `mudar o valor enfileira a DRE de ${mes}/${ano}`).toBeGreaterThan(0)
    } finally {
      await dbPatch('erp_pagar', `id=eq.${t.id}`, { valor: Number(t.valor) })
    }
  })

  test('vigia da fila responde (entra no briefing)', { tag: '@pos-migration' }, async () => {
    const v = await rpc<{ ok: boolean; parados: unknown[]; pendentes_total: number }>('fn_psgc_fila_vigiar', {})
    expect(typeof v.ok, 'vigia devolve ok').toBe('boolean')
    expect(Array.isArray(v.parados), 'vigia lista os tipos parados').toBe(true)
    expect(v.ok, `nenhum tipo de job parado há mais de 1 h: ${JSON.stringify(v.parados)}`).toBe(true)
  })
})
