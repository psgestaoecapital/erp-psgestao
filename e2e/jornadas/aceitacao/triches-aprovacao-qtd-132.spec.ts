// #132 (Mecânica Diesel Triches) · Aprovação do Cliente mostrava o preço UNITÁRIO sem multiplicar pela quantidade:
// "óleo motor" 28 × R$ 28,00 aparecia R$ 28,00 e o "Total aprovado" fechava R$ 118,00 em vez de R$ 874,00.
// Contrato: erp_os_diagnostico_item.preco = unitário; linha = preco × quantidade (igual OS, NF-e, NFS-e, impressão).
// 1º teste: a tela (só front, roda no preview). 2º: o total gravado em erp_os_aprovacao (migration 20260927180000,
// @pos-migration). Demonstração Oficina (OS BOT-APROV); itens de teste removidos no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const OLEO = `Óleo motor 132 ${RUN}`
const FILTRO = `Filtro diesel 132 ${RUN}`

type Item = { preco: number | null; quantidade: number | null; aprovado: boolean | null }
const totalEsperado = (itens: Item[]) =>
  Math.round(itens.filter((i) => i.aprovado && Number(i.preco) > 0).reduce((s, i) => s + Number(i.preco) * (Number(i.quantidade) > 0 ? Number(i.quantidade) : 1), 0) * 100) / 100
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

test.describe('Aprovação do Cliente — preço × quantidade (#132)', () => {
  let osId = ''

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string }>('erp_os', `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-APROV&select=id`)
    expect(os, 'a demo tem a OS BOT-APROV').toBeTruthy()
    osId = os.id
    await dbInsert('erp_os_diagnostico_item', { company_id: DEMO_OFICINA, os_id: osId, descricao: OLEO, tipo: 'peca', quantidade: 28, preco: 28, aprovado: true, severidade: 'media' })
    await dbInsert('erp_os_diagnostico_item', { company_id: DEMO_OFICINA, os_id: osId, descricao: FILTRO, tipo: 'peca', quantidade: 1, preco: 90, aprovado: true, severidade: 'media' })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-aprovacao-qtd-132', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const d of [OLEO, FILTRO]) await dbDelete('erp_os_diagnostico_item', `company_id=eq.${DEMO_OFICINA}&descricao=eq.${encodeURIComponent(d)}`).catch(() => {})
  })

  async function abrir(page: import('@playwright/test').Page) {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/aprovacao')
    await aguardarConteudo(page)
    await page.getByText('BOT-APROV').first().click()
    await expect(page.getByText(OLEO)).toBeVisible({ timeout: 20000 })
  }

  test('28 × R$ 28,00 aparece R$ 784,00 e o total soma a linha, não o unitário', async ({ page }) => {
    await abrir(page)
    await expect(page.getByTestId('aprov-item-linha').filter({ hasText: /28 × R\$\s?28,00 = R\$\s?784,00/ })).toBeVisible()

    const itens = await dbSelect<Item>('erp_os_diagnostico_item', `os_id=eq.${osId}&select=preco,quantidade,aprovado`)
    const esperado = totalEsperado(itens)
    expect(esperado, 'o total inclui 784 + 90').toBeGreaterThanOrEqual(874)
    await expect(page.getByTestId('aprov-total')).toHaveText(brl(esperado))
  })

  test('registrar a aprovação grava o total com a quantidade @pos-migration', async ({ page }) => {
    await abrir(page)
    const antes = new Date().toISOString()
    await page.getByPlaceholder('Nome do cliente').fill('Cliente teste 132')
    await page.getByRole('button', { name: /Registrar aprovação/ }).click()
    await expect(page.getByText(/Orçamento registrado/)).toBeVisible({ timeout: 20000 })

    const itens = await dbSelect<Item>('erp_os_diagnostico_item', `os_id=eq.${osId}&select=preco,quantidade,aprovado`)
    const [ap] = await dbSelect<{ valor_total: number }>('erp_os_aprovacao',
      `os_id=eq.${osId}&created_at=gte.${encodeURIComponent(antes)}&select=valor_total&order=created_at.desc&limit=1`)
    expect(ap, 'a aprovação foi gravada').toBeTruthy()
    expect(Number(ap.valor_total), 'valor_total = Σ preço × quantidade').toBe(totalEsperado(itens))
  })
})
