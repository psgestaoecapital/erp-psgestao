// Hub · Mão de obra (SPEC Hub E1+E2 rev.15 seção 5 · CEO aprovou a lista do banco 01/10).
// Caminho principal (pela tela): nova função → novo perfil padrão (2 pessoas, R$ 2.800 + benefícios) → a ficha mostra o
// custo com os encargos da empresa enquanto digita → salvo fica "não conferido" e NÃO entra no custo da função →
// "Conferir" → a função passa a ter custo/hora = média do grupo. Inativar tira do custo (nada é apagado — RD-30).
// Toda abertura de ficha com salário fica em erp_mao_obra_acesso_log (CEO 01/10).
// A conta da tela é a mesma do banco (fn_mao_obra_custo_calcular), inclusive o exemplo da SPEC (36,8% → R$ 31,18/h).
// Depende das tabelas/funções da migration 20261002100000 → @pos-migration. Demonstração Comércio (GE); dados de teste
// criados e removidos no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, rpc, registrarJornada } from '../../support/api'
import { calcularCustoMaoObra, chavesPadrao, type Encargos } from '../../../src/lib/hub/custoMaoObra'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const FUNCAO = `Gesseiro aceite ${RUN}`
const PERFIL = `Gesseiro padrão ${RUN}`
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
let funcaoId = ''

