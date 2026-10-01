// Ajuda de campo (CEO 01/10, regra de todo o Hub): cada campo da Mão de obra tem um "?" que abre o cartão com os 4 blocos
// (O que preencher · Para que serve no cálculo · Exemplo · Erro comum), textos vindos do banco (erp_ajuda_campo, 82
// aprovados pelo CEO), "ver mais" com o artigo da Central de Ajuda e cada clique registrado em erp_ajuda_uso.
// Depende da migration 20261002140000 → @pos-migration. Demonstração Comércio (GE); os cliques de teste são removidos no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const ROTA = '/dashboard/projetos/mao-obra'
const INICIO = new Date().toISOString()

test.describe('Ajuda de campo — Mão de obra', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ajuda-campo-mao-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbDelete('erp_ajuda_uso', `company_id=eq.${DEMO_GE}&campo_chave=like.projetos.mao_obra.*&criado_em=gte.${encodeURIComponent(INICIO)}`).catch(() => {})
  })

  test('os 82 textos aprovados estão no banco, publicados, com os 4 blocos', { tag: '@pos-migration' }, async () => {
    const linhas = await dbSelect<{ chave: string; o_que_preencher: string; para_que_serve: string; exemplo: string; erro_comum: string; status: string; artigo_id: string | null }>(
      'erp_ajuda_campo', `rota=eq.${encodeURIComponent(ROTA)}&select=chave,o_que_preencher,para_que_serve,exemplo,erro_comum,status,artigo_id`)
    expect(linhas.length).toBeGreaterThanOrEqual(82)
    expect(linhas.every((l) => l.status === 'publicado' && l.o_que_preencher && l.para_que_serve && l.exemplo && l.erro_comum)).toBe(true)
    const horas = linhas.find((l) => l.chave === 'projetos.mao_obra.ficha.horas')
    expect(horas?.para_que_serve, 'texto do CEO').toContain('Se usar 220 (horas pagas)')
    expect(horas?.artigo_id, '"ver mais" ligado ao artigo da Central de Ajuda').toBeTruthy()
  })

  test('pela tela: o "?" abre os 4 blocos, "ver mais" mostra o artigo e os cliques ficam registrados', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto(ROTA)
    await aguardarConteudo(page)
    await expect(page.getByTestId('mao-obra-page')).toBeVisible()
    await page.getByTestId('mao-obra-novo-perfil').click()
    const modal = page.getByTestId('mao-obra-modal-ficha')
    await modal.getByTestId('ajuda-projetos.mao_obra.ficha.horas').click()
    const cartao = page.getByTestId('ajuda-cartao-projetos.mao_obra.ficha.horas')
    await expect(cartao).toBeVisible()
    for (const b of ['O que preencher', 'Para que serve no cálculo', 'Exemplo', 'Erro comum']) await expect(cartao.getByText(b, { exact: true })).toBeVisible()
    await expect(cartao).toContainText('sem deslocamento, chuva e espera')
    // clicar no "?" não mexe no campo
    await expect(modal.getByTestId('ficha-horas')).not.toBeFocused()
    await cartao.getByTestId('ajuda-ver-mais').click()
    await expect(cartao.getByTestId('ajuda-artigo')).toBeVisible()
    await expect.poll(async () => (await dbSelect<{ acao: string }>('erp_ajuda_uso',
      `company_id=eq.${DEMO_GE}&campo_chave=eq.projetos.mao_obra.ficha.horas&criado_em=gte.${encodeURIComponent(INICIO)}&select=acao`)).map((u) => u.acao).sort().join(','),
    { timeout: 15000, message: 'abertura e "ver mais" registradas no uso da ajuda' }).toBe('abriu,ver_mais')
    await page.keyboard.press('Escape')
    await expect(cartao).toBeHidden()
    // todo campo visível do modal tem o "?"
    expect(await modal.locator('[data-testid^="ajuda-projetos.mao_obra."]').count()).toBeGreaterThanOrEqual(10)
  })
})
