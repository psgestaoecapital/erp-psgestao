// #134 (Gean) · quando o cliente aprova o orçamento, a OS passa sozinha para "Aprovada" (antes ficava parada em
// "aguardando aprovação" até alguém trocar à mão). Aprovação parcial também vira "Aprovada" — há item a executar —
// e a OS mostra o alerta dos itens recusados. Migration 20260927210000 (gatilho em erp_os_aprovacao).
// Caminho oficial: a tela Aprovação do Cliente, na Demonstração Oficina; tudo removido no fim.
// Cada teste cria a SUA OS e registra a aprovação pela tela: o veredito de produção roda só os @pos-migration
// (--grep), então nenhum teste pode depender de outro ter rodado antes (foi o vermelho do 1º merge).

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${Date.now().toString(36)}`
const criadas: string[] = []

// OS "aguardando aprovação" com 2 itens: o 1º sem decisão (a tela sugere "Fazer"), o 2º já recusado → PARCIAL (1/2)
async function criarOS(sufixo: string): Promise<{ id: string; numero: string; itemOk: string }> {
  const numero = `APR-${RUN}${sufixo}`
  const itemOk = `Troca de óleo ${RUN}${sufixo}`
  const id = (await dbInsert<{ id: string }>('erp_os', {
    company_id: DEMO_OFICINA, numero, descricao_servico: 'Orçamento de teste (#134)', status: 'aguardando_aprovacao',
    cliente_nome: 'Cliente teste #134', placa: 'TST1A34', marca: 'Teste', modelo: 'Aprovação',
  })).id
  criadas.push(id)
  await dbInsert('erp_os_diagnostico_item', {
    company_id: DEMO_OFICINA, os_id: id, descricao: itemOk, tipo: 'servico', quantidade: 1, preco: 120, severidade: 'media',
  })
  await dbInsert('erp_os_diagnostico_item', {
    company_id: DEMO_OFICINA, os_id: id, descricao: `Alinhamento ${RUN}${sufixo}`, tipo: 'servico', quantidade: 1, preco: 80, aprovado: false, severidade: 'baixa',
  })
  return { id, numero, itemOk }
}

async function registrarAprovacaoPelaTela(page: Page, numero: string, itemOk: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
  await page.goto('/dashboard/oficina/aprovacao')
  await aguardarConteudo(page)
  await page.getByText(numero).first().click()
  await expect(page.getByText(itemOk)).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: /Registrar aprovação \(1\/2\)/ }).click()
  await expect(page.getByText(/1 item recusado pelo cliente/)).toBeVisible({ timeout: 15000 })
}

test.describe('OS vira "Aprovada" quando o cliente aprova (#134)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-os-status-aprovada', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const limpar = async (f: () => Promise<void>) => { await f().catch(() => {}) }
    for (const osId of criadas) {
      await limpar(() => dbDelete('erp_os_aprovacao', `os_id=eq.${osId}`))
      await limpar(() => dbDelete('erp_os_diagnostico_item', `os_id=eq.${osId}`))
      await limpar(() => dbDelete('erp_os', `id=eq.${osId}`))
      // se a OS não puder ser apagada (FK de auditoria), some da demo como excluída
      const resta = await dbSelect<{ id: string }>('erp_os', `id=eq.${osId}&select=id`).catch(() => [])
      if (resta.length) await limpar(() => dbPatch('erp_os', `id=eq.${osId}`, { excluida: true }))
    }
  })

  test('Aprovação do Cliente registra a aprovação parcial e avisa o item recusado', async ({ page }) => {
    const os = await criarOS('a')
    await registrarAprovacaoPelaTela(page, os.numero, os.itemOk)

    const [aprov] = await dbSelect<{ decisao: string; itens_aprovados: number; itens_total: number }>('erp_os_aprovacao',
      `os_id=eq.${os.id}&select=decisao,itens_aprovados,itens_total&order=created_at.desc&limit=1`)
    expect(aprov?.decisao, 'decisão registrada').toBe('parcial')
    expect(aprov?.itens_aprovados).toBe(1)
    expect(aprov?.itens_total).toBe(2)
  })

  test('a OS passa para "Aprovada" e a ficha avisa o item recusado', { tag: '@pos-migration' }, async ({ page }) => {
    const os = await criarOS('b')
    await registrarAprovacaoPelaTela(page, os.numero, os.itemOk)

    const [row] = await dbSelect<{ status: string }>('erp_os', `id=eq.${os.id}&select=status`)
    expect(row?.status, 'status atribuído pela aprovação do cliente').toBe('aprovada')

    await page.goto('/dashboard/os')
    await aguardarConteudo(page)
    const linha = page.getByTestId('os-row').filter({ hasText: os.numero })
    await expect(linha).toBeVisible({ timeout: 20000 })
    await linha.getByTestId('os-editar').click()
    await expect(page.getByTestId('os-status-select')).toHaveValue('aprovada')
    await expect(page.getByTestId('os-aviso-recusados')).toContainText('1 item recusado')
  })
})
