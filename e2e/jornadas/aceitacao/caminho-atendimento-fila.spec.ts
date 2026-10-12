// RD-83 · CAMINHO PRINCIPAL da fila de atendimento (Central de chamados da PS), entregue com a correção "aprovar =
// o chamado anda": abrir a fila, buscar um chamado pelo número e ver o card dele com o status. Só leitura; sem
// migration: roda no preview.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

test.describe('Caminho principal — fila de atendimento', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-atendimento-fila', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('buscar um chamado pelo número mostra o card com o status do banco', async ({ page }) => {
    // ignora chamados de teste de outras specs rodando em paralelo (nascem 'nova' e só são arquivados no fim)
    const [c] = await dbSelect<{ numero: number; titulo: string; status: string }>('sugestoes', `status=neq.arquivada&titulo=not.ilike.Aceita*&user_name=neq.${encodeURIComponent('robô aceitação')}&select=numero,titulo,status&order=numero.desc&limit=1`)
    expect(c, 'há chamados').toBeTruthy()
    await page.goto('/dashboard/atendimento')
    await aguardarConteudo(page)
    await page.getByPlaceholder(/n[uú]mero|buscar/i).first().fill(String(c.numero))
    const card = page.getByText(c.titulo.slice(0, 30), { exact: false }).first()
    await expect(card, 'o chamado buscado aparece').toBeVisible({ timeout: 20000 })
    await expect(page.getByText(c.status.replaceAll('_', ' ')).first(), 'com o status do banco').toBeVisible()
  })
})
