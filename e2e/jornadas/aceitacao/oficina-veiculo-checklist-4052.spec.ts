// #4052 (Gean/Jordana): o veículo voltou meses depois e a oficina quer consultar o que foi registrado na entrada
// (km, combustível, itens do checklist, avarias, objetos). Tela Oficina › Veículos › placa › "Ver checklist de entrada".
// Migration 20261026210020 (fn_oficina_veiculo_historico devolve o bloco 'recepcao' de cada OS) → @pos-migration.
// Caminho oficial: Demonstração Oficina. O teste cria a SUA OS + recepção com placa própria; tudo removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = Date.now().toString(36)
const PLACA = `T4K${RUN.slice(-4).toUpperCase()}`
const criadas: string[] = []

test.describe('#4052 · histórico do veículo mostra o checklist de entrada de cada passagem', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-oficina-veiculo-checklist-4052', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const limpar = async (f: () => Promise<void>) => { await f().catch(() => {}) }
    for (const osId of criadas) {
      await limpar(() => dbDelete('erp_os_recepcao', `os_id=eq.${osId}`))
      await limpar(() => dbDelete('erp_os', `id=eq.${osId}`))
      const resta = await dbSelect<{ id: string }>('erp_os', `id=eq.${osId}&select=id`).catch(() => [])
      if (resta.length) await limpar(() => dbPatch('erp_os', `id=eq.${osId}`, { excluida: true }))
    }
  })

  test('caminho principal: abrir a placa e ver km, combustível, itens e avarias da entrada', { tag: '@pos-migration' }, async ({ page }) => {
    const os = await dbInsert<{ id: string }>('erp_os', {
      company_id: DEMO_OFICINA, numero: `T4052-${RUN}`, descricao_servico: 'Teste histórico do veículo (#4052)', status: 'entregue',
      cliente_nome: 'Cliente teste #4052', placa: PLACA, marca: 'Teste', modelo: 'Historico', km: 81234,
    })
    criadas.push(os.id)
    await dbInsert('erp_os_recepcao', {
      company_id: DEMO_OFICINA, os_id: os.id, km_entrada: 81234, combustivel: '3_4',
      checklist: { Pneus: 'ok', Retrovisores: 'avaria' }, avarias: `risco na porta ${RUN}`, objetos_veiculo: 'documento no porta-luvas', fotos: [],
    })

    await page.addInitScript((cid) => { try { window.localStorage.setItem('ps_empresa_sel', cid) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/veiculos')
    await aguardarConteudo(page)
    await page.getByPlaceholder('Placa ou cliente…').fill(PLACA)
    await page.getByPlaceholder('Placa ou cliente…').press('Enter')
    await page.getByRole('button', { name: new RegExp(PLACA) }).click()

    await page.getByRole('button', { name: /Ver checklist de entrada/ }).click()
    await expect(page.getByText('81.234 km').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('3/4')).toBeVisible()
    await expect(page.getByText('Pneus: OK')).toBeVisible()
    await expect(page.getByText('Retrovisores: avaria')).toBeVisible()
    await expect(page.getByText(`risco na porta ${RUN}`)).toBeVisible()
    await expect(page.getByText('documento no porta-luvas')).toBeVisible()
  })
})
