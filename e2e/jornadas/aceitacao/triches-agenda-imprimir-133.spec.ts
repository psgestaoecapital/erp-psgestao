// Triches #133 · "opção de impressão de agenda para as mecânicas que não trabalham com tablet — semanal ou
// individualmente". A agenda da oficina ganha o botão Imprimir (dia ou semana visível) e o seletor de mecânico; a folha
// de impressão só aparece no papel, com os agendamentos por horário (cancelados ficam de fora).
// Demonstração Oficina, nunca empresa real. Agendamentos de teste excluídos (soft) no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const MEC_A = `Mecanico A ${RUN}`
const MEC_B = `Mecanico B ${RUN}`
const hoje = new Date().toISOString().slice(0, 10) // o mesmo "hoje" da tela (iso(new Date()))

test.describe('Agenda da oficina — imprimir semana/dia, todos ou por mecânico (#133)', () => {
  const criados: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-133-agenda-imprimir', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_agendamento', `id=eq.${id}`, { excluido_em: new Date().toISOString(), excluido_motivo: 'aceitação #133' })
  })

  test('a folha individual traz só o mecânico escolhido, por horário, sem os cancelados', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    for (const [cli, mec, hora, status] of [
      [`Cliente A1 ${RUN}`, MEC_A, '14:00', 'agendado'], [`Cliente A2 ${RUN}`, MEC_A, '08:00', 'confirmado'],
      [`Cliente B1 ${RUN}`, MEC_B, '09:00', 'agendado'], [`Cliente A3 ${RUN}`, MEC_A, '10:00', 'cancelado'],
    ] as const) {
      criados.push((await dbInsert<{ id: string }>('erp_agendamento', {
        company_id: DEMO_OFICINA, origem_modulo: 'oficina', cliente_nome: cli, responsavel_nome: mec, data: hoje, hora_inicio: hora, status,
        dados: { placa: 'ABC1D23', veiculo: 'Carro de teste' },
      })).id)
    }

    await page.addInitScript((id) => {
      try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ }
      ;(window as unknown as { __impressoes: number }).__impressoes = 0
      window.print = () => { (window as unknown as { __impressoes: number }).__impressoes++ }
    }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/agenda')
    await aguardarConteudo(page)
    await expect(page.getByText(`Cliente A1 ${RUN}`).first()).toBeVisible({ timeout: 20000 })

    await page.getByTestId('agenda-imp-mecanico').selectOption(MEC_A)
    const folha = page.getByTestId('agenda-folha')
    await expect(folha, 'a folha não aparece na tela').toBeHidden()
    const texto = (await folha.textContent()) ?? ''
    expect(texto).toContain(`Mecânico: ${MEC_A}`)
    expect(texto.indexOf(`Cliente A2 ${RUN}`), 'por horário: 08:00 antes de 14:00').toBeLessThan(texto.indexOf(`Cliente A1 ${RUN}`))
    expect(texto, 'outro mecânico não sai na folha individual').not.toContain(`Cliente B1 ${RUN}`)
    expect(texto, 'cancelado não sai na folha').not.toContain(`Cliente A3 ${RUN}`)

    await page.getByTestId('agenda-imprimir').click()
    expect(await page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes), 'o botão manda imprimir').toBe(1)
  })
})
