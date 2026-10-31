// Auditor por área (CEO 01/10 · auditoria do Hub). O run 23 pediu o Hub na Tryo e ficou "pending" para sempre: o robô
// respondia 403 (empresa vazia/não-demo). O CONSERTO é a troca RD-69/70: empresa pedida que não é demo → demo da área,
// com a rota auditada na demo (nunca na empresa real) e a observação dizendo isso.
//
// CUSTO (31/10): este spec chamava fn_auditor_matriz_disparar DE VERDADE em produção a cada execução da suíte (82x em
// 48h → 930 análises pagas, ~US$75/US$150 do mês), porque o disparo real aciona a IA (fn_auditor_disparar). NENHUM teste
// pode consumir API paga. Agora valida o conserto em DRY-RUN (p_dry_run): a troca de empresa e a rota são conferidas sem
// acionar a IA e sem gravar resultado (zero custo, request_id_insight jamais criado). Depende da migration do dry-run
// (auditor_matriz_disparar_dry_run) e da de base do auditor → @pos-migration.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada, rpc } from '../../support/api'

const TRYO = '918c3ea4-770d-4a10-9200-f9c21f92a1f6'   // não-demo: o robô NUNCA pode fotografá-la

type Run = { run_id: number; company_id: string; observacao: string; total_disparados: number; dry_run: boolean; custo_estimado_usd: number; rotas_disparadas: Array<{ rota_completa: string }> }
type Res = { status: string; rota_completa: string; request_id_insight: number | null }

test.describe('Auditor por área: empresa não-demo vira a demo (conserto RD-69/70), validado sem custo (dry-run)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-auditor-matriz-conserto', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('Hub pedido na Tryo → trocado pela demo da área, rota na demo, SEM chamada paga', { tag: '@pos-migration' }, async () => {
    test.setTimeout(2 * 60_000)
    const [demo] = await dbSelect<{ company_id: string }>('demo_por_area', 'area=eq.hub&select=company_id')
    expect(demo?.company_id, 'a área hub tem demo').toBeTruthy()

    // DRY-RUN: exercita o conserto (troca RD-69/70 + rota) sem acionar a IA paga
    const run = await rpc<Run>('fn_auditor_matriz_disparar', {
      p_area_id: 'hub', p_company_id: TRYO, p_apenas_status: ['todos'], p_modulos_filter: ['projetos_catalogo'],
      p_observacao: 'aceitacao auditor-matriz-conserto', p_dry_run: true,
    })
    expect(run.dry_run, 'rodou em dry-run').toBe(true)
    expect(run.custo_estimado_usd, 'dry-run não custa').toBe(0)
    expect(run.company_id, 'auditado na demo, não na Tryo').toBe(demo.company_id)
    expect(run.observacao).toContain('não é de demonstração')
    expect(run.observacao).toContain('dry-run')
    expect(run.total_disparados).toBe(1)

    // a rota montada aponta para a demo e nunca para a empresa real
    const rota = run.rotas_disparadas?.[0]?.rota_completa ?? ''
    expect(rota).toContain(`company_id=${demo.company_id}`)
    expect(rota).not.toContain(TRYO)

    // PROVA DE CUSTO ZERO: o dry-run não grava resultado algum (logo, nenhuma chamada paga / request_id_insight)
    const resultados = await dbSelect<Res>('erp_auditor_matriz_resultados', `run_id=eq.${run.run_id}&select=status,rota_completa,request_id_insight`)
    expect(resultados.length, 'dry-run não cria resultado (sem análise paga)').toBe(0)
  })
})
