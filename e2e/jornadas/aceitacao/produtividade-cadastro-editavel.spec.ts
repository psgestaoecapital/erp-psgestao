// Produtividade › Cadastro por fluxo (CEO 07/10, 1º fluxo da Frioeste): todo campo edita no lugar (clique → campo → Enter/sair
// salva, Esc cancela, "Salvo"/erro que ensina), com "?" de ajuda em campo e cabeçalho; excluir posto = arquivar (RD-30).
// Prova como usuário, pela tela (RD-82); o banco só confere. Demonstração Indústria (…05); tudo que o teste cria é removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const TAG = `E2E ${Date.now()}`

type Posto = { id: string; numero: string; atividade: string; capacidade_hora: number | null; centro_custo: string | null; cargo_id: string | null; ativo: boolean }

async function posto(atividade: string): Promise<Posto> {
  // o salvar da tela é assíncrono (resolve o cargo e depois chama a RPC): espera o posto aparecer antes de conferir (corrida vista na main 08/10)
  let l: Posto[] = []
  for (let i = 0; i < 20; i++) {
    l = await dbSelect<Posto>('prod_posto', `company_id=eq.${DEMO_IND}&atividade=eq.${encodeURIComponent(atividade)}&select=id,numero,atividade,capacidade_hora,centro_custo,cargo_id,ativo`)
    if (l.length > 0) break
    await new Promise((r) => setTimeout(r, 500))
  }
  expect(l.length, `posto "${atividade}" no banco`).toBe(1)
  return l[0]
}

