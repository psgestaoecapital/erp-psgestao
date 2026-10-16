// Produtividade › Cadastro › produto acabado + árvore de origem (Onda 2, caixa 6570c1c9). Genérico: a demonstração Indústria não tem
// código de empresa nenhum; o teste cria o que usa e remove no fim. Prova como usuário, pela tela (RD-82); o banco só confere.
// Depende da migration 20261007150010 (tabelas prod_produto/prod_estrutura) → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const K = String(Date.now()).slice(-6)
const COD = { acab: `A${K}`, meio: `M${K}`, orig: `O${K}`, sub: `S${K}`, fonte: `F${K}` }

type Estr = { id: string; ativo: boolean; rendimento_padrao_pct: number | null; tipo_saida: string; status: string }

test.describe('Produtividade — produto acabado e árvore de origem', () => {
  let plantId = ''
  let setorId = ''
  test.beforeAll(async () => {
    const pl = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO_IND}&is_active=eq.true&select=id&limit=1`)
    plantId = pl[0]?.id ?? ''
    if (!plantId) return
    const st = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_IND}&plant_id=eq.${plantId}&select=id&limit=1`)
    setorId = st[0]?.id ?? ''
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-produtividade-produto-arvore', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    const ps = await dbSelect<{ id: string }>('prod_produto', `company_id=eq.${DEMO_IND}&codigo=in.(${Object.values(COD).join(',')})&select=id`).catch(() => [])
    for (const p of ps) {
      await dbDelete('prod_estrutura', `company_id=eq.${DEMO_IND}&origem_produto_id=eq.${p.id}`).catch(() => {})
      await dbDelete('prod_estrutura', `company_id=eq.${DEMO_IND}&produto_id=eq.${p.id}`).catch(() => {})
    }
    await dbDelete('prod_fluxo', `company_id=eq.${DEMO_IND}&nome=like.${encodeURIComponent(`E2E ${K}*`)}`).catch(() => {})
    await dbDelete('prod_produto', `company_id=eq.${DEMO_IND}&codigo=in.(${Object.values(COD).join(',')})`).catch(() => {})
    await dbDelete('ind_atak_fato', `company_id=eq.${DEMO_IND}&chave_fato=eq.e2e-${K}`).catch(() => {})
    await dbDelete('prod_fonte_dados', `company_id=eq.${DEMO_IND}&nome=eq.${encodeURIComponent(`E2E ${K} fonte`)}`).catch(() => {})
  })

  async function abrir(page: import('@playwright/test').Page) {
    page.on('dialog', (d) => { void d.accept() })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto('/dashboard/produtividade')
    await aguardarConteudo(page)
  }
  async function produto(cod: string) {
    const l = await dbSelect<{ id: string; papel: string; fonte_id: string | null }>('prod_produto', `company_id=eq.${DEMO_IND}&codigo=eq.${cod}&select=id,papel,fonte_id`)
    expect(l.length, `produto ${cod} no banco`).toBe(1)
    return l[0]
  }
  async function estr(origemCod: string, saidaCod: string) {
    const o = await produto(origemCod); const s = await produto(saidaCod)
    const l = await dbSelect<Estr>('prod_estrutura', `company_id=eq.${DEMO_IND}&origem_produto_id=eq.${o.id}&produto_id=eq.${s.id}&select=id,ativo,rendimento_padrao_pct,tipo_saida,status`)
    return l
  }
  async function cadastrarManual(page: import('@playwright/test').Page, testid: string, cod: string, nome: string) {
    await page.getByTestId(testid).fill(cod)
    await page.getByTestId(`${testid}-manual`).click()
    await page.getByTestId(`${testid}-man-codigo`).fill(cod)
    await page.getByTestId(`${testid}-man-nome`).fill(nome)
    await page.getByTestId(`${testid}-man-salvar`).click()
  }

  test('acabado manual → origem → editar rendimento → saída subproduto → arquivar; ciclo recusado', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    await abrir(page)

    await cadastrarManual(page, 'acabado-busca', COD.acab, `E2E ${K} acabado`)
    await expect(page.getByTestId('acabado-atual')).toContainText(COD.acab)
    expect((await produto(COD.acab)).papel).toBe('acabado')

    // incluir origem (cadastro manual dentro da busca)
    await page.getByTestId('add-origem-raiz').click()
    await cadastrarManual(page, 'inc-busca', COD.meio, `E2E ${K} intermediário`)
    await expect(page.getByTestId(`no-${COD.meio}`)).toBeVisible()
    let e = await estr(COD.meio, COD.acab)
    expect(e.length).toBe(1)
    expect(e[0].rendimento_padrao_pct, 'sem rendimento = a definir (nunca zero)').toBeNull()
    expect(e[0].status).toBe('rascunho')
    await expect(page.getByTestId(`no-${COD.meio}`)).toContainText('a definir')

    // nível 2: origem da origem
    await page.getByTestId(`add-origem-${COD.meio}`).click()
    await cadastrarManual(page, 'inc-busca', COD.orig, `E2E ${K} origem`)
    await expect(page.getByTestId(`no-${COD.orig}`)).toBeVisible()

    // editar no lugar: zero recusado, 12,5 grava
    await page.getByTestId(`lig-${COD.meio}-rend`).click()
    await page.getByTestId(`lig-${COD.meio}-rend-campo`).fill('0')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`lig-${COD.meio}-rend-erro`)).toContainText('maior que 0')
    await page.getByTestId(`lig-${COD.meio}-rend-campo`).fill('12,5')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`lig-${COD.meio}-rend-salvo`)).toBeVisible()
    e = await estr(COD.meio, COD.acab)
    expect(Number(e[0].rendimento_padrao_pct)).toBe(12.5)

    // validar (status) e incluir saída (subproduto) da mesma origem
    await page.getByTestId(`lig-${COD.meio}-status`).click()
    await page.getByTestId(`lig-${COD.meio}-status-campo`).selectOption('validado')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`lig-${COD.meio}-status-salvo`)).toBeVisible()
    await page.getByTestId(`add-saida-${COD.orig}`).click()
    await cadastrarManual(page, 'inc-busca', COD.sub, `E2E ${K} subproduto`)
    await expect(page.getByTestId(`irma-${COD.sub}`)).toBeVisible()
    const sub = await estr(COD.orig, COD.sub)
    expect(sub.length).toBe(1)
    expect(sub[0].tipo_saida).toBe('subproduto')

    // ciclo: a origem mais funda tentando ter o acabado como origem
    const antes = (await dbSelect('prod_estrutura', `company_id=eq.${DEMO_IND}&select=id`)).length
    await page.getByTestId(`add-origem-${COD.orig}`).click()
    await page.getByTestId('inc-busca').fill(COD.acab)
    await page.getByTestId(`inc-busca-op-${COD.acab}`).click()
    await expect(page.locator('[role="alert"], [data-testid="incluir-ligacao"]').first()).toBeVisible()
    expect((await dbSelect('prod_estrutura', `company_id=eq.${DEMO_IND}&select=id`)).length, 'ciclo não grava nada').toBe(antes)

    // arquivar (nunca apaga)
    await page.getByTestId(`irma-${COD.sub}`).getByTestId(`irma-${COD.sub}-arquivar`).click()
    await expect(page.getByTestId(`irma-${COD.sub}`)).toHaveCount(0)
    const arq = await estr(COD.orig, COD.sub)
    expect(arq.length, 'arquivada, não apagada (RD-30)').toBe(1)
    expect(arq[0].ativo).toBe(false)
  })

  test('acabado via fonte de produção: escolher cria o prod_produto ligado à fonte', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    const f = await dbInsert<{ id: string }[] | { id: string }>('prod_fonte_dados', { company_id: DEMO_IND, plant_id: plantId, tipo: 'producao', nome: 'atak' })
    const fonteId = (Array.isArray(f) ? f[0] : f)?.id ?? ''
    try {
      await dbInsert('ind_atak_fato', { company_id: DEMO_IND, dominio: 'e2e', chave_fato: `e2e-${K}`, raw: { COD_PRODUTO: COD.fonte, DESC_PRODUTO_EST: `E2E ${K} da fonte` } })
      await abrir(page)
      await page.getByTestId('acabado-busca').fill(COD.fonte)
      await page.getByTestId(`acabado-busca-op-${COD.fonte}`).click()
      await expect(page.getByTestId('acabado-atual')).toContainText(COD.fonte)
      const p = await produto(COD.fonte)
      expect(p.fonte_id, 'ligado à fonte').toBe(fonteId)
      expect(p.papel).toBe('acabado')
    } finally {
      await dbDelete('prod_fonte_dados', `id=eq.${fonteId}`).catch(() => {})
    }
  })

  test('colar lista: prévia avisa a linha inválida e grava só as válidas como rascunho', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    for (const [codigo, nome, papel] of [[COD.acab, 'acabado', 'acabado'], [COD.meio, 'meio', 'intermediario']]) {
      await dbInsert('prod_produto', { company_id: DEMO_IND, plant_id: plantId, codigo, nome: `E2E ${K} ${nome}`, papel })
    }
    await abrir(page)
    await page.getByTestId(`acabado-${COD.acab}`).click()
    await page.getByTestId('colar-lista').click()
    await page.getByTestId('colar-texto').fill(`${COD.meio};${COD.acab};principal;40,5;\n${COD.meio};NAOEXISTE${K};principal;5;`)
    await page.getByTestId('colar-previa').click()
    await expect(page.getByTestId('colar-resumo')).toContainText('1 válida')
    await expect(page.getByTestId('colar-linha-2')).toContainText('não está cadastrado')
    expect((await dbSelect('prod_estrutura', `company_id=eq.${DEMO_IND}&fonte_padrao=eq.colado&select=id`)).length, 'prévia não grava').toBe(0)
    await page.getByTestId('colar-gravar').click()
    await expect(page.getByTestId('colar-resumo')).toContainText('gravado')
    const e = await estr(COD.meio, COD.acab)
    expect(e.length).toBe(1)
    expect(e[0].status).toBe('rascunho')
    expect(Number(e[0].rendimento_padrao_pct)).toBe(40.5)
  })

  test('prontidão POR FLUXO: lista o que falta com link e só fica verde quando completo', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId || !setorId, 'a demonstração Indústria não tem planta/setor')
    await dbInsert('prod_fluxo', { company_id: DEMO_IND, plant_id: plantId, setor_id: setorId, nome: `E2E ${K} fluxo`, modo: 'compartilhado' })
    await abrir(page)
    await page.locator('select', { hasText: `E2E ${K} fluxo` }).first().selectOption({ label: `E2E ${K} fluxo` })
    const faixa = page.getByTestId('prontidao-fluxo')
    await expect(faixa).toContainText('não está pronto para medir')
    await expect(faixa).toContainText('produto de origem')
    await expect(faixa).toContainText('saídas')
    await expect(page.getByTestId('falta-fluxo-origem')).toBeVisible()
  })
})