test.describe('Hub · Mão de obra — função, equipe conferida e custo da hora', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-mao-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const fs = await dbSelect<{ id: string }>('erp_funcao_mao_obra', `company_id=eq.${DEMO_GE}&nome=eq.${encodeURIComponent(FUNCAO)}&select=id`).catch(() => [])
    for (const f of fs) {
      const fichas = await dbSelect<{ id: string }>('erp_mao_obra_custo', `funcao_id=eq.${f.id}&select=id`).catch(() => [])
      for (const k of fichas) {
        await dbDelete('erp_mao_obra_acesso_log', `ficha_id=eq.${k.id}`).catch(() => {})
        await dbDelete('erp_mao_obra_componente', `ficha_id=eq.${k.id}`).catch(() => {})
      }
      await dbDelete('erp_mao_obra_custo', `funcao_id=eq.${f.id}`).catch(() => {})
      await dbDelete('erp_funcao_mao_obra', `id=eq.${f.id}`).catch(() => {})
    }
  })

  test('a conta do banco é a da tela (exemplo da SPEC: R$ 2.800 a 36,8% → R$ 5.487,03 · R$ 31,18/h)', { tag: '@pos-migration' }, async () => {
    const ficha = { vinculo: 'clt', forma_pagamento: 'mensal', salario: 2800, beneficio_vt: 300, beneficio_alimentacao: 500, horas_produtivas_mes: 176 } as const
    const enc = { prov_13_pct: 8.33, prov_ferias_pct: 11.11, prov_rescisao_pct: 4, encargos_folha_pct: 36.8 }
    const banco = await rpc<{ custo_mensal: number; custo_hora: number }>('fn_mao_obra_custo_calcular', { p_ficha: ficha, p_encargos: enc })
    expect(Number(banco.custo_mensal)).toBe(5487.03)
    expect(Number(banco.custo_hora)).toBe(31.18)
    const tela = calcularCustoMaoObra(ficha, enc)
    expect([tela.custo_mensal, tela.custo_hora]).toEqual([Number(banco.custo_mensal), Number(banco.custo_hora)])
  })

  test('caminho principal: função → perfil padrão → só conta depois de conferido → inativar tira do custo', { tag: '@pos-migration' }, async ({ page }) => {
    const enc = await rpc<Encargos>('fn_mao_obra_encargos_vigentes', { p_company_id: DEMO_GE })
    // v2 (componentes): o perfil tem um componente "fixo mensal" de R$ 2.800 — mesmo custo da ficha de salário único
    const esperado = calcularCustoMaoObra({ vinculo: 'clt', horas_produtivas_mes: 176, beneficio_vt: 300, beneficio_alimentacao: 500,
      componentes: [{ tipo: 'fixo', subtipo: 'mensal', valor: 2800, ...chavesPadrao('clt', 'fixo', 'mensal', enc.padroes?.incidencia ?? {}) }] }, enc)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/projetos/mao-obra')
    await aguardarConteudo(page)
    await expect(page.getByTestId('mao-obra-page')).toBeVisible()
    await expect(page.getByTestId('mao-obra-encargos'), 'a tela diz de onde vêm os encargos').toContainText(enc.provisorio ? 'provisórios' : 'confirmados')

    // 1) nova função
    await page.getByTestId('mao-obra-nova-funcao').click()
    await page.getByTestId('funcao-nome').fill(FUNCAO)
    await page.getByTestId('funcao-salvar').click()
    await expect.poll(async () => (await dbSelect<{ id: string }>('erp_funcao_mao_obra', `company_id=eq.${DEMO_GE}&nome=eq.${encodeURIComponent(FUNCAO)}&select=id`))[0]?.id ?? '',
      { timeout: 15000 }).not.toBe('')
    funcaoId = (await dbSelect<{ id: string }>('erp_funcao_mao_obra', `company_id=eq.${DEMO_GE}&nome=eq.${encodeURIComponent(FUNCAO)}&select=id`))[0].id

    // 2) perfil padrão com 2 pessoas — o custo aparece enquanto digita
    await page.getByTestId('mao-obra-novo-perfil').click()
    const modal = page.getByTestId('mao-obra-modal-ficha')
    await modal.getByTestId('ficha-funcao').selectOption(funcaoId)
    await modal.getByPlaceholder('Gesseiro padrão').fill(PERFIL)
    await modal.getByTestId('ficha-vinculo').selectOption('clt')
    await modal.getByTestId('ficha-horas').fill('176')
    await modal.getByTestId('ficha-quantidade').fill('2')
    await modal.getByTestId('componente-0').getByTestId('componente-tipo').selectOption('fixo')
    await modal.getByTestId('componente-0').getByTestId('componente-valor').fill('2800')
    await modal.getByTestId('ficha-beneficio_vt').fill('300')
    await modal.getByTestId('ficha-beneficio_alimentacao').fill('500')
    await expect(modal.getByTestId('ficha-custo-mensal')).toHaveText(brl(esperado.custo_mensal!))
    await expect(modal.getByTestId('ficha-custo-hora')).toHaveText(brl(esperado.custo_hora!))
    await modal.getByTestId('ficha-salvar').click()
    await expect(modal).toBeHidden({ timeout: 15000 })

    const [ficha] = await dbSelect<{ id: string; grupo_id: string; conferido: boolean; quantidade_pessoas: number }>('erp_mao_obra_custo',
      `funcao_id=eq.${funcaoId}&select=id,grupo_id,conferido,quantidade_pessoas`)
    expect(ficha?.conferido, 'entra como não conferido').toBe(false)
    expect(ficha.quantidade_pessoas).toBe(2)
    const antes = await rpc<{ origem: string; nao_conferidas: number }>('fn_funcao_custo_hora', { p_funcao_id: funcaoId })
    expect(antes.origem, 'não conferido não entra no custo da função').toBe('sem_dado')
    expect(antes.nao_conferidas).toBe(1)

    // CEO 01/10: toda abertura de ficha com salário fica no log (quem, quando, qual ficha) — a tela abriu a lista
    const log = await dbSelect<{ user_id: string; origem: string; em: string }>('erp_mao_obra_acesso_log', `ficha_id=eq.${ficha.id}&select=user_id,origem,em`)
    expect(log.some((l) => l.origem === 'lista' && !!l.user_id && !!l.em), 'abertura da ficha registrada no log').toBe(true)

    // 3) conferir → entra na média
    const linha = page.getByTestId(`mao-obra-linha-${ficha.grupo_id}`)
    await expect(linha.getByTestId('mao-obra-nao-conferido')).toBeVisible()
    await linha.getByTestId('mao-obra-conferir').click()
    await expect(linha.getByTestId('mao-obra-conferido')).toBeVisible({ timeout: 15000 })
    const depois = await rpc<{ origem: string; custo_hora: number; pessoas_conferidas: number }>('fn_funcao_custo_hora', { p_funcao_id: funcaoId })
    expect(depois.origem).toBe('media_grupo')
    expect(Number(depois.custo_hora)).toBe(esperado.custo_hora)
    expect(depois.pessoas_conferidas).toBe(2)
    await page.getByTestId('mao-obra-aba-funcoes').click()
    await expect(page.getByTestId(`mao-obra-funcao-${funcaoId}`).getByTestId('mao-obra-funcao-custo')).toHaveText(brl(esperado.custo_hora!))

    // 4) inativar o perfil (com motivo) → sai do custo, a linha continua no banco
    await page.getByTestId('mao-obra-aba-equipe').click()
    await linha.getByTestId('mao-obra-encerrar').click()
    await expect(page.getByTestId('encerrar-confirmar'), 'sem motivo não inativa').toBeDisabled()
    await page.getByTestId('encerrar-motivo').fill('Equipe desmobilizada (teste)')
    await page.getByTestId('encerrar-confirmar').click()
    await expect.poll(async () => (await rpc<{ origem: string }>('fn_funcao_custo_hora', { p_funcao_id: funcaoId })).origem, { timeout: 15000 }).toBe('sem_dado')
    const [enc2] = await dbSelect<{ ativo: boolean; motivo: string }>('erp_mao_obra_custo', `id=eq.${ficha.id}&select=ativo,motivo`)
    expect(enc2?.ativo, 'nada é apagado: a ficha fica inativa').toBe(false)
    expect(enc2.motivo).toContain('desmobilizada')
  })
})
