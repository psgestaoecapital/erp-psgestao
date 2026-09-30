// Tryo #110 + #262 (Oportunidades). #262: "o nome do cliente desaparece quando salvamos e voltamos para editar" — o
// campo Cliente só gravava se a pessoa escolhesse uma sugestão; nome digitado não era salvo (na Tryo, só 15 de 40
// oportunidades têm cliente). Agora o nome digitado vira cadastro (ou reusa o de mesmo nome), o cliente vem primeiro
// e identifica o card no kanban, e o antigo "Título" vira "Descrição do serviço / produto". #110: telefone do cliente
// no formulário (grava no cadastro do cliente), na ficha e no card do kanban (este via fn_crm_pipeline · @pos-migration).
// Demonstração Comércio (GE), nunca empresa real. Oportunidade e cliente de teste desativados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const CLIENTE = `Cliente Tryo ${RUN}`
const DESCRICAO = `Forro de gesso ${RUN}`
const TELEFONE = '(49) 99876-5432'

type Op = { id: string; titulo: string; cliente_id: string | null }
type Cli = { id: string; nome_fantasia: string | null; telefone: string | null }

async function abrirComoGE(page: import('@playwright/test').Page, url: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
  await page.goto(url)
  await aguardarConteudo(page)
}

test.describe.serial('Oportunidades — cliente digitado fica gravado e o telefone aparece (#110 #262)', () => {
  let opId = ''
  let clienteId = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-tryo-110-262-oportunidade-cliente', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (opId) await dbPatch('erp_crm_oportunidade', `id=eq.${opId}`, { deleted_at: new Date().toISOString() })
    if (clienteId) await dbPatch('erp_clientes', `id=eq.${clienteId}`, { ativo: false })
  })

  test('nome do cliente digitado (sem escolher da lista) é gravado, com o telefone, e aparece ao reabrir', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)

    await abrirComoGE(page, '/dashboard/projetos/oportunidades')
    await page.getByRole('button', { name: '+ Nova oportunidade' }).click()
    await page.getByTestId('oport-cliente').fill(CLIENTE)
    await page.getByTestId('oport-telefone-cliente').fill(TELEFONE)
    await page.getByTestId('oport-descricao').fill(DESCRICAO)
    await page.getByRole('button', { name: 'CRIAR', exact: true }).click()

    await expect.poll(async () => (await dbSelect<Op>('erp_crm_oportunidade',
      `company_id=eq.${DEMO_COMERCIO}&titulo=eq.${encodeURIComponent(DESCRICAO.toUpperCase())}&select=id,titulo,cliente_id`))[0]?.cliente_id ?? null,
    { timeout: 15000, message: 'a oportunidade nasce com o cliente gravado' }).not.toBeNull()
    const [op] = await dbSelect<Op>('erp_crm_oportunidade', `company_id=eq.${DEMO_COMERCIO}&titulo=eq.${encodeURIComponent(DESCRICAO.toUpperCase())}&select=id,titulo,cliente_id`)
    opId = op.id
    clienteId = op.cliente_id!
    const [cli] = await dbSelect<Cli>('erp_clientes', `id=eq.${clienteId}&select=id,nome_fantasia,telefone`)
    expect(cli.nome_fantasia, 'o cliente digitado virou cadastro').toBe(CLIENTE.toUpperCase())
    expect(cli.telefone, 'o telefone foi gravado no cadastro do cliente').toBe(TELEFONE)

    // reabrir: a ficha mostra o cliente no título e o telefone para ligar
    await abrirComoGE(page, `/dashboard/projetos/oportunidades/${opId}`)
    await expect(page.getByRole('heading', { name: CLIENTE.toUpperCase() })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('ficha-oport-telefone')).toHaveAttribute('href', 'tel:49998765432')
  })

  test('o card do kanban mostra o nome do cliente e o telefone', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!opId, 'depende do teste anterior')
    await abrirComoGE(page, '/dashboard/projetos/oportunidades')
    const card = page.getByTestId('card-oport-nome').filter({ hasText: CLIENTE.toUpperCase() }).first()
    await expect(card, 'o card traz o nome do cliente em destaque').toBeVisible({ timeout: 20000 })
    const tel = page.locator('a[data-testid="card-oport-telefone"][href="tel:49998765432"]')
    await expect(tel.first(), 'o card traz o telefone do cliente').toBeVisible()
  })
})
