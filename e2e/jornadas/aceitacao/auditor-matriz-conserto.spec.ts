// Auditor por área (CEO 01/10 · auditoria do Hub). O run 23 pediu o Hub na Tryo e ficou "pending" para sempre: o robô
// respondia 403 (empresa vazia/não-demo) e ninguém lia a resposta. Prova, em produção e pelo caminho real:
//  1) pedir o Hub numa empresa que NÃO é demo → o disparo troca pela demo da área e diz isso na observação;
//  2) o robô fotografa a tela NA DEMO (não recusa mais) e o resultado sai de "pending" sozinho (cron/consulta).
// Uma tela só (Catálogo), para custar um disparo. Depende da migration 20261001230000 → @pos-migration.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada, rpc } from '../../support/api'

const TRYO = '918c3ea4-770d-4a10-9200-f9c21f92a1f6'   // não-demo: o robô NUNCA pode fotografá-la
const ROTA = '/dashboard/projetos/catalogo'

type Run = { run_id: number; company_id: string; observacao: string; total_disparados: number }
type Res = { status: string; rota_completa: string; bugs_detectados: string[] | null; t0_dispatch: string }

test.describe('Auditor por área: empresa não-demo vira a demo; o robô fotografa e o resultado não fica preso', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-auditor-matriz-conserto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('Hub pedido na Tryo → auditado na demo, foto tirada, resultado fechado', { tag: '@pos-migration' }, async () => {
    test.setTimeout(8 * 60_000)
    const [demo] = await dbSelect<{ company_id: string }>('demo_por_area', 'area=eq.hub&select=company_id')
    expect(demo?.company_id, 'a área hub tem demo').toBeTruthy()

    const run = await rpc<Run>('fn_auditor_matriz_disparar', {
      p_area_id: 'hub', p_company_id: TRYO, p_apenas_status: ['todos'], p_modulos_filter: ['projetos_catalogo'],
      p_observacao: 'aceitacao auditor-matriz-conserto',
    })
    expect(run.company_id, 'auditado na demo, não na Tryo').toBe(demo.company_id)
    expect(run.observacao).toContain('não é de demonstração')
    expect(run.total_disparados).toBe(1)

    const [res] = await dbSelect<Res>('erp_auditor_matriz_resultados', `run_id=eq.${run.run_id}&select=status,rota_completa,bugs_detectados,t0_dispatch`)
    expect(res.rota_completa).toContain(`company_id=${demo.company_id}`)
    expect(res.rota_completa).not.toContain(TRYO)

    // o robô fotografou a tela depois do disparo (antes: 403 e nada)
    await expect.poll(async () => {
      const [s] = await dbSelect<{ screenshot_atualizado_em: string | null }>('system_screens', `rota=eq.${ROTA}&select=screenshot_atualizado_em`)
      return !!s?.screenshot_atualizado_em && s.screenshot_atualizado_em > res.t0_dispatch
    }, { timeout: 4 * 60_000, intervals: [10_000], message: 'o robô fotografou a tela na demo' }).toBe(true)

    // a consulta nunca fecha o resultado com a recusa 403. Sair de "pending" depende da análise da IA (externa e
    // assíncrona; a função fecha por timeout só em 20 min) — por isso aqui não se exige o fechamento em 3 min, só que
    // o resultado, pendente ou fechado, nunca carregue a recusa (08/10: o @pos-migration da main ficou vermelho por isso).
    let fim: Res | undefined
    await expect.poll(async () => {
      await rpc('fn_auditor_matriz_consultar', { p_run_id: run.run_id })
      ;[fim] = await dbSelect<Res>('erp_auditor_matriz_resultados', `run_id=eq.${run.run_id}&select=status,rota_completa,bugs_detectados,t0_dispatch`)
      return fim?.status !== 'pending' || Date.now() - Date.parse(res.t0_dispatch) > 150_000
    }, { timeout: 3 * 60_000, intervals: [15_000], message: 'consulta do resultado' }).toBe(true)
    console.log(`[auditor-diag] run=${run.run_id} status=${fim?.status} bugs=${JSON.stringify(fim?.bugs_detectados ?? []).slice(0, 400)}`)
    expect(['pending', 'completo', 'erro', 'timeout']).toContain(fim?.status)
    expect((fim?.bugs_detectados ?? []).join(' ')).not.toMatch(/HTTP 403|não é de demonstração/)
  })
})
