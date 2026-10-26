// #4052 (Gean) · Oficina → Veículos: o histórico do veículo mostra o CHECKLIST DE ENTRADA de cada passagem (km,
// combustível, itens conferidos, avarias, objetos, observações), lido de erp_os_recepcao. A migration só entra no
// merge, então as respostas das RPCs da tela são simuladas (o preview roda contra o banco atual). Demonstração Oficina.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const PLACA = 'E2E4A52'

const historico = {
  veiculo: { placa: PLACA, cliente_nome: 'Cliente E2E', cliente_id: null, marca: 'VW', modelo: 'Gol', ano: 2015, chassi: null, ultimo_km: 84320, os_count: 2 },
  os: [
    { id: 'os-e2e-1', numero: 'OS-E2E-0002', status: 'entregue', data: '2026-10-20', km: 84320, tecnico_nome: 'Mecânico E2E',
      defeito_relatado: 'Barulho na suspensão', diagnostico: null, pecas_utilizadas: null, total: 350, itens_count: 0, valor_aprovado: null,
      entrada: { registrado_em: '2026-10-20T11:05:00Z', km_entrada: 84320, combustivel: 'meio',
        checklist: { Pneus: 'ok', Estepe: 'ok', Retrovisores: 'avaria' }, avarias: 'Risco na porta traseira esquerda',
        objetos_veiculo: 'Cadeirinha infantil', observacoes: 'Cliente pediu para guardar a peça trocada', fotos_count: 2 } },
    { id: 'os-e2e-2', numero: 'OS-E2E-0001', status: 'entregue', data: '2026-08-12', km: 80100, tecnico_nome: null,
      defeito_relatado: null, diagnostico: null, pecas_utilizadas: null, total: null, itens_count: 0, valor_aprovado: null, entrada: null },
  ],
  km_evolucao: [{ data: '2026-08-12', km: 80100 }, { data: '2026-10-20', km: 84320 }],
}

test.describe('#4052 · histórico do veículo com o checklist de entrada', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-4052-veiculo-checklist-entrada', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abre o veículo → "Ver checklist de entrada" mostra km, combustível, itens, avarias e objetos', async ({ page }) => {
    await page.route(/\/rest\/v1\/rpc\/fn_oficina_veiculos_listar/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ placa: PLACA, cliente_nome: 'Cliente E2E', marca: 'VW', modelo: 'Gol', ano: 2015, ultimo_km: 84320, os_count: 2, ultima_data: '2026-10-20' }]),
    }))
    await page.route(/\/rest\/v1\/rpc\/fn_oficina_veiculo_historico/, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(historico) }))
    await page.route(/\/rest\/v1\/rpc\/fn_oficina_veiculo_contatos/, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]' }))

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/veiculos')
    await aguardarConteudo(page)

    await page.getByRole('button', { name: new RegExp(PLACA) }).click()
    const ver = page.getByTestId('veic-entrada-OS-E2E-0002')
    await expect(ver).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('veic-entrada-detalhe'), 'fechado até tocar').toHaveCount(0)
    await expect(page.getByText('Sem checklist de entrada nesta passagem.'), 'OS sem recepção avisa').toBeVisible()

    await ver.click()
    const det = page.getByTestId('veic-entrada-detalhe')
    await expect(det).toBeVisible()
    await expect(det).toContainText('84.320 km')
    await expect(det).toContainText('½ tanque')
    await expect(det).toContainText('Retrovisores: avaria')
    await expect(det).toContainText('Risco na porta traseira esquerda')
    await expect(det).toContainText('Cadeirinha infantil')
    await expect(det).toContainText('2 foto(s)')

    await ver.click()
    await expect(det, 'toque de novo fecha').toHaveCount(0)
  })
})