test.describe('Produtividade — Cadastro por fluxo editável', () => {
  let plantId = ''
  let cargoId = ''
  test.beforeAll(async () => {
    const pl = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO_IND}&is_active=eq.true&select=id&limit=1`)
    plantId = pl[0]?.id ?? ''
    if (!plantId) return
    const cg = await dbInsert<{ id: string }[] | { id: string }>('prod_cargo', { company_id: DEMO_IND, plant_id: plantId, nome: `${TAG} cargo` })
    cargoId = (Array.isArray(cg) ? cg[0] : cg)?.id ?? ''
    await dbInsert('prod_unidade_medida', { company_id: DEMO_IND, plant_id: plantId, codigo: `${TAG}`.slice(0, 20), nome: `${TAG} un` })
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-produtividade-cadastro-editavel', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    const ps = await dbSelect<{ id: string }>('prod_posto', `company_id=eq.${DEMO_IND}&atividade=like.${encodeURIComponent(TAG + '*')}&select=id`).catch(() => [])
    for (const p of ps) await dbDelete('prod_posto_turno', `posto_id=eq.${p.id}`).catch(() => {})
    await dbDelete('prod_posto', `company_id=eq.${DEMO_IND}&atividade=like.${encodeURIComponent(TAG + '*')}`).catch(() => {})
    await dbDelete('prod_fluxo', `company_id=eq.${DEMO_IND}&nome=like.${encodeURIComponent(TAG + '*')}`).catch(() => {})
    await dbDelete('prod_cargo', `company_id=eq.${DEMO_IND}&nome=like.${encodeURIComponent(TAG + '*')}`).catch(() => {})
    await dbDelete('prod_unidade_medida', `company_id=eq.${DEMO_IND}&nome=like.${encodeURIComponent(TAG + '*')}`).catch(() => {})
  })

  test('criar fluxo → posto → editar cada tipo de campo → horário → arquivar', async ({ page }) => {
    test.skip(!plantId || !cargoId, 'a demonstração Indústria não tem planta industrial ativa')
    page.on('dialog', (d) => { void d.accept() })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto('/dashboard/produtividade')
    await aguardarConteudo(page)

    // fluxo novo
    await page.getByTestId('novo-fluxo').click()
    await page.getByTestId('novo-fluxo-nome').fill(`${TAG} fluxo`)
    await page.getByTestId('novo-fluxo-setor').selectOption({ index: 1 })
    await page.getByTestId('novo-fluxo-criar').click()
    await expect(page.getByTestId('fluxo-contexto')).toContainText(`${TAG} fluxo`)

    // posto novo
    await page.getByTestId('posto-novo-atividade').fill(`${TAG} refile`)
    await page.getByTestId('posto-novo-salvar').click()
    const p0 = await posto(`${TAG} refile`)
    const n = p0.numero
    const t = (c: string) => page.getByTestId(`posto-${n}-${c}`)
    await expect(t('atividade')).toHaveText(`${TAG} refile`)

    // texto: Enter salva e mostra "Salvo"; Esc cancela
    await t('atividade').click()
    await page.getByTestId(`posto-${n}-atividade-campo`).fill(`${TAG} desengorduramento`)
    await page.keyboard.press('Escape')
    await expect(t('atividade')).toHaveText(`${TAG} refile`)
    await t('atividade').click()
    await page.getByTestId(`posto-${n}-atividade-campo`).fill(`${TAG} alcatra`)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-atividade-salvo`)).toBeVisible()
    expect((await posto(`${TAG} alcatra`)).id).toBe(p0.id)

    // número: valor que erra ensina e não perde o digitado
    await t('capacidade').click()
    await page.getByTestId(`posto-${n}-capacidade-campo`).fill('abc')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-capacidade-erro`)).toContainText('só número')
    await expect(page.getByTestId(`posto-${n}-capacidade-campo`)).toHaveValue('abc')
    await page.getByTestId(`posto-${n}-capacidade-campo`).fill('420,5')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-capacidade-salvo`)).toBeVisible()
    expect(Number((await posto(`${TAG} alcatra`)).capacidade_hora)).toBe(420.5)

    // busca: cargo (digita, a lista sugere; grava o escolhido)
    await t('cargo').click()
    await page.getByTestId(`posto-${n}-cargo-campo`).fill(`${TAG} cargo`)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-cargo-salvo`)).toBeVisible()
    expect((await posto(`${TAG} alcatra`)).cargo_id).toBe(cargoId)

    // pessoas sem horário: erro que ensina
    await t('pessoas').click()
    await page.getByTestId(`posto-${n}-pessoas-campo`).fill('4')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-pessoas-erro`)).toContainText('horário')
    await page.keyboard.press('Escape')

    // turno e horário (hora) → depois pessoas grava
    await t('turno').click()
    await page.getByTestId('turno-entrada').fill('06:00')
    await page.getByTestId('turno-saida').fill('15:48')
    await page.getByTestId('turno-salvar').click()
    await expect(t('turno')).toContainText('06:00–15:48')
    await t('pessoas').click()
    await page.getByTestId(`posto-${n}-pessoas-campo`).fill('4')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-pessoas-salvo`)).toBeVisible()
    const quadros = await dbSelect<{ hora_entrada: string; pessoas: number }>('prod_posto_turno', `posto_id=eq.${p0.id}&vigencia_fim=is.null&select=hora_entrada,pessoas`)
    expect(quadros.length, 'um só quadro aberto').toBe(1)
    expect(quadros[0].hora_entrada.slice(0, 5)).toBe('06:00')
    expect(Number(quadros[0].pessoas)).toBe(4)

    // "+ mais campos": centro de custo
    await t('mais').click()
    await t('centro_custo').click()
    await page.getByTestId(`posto-${n}-centro_custo-campo`).fill('3.01 Desossa')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`posto-${n}-centro_custo-salvo`)).toBeVisible()
    const dep = await posto(`${TAG} alcatra`)
    expect(dep.centro_custo).toBe('3.01 Desossa')
    expect(Number(dep.capacidade_hora), 'editar um campo não apaga os outros (RD-55)').toBe(420.5)

    // fluxo: nome editável
    await page.getByTestId('fluxo-nome').click()
    await page.getByTestId('fluxo-nome-campo').fill(`${TAG} fluxo renomeado`)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('fluxo-contexto')).toContainText('renomeado')
    expect((await dbSelect('prod_fluxo', `company_id=eq.${DEMO_IND}&nome=eq.${encodeURIComponent(`${TAG} fluxo renomeado`)}&select=id`)).length).toBe(1)

    // arquivar (não apaga)
    await t('arquivar').click()
    await expect(page.getByTestId(`posto-${n}`)).toHaveCount(0)
    const arq = await posto(`${TAG} alcatra`)
    expect(arq.ativo, 'arquivado, não apagado (RD-30)').toBe(false)
    expect((await dbSelect('prod_posto_turno', `posto_id=eq.${p0.id}&vigencia_fim=is.null&select=id`)).length, 'quadro encerrado ao arquivar').toBe(0)
  })

  test('"?" em todo cabeçalho de coluna e campo do fluxo, com os 4 blocos', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    const setores = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_IND}&plant_id=eq.${plantId}&select=id&limit=1`)
    test.skip(setores.length === 0, 'a demonstração Indústria não tem setor')
    await dbInsert('prod_fluxo', { company_id: DEMO_IND, plant_id: plantId, setor_id: setores[0].id, nome: `${TAG} fluxo ajuda`, modo: 'compartilhado' })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto('/dashboard/produtividade')
    await aguardarConteudo(page)
    const chaves = await dbSelect<{ chave: string; vertical: string; rota: string }>('erp_ajuda_campo', `rota=eq.${encodeURIComponent('/dashboard/produtividade')}&select=chave,vertical,rota`)
    expect(chaves.length).toBeGreaterThanOrEqual(24)
    expect(chaves.every((c) => c.vertical === 'industria' && /^prod\.(fluxo|posto|turno|salario|produto|estrutura)\./.test(c.chave))).toBe(true)
    for (const k of ['prod.posto.numero', 'prod.posto.atividade', 'prod.posto.cargo', 'prod.posto.turno_horario', 'prod.posto.pessoas', 'prod.posto.capacidade']) {
      await page.getByTestId(`ajuda-${k}`).first().click()
      const cartao = page.getByTestId(`ajuda-cartao-${k}`)
      for (const b of ['O que preencher', 'Para que serve no cálculo', 'Exemplo', 'Erro comum']) await expect(cartao.getByText(b, { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  test('cargo do posto lista as funções do ponto e, ao escolher, liga o cargo ao ponto', { tag: '@pos-migration' }, async ({ page }) => {
    test.skip(!plantId, 'a demonstração Indústria não tem planta industrial ativa')
    const setores = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_IND}&plant_id=eq.${plantId}&select=id&limit=1`)
    test.skip(setores.length === 0, 'a demonstração Indústria não tem setor')
    const funcao = `${TAG} AJUDANTE PONTO`
    const fontes = await dbSelect<{ id: string }>('prod_fonte_dados', `company_id=eq.${DEMO_IND}&plant_id=eq.${plantId}&tipo=eq.ponto&select=id&limit=1`)
    let fonteCriada = ''
    if (fontes.length === 0) {
      const f = await dbInsert<{ id: string }[] | { id: string }>('prod_fonte_dados', { company_id: DEMO_IND, plant_id: plantId, tipo: 'ponto', nome: `${TAG} ponto` })
      fonteCriada = (Array.isArray(f) ? f[0] : f)?.id ?? ''
    }
    const cpfs = [0, 1].map((i) => `${Date.now()}${i}`.slice(-11))
    try {
      for (const cpf of cpfs) await dbInsert('ind_ponto_colaborador', { company_id: DEMO_IND, plant_id: plantId, provider: 'e2e', cpf, nome: `${TAG} pessoa`, funcao })
      await dbInsert('prod_fluxo', { company_id: DEMO_IND, plant_id: plantId, setor_id: setores[0].id, nome: `${TAG} fluxo cargo`, modo: 'compartilhado' })
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
      await page.goto('/dashboard/produtividade')
      await aguardarConteudo(page)
      // a função do ponto aparece na lista, com a contagem de pessoas (sem dado pessoal)
      await expect(page.locator(`datalist option[value="${funcao} · 2"]`).first()).toBeAttached()
      await page.getByTestId('posto-novo-atividade').fill(`${TAG} posto cargo`)
      await page.getByTestId('posto-novo-cargo').fill(`${funcao} · 2`)
      await page.getByTestId('posto-novo-salvar').click()
      // salvar = resolver cargo (RPC) → posto (RPC): só depois a linha nova é limpa; ler o banco antes disso é corrida
      await expect(page.getByTestId('posto-novo-atividade'), 'salvou (linha nova limpa)').toHaveValue('', { timeout: 20_000 })
      const p0 = await posto(`${TAG} posto cargo`)
      const cg = await dbSelect<{ id: string }>('prod_cargo', `company_id=eq.${DEMO_IND}&plant_id=eq.${plantId}&nome=eq.${encodeURIComponent(funcao)}&select=id`)
      expect(cg.length, 'prod_cargo criado a partir da função do ponto').toBe(1)
      expect(p0.cargo_id).toBe(cg[0].id)
      const v = await dbSelect<{ chave: string }>('prod_cargo_vinculo', `cargo_id=eq.${cg[0].id}&select=chave`)
      expect(v.length, 'vínculo com o ponto gravado').toBeGreaterThan(0)
      await expect(page.getByTestId('cargos-ponto-vinculados')).toContainText('ligada(s) a cargos')
    } finally {
      await dbDelete('ind_ponto_colaborador', `company_id=eq.${DEMO_IND}&funcao=eq.${encodeURIComponent(funcao)}`).catch(() => {})
      if (fonteCriada) await dbDelete('prod_fonte_dados', `id=eq.${fonteCriada}`).catch(() => {})
    }
  })
})
