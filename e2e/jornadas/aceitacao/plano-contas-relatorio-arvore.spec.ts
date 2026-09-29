// Relatório Plano Gerencial × Contábil (CEO 29/09 · FC): o impresso não servia — as contábeis sem vínculo vinham primeiro,
// com a frase repetida em cada linha e texto cinza-claro/laranja. Agora: árvore GERENCIAL primeiro (cada conta e, abaixo,
// as contábeis vinculadas), seção "Contas contábeis ainda sem conta gerencial: N" no FIM, e tudo preto na impressão.
// Prova no PDF de verdade (page.pdf) da Demonstração Comércio GE: duas contas contábeis de teste (uma vinculada, uma
// pendente) criadas e removidas no teste.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const COD_VINC = `9.E2E${RUN}.1`
const COD_PEND = `9.E2E${RUN}.2`
const criadas: string[] = []
let ger = { id: '', codigo: '', descricao: '' }

async function textoDoPdf(pdf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf) }).promise
  let t = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    t += (c.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' ') + '\n'
  }
  return t.replace(/\s+/g, ' ')
}

test.describe('Relatório Plano Gerencial × Contábil — árvore gerencial e pendentes no fim', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [g] = await dbSelect<{ id: string; codigo: string; descricao: string }>('erp_plano_contas',
      `company_id=eq.${DEMO_GE}&ativo=eq.true&is_totalizador=eq.false&select=id,codigo,descricao&order=codigo&limit=1`)
    expect(g, 'a demo tem plano gerencial').toBeTruthy()
    ger = g
    for (const [codigo, descricao] of [[COD_VINC, 'E2E conta vinculada'], [COD_PEND, 'E2E conta pendente']]) {
      criadas.push((await dbInsert<{ id: string }>('erp_conta_contabil', { company_id: DEMO_GE, codigo, descricao, analitica: true, nivel: 3, codigo_antigo: '999' })).id)
    }
    await dbInsert('erp_conta_contabil_vinculo', { company_id: DEMO_GE, plano_conta_id: ger.id, conta_contabil_id: criadas[0], observacao: 'e2e' })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-plano-contas-relatorio-arvore', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of criadas) {
      await dbDelete('erp_conta_contabil_vinculo', `conta_contabil_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_conta_contabil', `id=eq.${id}`).catch(() => {})
    }
  })

  test('PDF: árvore gerencial primeiro, contábil debaixo da gerencial, pendentes no fim, tudo em preto', async ({ page }, testInfo) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/cadastros/plano-contas/relatorio')
    await aguardarConteudo(page)
    await expect(page.getByTestId('relatorio-arvore')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId(`ger-${ger.codigo}`).getByTestId(`cont-${COD_VINC}`), 'a contábil vinculada fica debaixo da sua gerencial').toBeVisible()
    const pend = page.getByTestId('relatorio-pendentes')
    await expect(pend).toContainText('Contas contábeis ainda sem conta gerencial:')
    await expect(pend.getByTestId(`pend-${COD_PEND}`), 'a pendente está na seção do fim').toBeVisible()

    await page.emulateMedia({ media: 'print' })
    const coresFora = await page.evaluate(() => Array.from(document.querySelectorAll('#relatorio-plano *'))
      .filter((el) => (el as HTMLElement).innerText?.trim() && getComputedStyle(el).color !== 'rgb(0, 0, 0)').length)
    expect(coresFora, 'na impressão todo texto do relatório é preto').toBe(0)

    const pdf = await page.pdf({ format: 'A4', printBackground: false, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
    await testInfo.attach('relatorio-plano.pdf', { body: pdf, contentType: 'application/pdf' })
    const txt = await textoDoPdf(pdf)
    const iGer = txt.indexOf(ger.codigo + ' · ')
    const iVinc = txt.indexOf(COD_VINC)
    const iTitulo = txt.indexOf('Contas contábeis ainda sem conta gerencial')
    const iPend = txt.indexOf(COD_PEND)
    expect(iGer, 'a árvore gerencial está no PDF').toBeGreaterThanOrEqual(0)
    expect(iVinc, 'a contábil vinculada vem depois da sua gerencial').toBeGreaterThan(iGer)
    expect(iTitulo, 'a seção de pendentes vem depois da árvore').toBeGreaterThan(iVinc)
    expect(iPend, 'a contábil pendente está na seção do fim').toBeGreaterThan(iTitulo)
    expect(txt, 'sem a frase repetida por linha').not.toContain('conta contábil sem conta gerencial')
  })
})
