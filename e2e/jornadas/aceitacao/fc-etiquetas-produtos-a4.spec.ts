// Etiquetas A4 de produtos (CEO 30/09 · Diego/FC: identificar material no almoxarifado). Em Cadastros › Produtos, marcar
// produtos → "Etiquetas A4" → PDF com nome, código, código de barras e local de armazenagem (erp_produtos.localizacao).
// Prova na Demonstração Comércio (GE), como o robô, com 2 produtos de teste só desta execução: o PDF baixado de verdade
// tem as 2 etiquetas com nome, código e local; o produto com EAN sai com o EAN legível; e a ficha do produto mostra e
// grava o local. Produtos de teste ficam inativos no fim (RD-30: nada é apagado). NUNCA roda em empresa real.
// Ajuste FC 30/09 (1ª impressão real): nome longo sai INTEIRO (até 3 linhas), sem local sai "Local:" com linha em
// branco (sem "—"), e "Imprimir código de barras: não" gera o PDF sem nenhuma barra.

import { readFileSync } from 'node:fs'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const PREFIXO = `E2E-ETQ-${RUN}`
const EAN = '4006381333931'
const produtos: { id: string; codigo: string; nome: string; local: string | null }[] = []
const NOME_LONGO = 'E2E Argamassa colante AC-III cinza 20 kg para porcelanato de grande formato área externa'
// linha do produto no computador (tabela) ou no celular (card) — só a que está visível no tamanho da tela
const LINHA = '[data-testid="produto-row"]:visible, [data-testid="produto-row-mobile"]:visible'

async function textoDoPdf(pdf: Buffer): Promise<{ paginas: number; texto: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf) }).promise
  let t = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    t += (c.items as Array<{ str?: string }>).map((it) => it.str ?? '').join('\n') + '\n'
  }
  return { paginas: doc.numPages, texto: t }
}

test.describe('Etiquetas A4 de produtos (FC)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    for (const [suf, nome, local, ean] of [
      ['A', `E2E Argamassa colante ${RUN}`, 'Galpão B · Prat. 3', null],
      ['B', `E2E Rejunte epóxi ${RUN}`, 'Rua 7 · Nível 2', EAN],
      ['C', `${NOME_LONGO} ${RUN}`, null, null],
    ] as const) {
      const codigo = `${PREFIXO}-${suf}`
      const p = await dbInsert<{ id: string }>('erp_produtos', {
        company_id: DEMO, codigo, nome, tipo: 'produto', ativo: true, unidade: 'UN', localizacao: local, codigo_barras: ean,
      })
      produtos.push({ id: p.id, codigo, nome, local })
    }
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fc-etiquetas-a4', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const p of produtos) await dbPatch('erp_produtos', `id=eq.${p.id}`, { ativo: false }).catch(() => {})
  })

  test('marcar 3 produtos → Etiquetas A4 → PDF com nome inteiro, código, local e código de barras; sem barras também', async ({ page }, testInfo) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/cadastros/produtos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('etiquetas-abrir'), 'sem produto marcado o botão fica desabilitado').toBeDisabled()

    await page.getByPlaceholder('Buscar por nome, codigo ou NCM...').fill(PREFIXO)
    const linhas = page.locator(LINHA)
    await expect(linhas).toHaveCount(3, { timeout: 30000 })
    for (let i = 0; i < 3; i++) await linhas.nth(i).getByTestId('produto-sel').check()
    await expect(page.getByTestId('etiquetas-abrir')).toContainText('Etiquetas A4 (3)')
    await page.getByTestId('etiquetas-abrir').click()

    const modal = page.getByTestId('etiquetas-modal')
    await expect(modal.getByTestId('etiquetas-qtd-produtos')).toHaveText('3')
    await expect(modal.getByTestId('etiquetas-resumo')).toContainText('3 etiqueta(s) · 1 folha(s)')
    await expect(modal.getByTestId('etiquetas-barras'), 'código de barras: padrão sim').toHaveValue('sim')
    const [download] = await Promise.all([page.waitForEvent('download'), modal.getByTestId('etiquetas-gerar').click()])
    expect(download.suggestedFilename()).toMatch(/^etiquetas-produtos-\d{4}-\d{2}-\d{2}\.pdf$/)
    const pdf = readFileSync((await download.path())!)
    await testInfo.attach('etiquetas.pdf', { body: pdf, contentType: 'application/pdf' })
    await expect(modal.getByTestId('etiquetas-aviso')).toContainText('PDF gerado: 3 etiqueta(s).')

    const { paginas, texto } = await textoDoPdf(pdf)
    const corrido = texto.replace(/\s+/g, ' ')
    expect(paginas, 'uma folha A4').toBe(1)
    for (const p of produtos) {
      expect(corrido, `nome INTEIRO de ${p.codigo} (quebrado em linhas, nunca cortado)`).toContain(p.nome)
      expect(texto, `código de ${p.codigo}`).toContain(`Cód. ${p.codigo}`)
      if (p.local) expect(texto, `local de ${p.codigo}`).toContain(`Local: ${p.local}`)
    }
    expect(texto, 'nenhum nome cortado com reticências').not.toContain('…')
    expect(texto, 'sem local: "Local:" com linha em branco, sem "—"').not.toContain('Local: —')
    expect(texto.split('\n'), 'sem local: "Local:" sozinho (a linha é desenhada ao lado)').toContain('Local:')
    expect(texto, 'o produto com EAN sai com o EAN legível embaixo das barras').toContain(EAN)
    expect(texto.split('\n'), 'o produto sem EAN sai com o código interno embaixo das barras (Code128)').toContain(produtos[0].codigo)
    expect((pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length, 'um código de barras por etiqueta').toBe(3)

    // "Imprimir código de barras: não" → mesmo conteúdo, nenhuma barra
    await modal.getByTestId('etiquetas-barras').selectOption('nao')
    const [dl2] = await Promise.all([page.waitForEvent('download'), modal.getByTestId('etiquetas-gerar').click()])
    const pdf2 = readFileSync((await dl2.path())!)
    await testInfo.attach('etiquetas-sem-barras.pdf', { body: pdf2, contentType: 'application/pdf' })
    const sem = await textoDoPdf(pdf2)
    expect((pdf2.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length, 'sem barras: nenhuma imagem de código de barras').toBe(0)
    expect(sem.texto, 'sem barras: sem o número embaixo das barras').not.toContain(EAN)
    for (const p of produtos) expect(sem.texto.replace(/\s+/g, ' '), `sem barras: nome inteiro de ${p.codigo}`).toContain(p.nome)
    expect(sem.texto, 'sem barras: nenhum nome cortado').not.toContain('…')
  })

  test('ficha do produto mostra e grava o local de armazenagem', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/cadastros/produtos')
    await aguardarConteudo(page)
    await page.getByPlaceholder('Buscar por nome, codigo ou NCM...').fill(produtos[0].codigo)
    const linha = page.locator(LINHA)
    await expect(linha).toHaveCount(1, { timeout: 30000 })
    await linha.getByTestId('produto-editar').click()
    const campo = page.getByTestId('produto-localizacao')
    await expect(campo).toHaveValue(produtos[0].local ?? '')
    const novo = `Galpão C · Prat. 9 ${RUN}`
    await campo.fill(novo)
    await page.getByRole('button', { name: /Salvar/ }).click()
    await expect(campo).toBeHidden({ timeout: 20000 })
    await expect.poll(async () => (await dbSelect<{ localizacao: string | null }>('erp_produtos', `id=eq.${produtos[0].id}&select=localizacao`))[0]?.localizacao,
      { timeout: 15000 }).toBe(novo)
  })
})
