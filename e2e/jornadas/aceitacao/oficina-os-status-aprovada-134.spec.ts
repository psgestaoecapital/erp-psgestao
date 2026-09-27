// #134 (Gean) · quando o cliente aprova o orçamento, a OS passa sozinha para "Aprovada" (antes ficava parada em
// "aguardando aprovação" até alguém trocar à mão). Aprovação parcial também vira "Aprovada" — há item a executar —
// e a OS mostra o alerta dos itens recusados. Migration 20260927210000 (gatilho em erp_os_aprovacao).
// Caminho oficial: a tela Aprovação do Cliente, numa OS criada pelo teste na Demonstração Oficina; tudo removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${Date.now().toString(36)}`
const NUMERO = `APR-${RUN}`
const ITEM_OK = `Troca de óleo ${RUN}`
const ITEM_NAO = `Alinhamento ${RUN}`

test.describe('OS vira "Aprovada" quando o cliente aprova (#134)', () => {
  test.describe.configure({ mode: 'serial' })
  let osId = ''

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    osId = (await dbInsert<{ id: string }>('erp_os', {
      company_id: DEMO_OFICINA, numero: NUMERO, descricao_servico: 'Orçamento de teste (#134)', status: 'aguardando_aprovacao',
      cliente_nome: 'Cliente teste #134', placa: 'TST1A34', marca: 'Teste', modelo: 'Aprovação',
    })).id
    // item 1 sem decisão (a tela sugere "Fazer"); item 2 já recusado pelo cliente → a aprovação sai PARCIAL (1/2)
    await dbInsert('erp_os_diagnostico_item', {
      company_id: DEMO_OFICINA, os_id: osId, descricao: ITEM_OK, tipo: 'servico', quantidade: 1, preco: 120, severidade: 'media',
    })
    await dbInsert('erp_os_diagnostico_item', {
      company_id: DEMO_OFICINA, os_id: osId, descricao: ITEM_NAO, tipo: 'servico', quantidade: 1, preco: 80, aprovado: false, severidade: 'baixa',
    })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-os-status-aprovada', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (!osId) return
    const limpar = async (f: () => Promise<void>) => { await f().catch(() => {}) }
    await limpar(() => dbDelete('erp_os_aprovacao', `os_id=eq.${osId}`))
    await limpar(() => dbDelete('erp_os_diagnostico_item', `os_id=eq.${osId}`))
    await limpar(() => dbDelete('erp_os', `id=eq.${osId}`))
    // se a OS não puder ser apagada (FK de auditoria), some da demo como excluída
    const resta = await dbSelect<{ id: string }>('erp_os', `id=eq.${osId}&select=id`).catch(() => [])
    if (resta.length) await limpar(() => dbPatch('erp_os', `id=eq.${osId}`, { excluida: true }))
  })

  test('Aprovação do Cliente registra a aprovação parcial e avisa o item recusado', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/aprovacao')
    await aguardarConteudo(page)
    await page.getByText(NUMERO).first().click()
    await expect(page.getByText(ITEM_OK)).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: /Registrar aprovação \(1\/2\)/ }).click()
    await expect(page.getByText(/1 item recusado pelo cliente/)).toBeVisible({ timeout: 15000 })

    const [aprov] = await dbSelect<{ decisao: string; itens_aprovados: number; itens_total: number }>('erp_os_aprovacao',
      `os_id=eq.${osId}&select=decisao,itens_aprovados,itens_total&order=created_at.desc&limit=1`)
    expect(aprov?.decisao, 'decisão registrada').toBe('parcial')
    expect(aprov?.itens_aprovados).toBe(1)
    expect(aprov?.itens_total).toBe(2)
  })

  test('a OS passa para "Aprovada" e a ficha avisa o item recusado', { tag: '@pos-migration' }, async ({ page }) => {
    const [os] = await dbSelect<{ status: string }>('erp_os', `id=eq.${osId}&select=status`)
    expect(os?.status, 'status atribuído pela aprovação do cliente').toBe('aprovada')

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/os')
    await aguardarConteudo(page)
    const linha = page.getByTestId('os-row').filter({ hasText: NUMERO })
    await expect(linha).toBeVisible({ timeout: 20000 })
    await linha.getByTestId('os-editar').click()
    await expect(page.getByTestId('os-status-select')).toHaveValue('aprovada')
    await expect(page.getByTestId('os-aviso-recusados')).toContainText('1 item recusado')
  })
})
