// Produtividade Onda 2 (tela): produto acabado no topo + árvore de origem editável + "Colar lista" + aviso por fluxo.
// Prova como usuário, pela tela (RD-82). Demonstração Indústria (…05). Depende das RPCs da Onda 2 (#2136) → @pos-migration.
// Tudo que o teste cria é arquivado no fim (nada apagado, RD-30).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { rpc, dbSelect, registrarJornada } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'l'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const cod = (s: string) => `U${RUN}${s}`

test.describe('Produtividade — produto acabado e árvore de origem', { tag: '@pos-migration' }, () => {
  let plantId = ''
  test.beforeAll(async () => {
    const pl = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO_IND}&is_active=eq.true&select=id&limit=1`)
    plantId = pl[0]?.id ?? ''
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-produtividade-produto-arvore', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (!plantId) return
    const ps = await rpc<{ itens: { id: string }[] }>('fn_prod_produto_listar', { p_company_id: DEMO_IND, p_plant_id: plantId, p_busca: `U${RUN}`, p_incluir_arquivados: true }).catch(() => null)
    const ids = new Set((ps?.itens ?? []).map((i) => i.id))
    const ls = await dbSelect<{ id: string; produto_id: string }>('prod_estrutura', `company_id=eq.${DEMO_IND}&select=id,produto_id`).catch(() => [])
    for (const l of ls) if (ids.has(l.produto_id)) await rpc('fn_prod_estrutura_arquivar', { p_company_id: DEMO_IND, p_id: l.id, p_ativo: false }).catch(() => {})
    for (const id of ids) await rpc('fn_prod_produto_arquivar', { p_company_id: DEMO_IND, p_id: id, p_ativo: false }).catch(() => {})
  })

  test('cadastrar acabado, incluir origem, editar rendimento, ciclo recusado, colar lista com linha inválida, arquivar', async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    page.on('dialog', (d) => { void d.accept() })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto('/dashboard/produtividade')
    await aguardarConteudo(page)

    // acabado manual (sem fonte de produção ligada na demo)
    await page.getByTestId('acabado-busca').click()
    await page.getByTestId('acabado-novo').click()
    await page.getByTestId('produto-codigo').fill(cod('A'))
    await page.getByTestId('produto-nome').fill(`Acabado ${RUN}`)
    await page.getByTestId('produto-salvar').click()
    const raiz = page.locator(`[data-testid="no-arvore"][data-codigo="${cod('A')}"]`)
    await expect(raiz).toBeVisible()

    // incluir origem cadastrando o produto na hora
    await raiz.getByTestId('incluir-origem').click()
    await page.getByTestId('lig-novo-produto').click()
    await page.getByTestId('produto-codigo').fill(cod('B'))
    await page.getByTestId('produto-nome').fill(`Origem ${RUN}`)
    await page.getByTestId('produto-salvar').click()
    await page.getByTestId('lig-salvar').click()
    const origem = page.locator(`[data-testid="no-arvore"][data-codigo="${cod('B')}"]`)
    await expect(origem).toBeVisible()
    await expect(origem.getByTestId('est-rendimento')).toHaveText('a definir')   // nunca zero

    // editar rendimento no lugar
    await origem.getByTestId('est-rendimento').click()
    await origem.getByTestId('est-rendimento-campo').fill('0')
    await origem.getByTestId('est-rendimento-campo').press('Enter')
    await expect(origem.getByTestId('est-rendimento-erro')).toBeVisible()          // zero recusado, o digitado fica
    await origem.getByTestId('est-rendimento-campo').fill('12,5')
    await origem.getByTestId('est-rendimento-campo').press('Enter')
    await expect(origem.getByTestId('est-rendimento-salvo')).toBeVisible()

    // ciclo recusado: o acabado como origem da própria origem
    await origem.getByTestId('incluir-origem').click()
    await page.getByTestId('lig-produto').selectOption({ label: `${cod('A')} · Acabado ${RUN}` })
    await page.getByTestId('lig-salvar').click()
    await expect(page.getByTestId('lig-erro')).toContainText('ciclo')
    await page.getByRole('button', { name: 'Fechar' }).click()

    // colar lista: 1 válida, 1 inválida (avisa o que não casou)
    await rpc('fn_prod_produto_salvar', { p_company_id: DEMO_IND, p_plant_id: plantId, p_id: null, p_codigo: cod('C'), p_nome: `Saída ${RUN}`, p_papel: 'subproduto' })
    await page.reload(); await aguardarConteudo(page)
    await page.getByTestId('colar-lista').click()
    await page.getByTestId('colar-texto').fill(`${cod('B')};${cod('C')};subproduto;5;\n${cod('B')};NAOEXISTE${RUN};principal;10;`)
    await page.getByTestId('colar-previa').click()
    await expect(page.getByTestId('colar-nao-casaram')).toContainText('produto_nao_encontrado')
    await page.getByTestId('colar-gravar').click()
    await expect(page.getByTestId('colar-resultado')).toContainText('1 gravada')
    await page.getByRole('button', { name: 'Fechar' }).click()

    // reabrir o acabado: a árvore mostra a origem e o subproduto como saída irmã (rascunho)
    await page.getByTestId('acabado-busca').fill(cod('A'))
    await page.getByTestId('acabado-opcao').first().click()
    await expect(page.locator(`[data-testid="no-arvore"][data-codigo="${cod('B')}"]`)).toBeVisible()
    await expect(page.getByTestId('saida-irma')).toContainText(cod('C'))

    // arquivar a origem (nada apagado): some da árvore
    await page.locator(`[data-testid="no-arvore"][data-codigo="${cod('B')}"]`).getByTestId('arquivar-no').click()
    await expect(page.locator(`[data-testid="no-arvore"][data-codigo="${cod('B')}"]`)).toHaveCount(0)
  })

  test('aviso por fluxo: sem origem/saídas o "Pronto para medir" não fica verde e lista o que falta com link', async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto('/dashboard/produtividade')
    await aguardarConteudo(page)
    const fx = await dbSelect<{ id: string }>('prod_fluxo', `company_id=eq.${DEMO_IND}&select=id&limit=1`)
    test.skip(fx.length === 0, 'a demonstração não tem fluxo cadastrado')
    const faixa = page.getByTestId('faixa-prontidao')
    await expect(faixa).toBeVisible()
    await expect(faixa.getByTestId('falta-origem')).toBeVisible()
  })
})
