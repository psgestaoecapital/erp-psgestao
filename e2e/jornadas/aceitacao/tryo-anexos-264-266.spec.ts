// Tryo #264 + #266 (anexos). #266 "anexar fotos, pdf, dwg" na Nova oportunidade: o card de anexos (que já existia na
// ficha) entra no formulário; na criação os arquivos ficam em espera e são presos à oportunidade no CRIAR.
// #264 "área para inserir orçamento em PDF": o PDF já existia (#1529), mas só em orçamento SALVO, e o orçamento exigia
// lista de itens — quem faz o orçamento fora do sistema (Tryo: 9 orçamentos, 0 itens, 0 PDF) nunca chegava lá. Agora o
// orçamento novo aceita o PDF + valor sem itens, e a lista abre o PDF.
// Demonstração Comércio (GE), nunca empresa real. Registros de teste desativados/cancelados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const PDF = { name: 'orcamento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% aceitacao tryo\n%%EOF\n') }
const DWG = { name: 'planta.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1032 aceitacao tryo') }

async function abrirComoGE(page: import('@playwright/test').Page, url: string) {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
  page.on('dialog', (d) => void d.accept())
  await page.goto(url)
  await aguardarConteudo(page)
}

test.describe('Anexos da Tryo — Nova oportunidade e orçamento em PDF (#264 #266)', () => {
  const oportunidades: string[] = []
  const orcamentos: string[] = []
  const clientes: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-tryo-264-266-anexos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of oportunidades) await dbPatch('erp_crm_oportunidade', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
    for (const id of orcamentos) await dbPatch('erp_orcamentos', `id=eq.${id}`, { status: 'cancelado' })
    for (const id of clientes) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('#266 · Nova oportunidade com PDF e DWG: os anexos ficam presos à oportunidade criada', async ({ page }) => {
    const descricao = `Anexos 266 ${RUN}`
    await abrirComoGE(page, '/dashboard/projetos/oportunidades')
    await page.getByRole('button', { name: '+ Nova oportunidade' }).click()
    await page.getByTestId('oport-descricao').fill(descricao)
    await page.getByTestId('oport-anexos').locator('input[type="file"]').setInputFiles([PDF, DWG])
    await expect(page.getByTestId('oport-anexos').getByText('planta.dwg')).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'CRIAR', exact: true }).click()

    await expect.poll(async () => (await dbSelect<{ id: string }>('erp_crm_oportunidade',
      `company_id=eq.${DEMO_COMERCIO}&titulo=eq.${encodeURIComponent(descricao.toUpperCase())}&select=id`))[0]?.id ?? null,
    { timeout: 15000, message: 'a oportunidade foi criada' }).not.toBeNull()
    const [op] = await dbSelect<{ id: string }>('erp_crm_oportunidade', `company_id=eq.${DEMO_COMERCIO}&titulo=eq.${encodeURIComponent(descricao.toUpperCase())}&select=id`)
    oportunidades.push(op.id)
    await expect.poll(async () => (await dbSelect<{ categoria: string }>('erp_crm_anexo',
      `oportunidade_id=eq.${op.id}&deleted_at=is.null&select=categoria`)).map((a) => a.categoria).sort(),
    { timeout: 15000, message: 'os 2 anexos (PDF e planta DWG) ficaram na oportunidade' }).toEqual(['documento', 'planta'])
  })

  test('#264 · orçamento feito fora: criar só com o PDF e o valor, sem itens; a lista abre o PDF', async ({ page }) => {
    const nome = `Cliente Orc 264 ${RUN}`
    const cli = await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO_COMERCIO, nome_fantasia: nome, razao_social: nome, ativo: true })
    clientes.push(cli.id)

    await abrirComoGE(page, '/dashboard/orcamentos')
    await page.getByRole('button', { name: '+ Novo Orçamento' }).click()
    await page.getByPlaceholder('Digite nome, fantasia ou CNPJ...').fill(nome)
    await page.getByText(nome, { exact: true }).first().click()
    await page.getByTestId('orc-pdf-novo-input').setInputFiles(PDF)
    await page.getByTestId('orc-pdf-novo-valor').fill('1234,56')
    await page.getByRole('button', { name: 'Criar Orçamento' }).click()

    await expect.poll(async () => (await dbSelect<{ id: string; pdf_anexo_path: string | null; total: number }>('erp_orcamentos',
      `company_id=eq.${DEMO_COMERCIO}&cliente_id=eq.${cli.id}&select=id,pdf_anexo_path,total`))[0] ?? null,
    { timeout: 20000, message: 'o orçamento nasceu com o PDF e o valor' }).toMatchObject({ pdf_anexo_path: expect.stringContaining('/orcamentos/'), total: 1234.56 })
    const [orc] = await dbSelect<{ id: string }>('erp_orcamentos', `company_id=eq.${DEMO_COMERCIO}&cliente_id=eq.${cli.id}&select=id`)
    orcamentos.push(orc.id)
    await expect(page.getByTestId('orc-lista-pdf').first(), 'a lista mostra o botão do PDF').toBeVisible({ timeout: 15000 })
  })
})
