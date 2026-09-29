// #273 (Frioeste · SST) · Supervisão: "pausa de undefined minutos às undefined"; e pedir filtro por colaborador com o
// detalhe de cada desvio do dia. Causa: a apuração atual grava { tipo: 'pausa_insuficiente', quantidade } e as pausas em
// detalhe.pausas; a tela lia o formato antigo. Migration 20260929040000: fn_nr36_supervisao_casos devolve as pausas.
// Demonstração Indústria (SST): um dia de desvio sintético (formato da apuração atual), removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const base = new Date(Date.UTC(1995, 0, 2) + (Math.floor(Date.now() / 60000) % 3650) * 86400000)
const DIA = base.toISOString().slice(0, 10)
let cpf = ''
let nome = ''

test.describe('Supervisão de pausas — detalhe do desvio e filtro por colaborador (#273)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ id: string; nome: string; cpf: string }>('ind_ponto_colaborador',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=id,nome,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    cpf = c.cpf; nome = c.nome
    // o dia do Anderson (16/09) no formato gravado pela apuração atual (termica_253_v2)
    await dbInsert('nr36_pausa_apurada', {
      company_id: DEMO_SST, colaborador_id: c.id, cpf, data: DIA, tipo: 'termica_253', jornada_seg: 31200,
      devido_min: 100, realizado_min: 60, diferenca_min: -40, status: 'desvio', apurado_em: new Date().toISOString(),
      detalhe: {
        motor: 'exposicao_ponto', regra: { versao: 'termica_253_v2', pausa_min: 20, gatilho_min: 100 },
        jornada: { shift: '04:00-09:00 10:10-13:50', inicio: '03:55', fim: '13:47' },
        desvios: [{ tipo: 'pausa_insuficiente', quantidade: 1 }],
        pausas: [{ de: '05:36', ate: '05:56', min: 21, classe: 'pausa_normal' }, { de: '07:42', ate: '08:02', min: 19, classe: 'pausa_insuficiente' },
          { de: '11:37', ate: '12:03', min: 26, classe: 'pausa_excesso' }],
        origem: 'e2e-273',
      },
    })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-273-supervisao-detalhe', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (cpf) await dbDelete('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
  })

  test('o caso mostra cada pausa curta com horário e minutos, o excesso como gestão, e filtra por colaborador', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/compliance/pausas-tecnicas')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: 'Supervisão' }).click()
    const datas = page.locator('input[type="date"]')
    await datas.nth(0).fill(DIA)
    await datas.nth(1).fill(DIA)
    await page.getByRole('button', { name: /Atualizar/ }).click()

    const filtro = page.getByTestId('sup-filtro-colaborador')
    await expect(filtro.locator('option', { hasText: nome })).toHaveCount(1, { timeout: 20000 })
    await filtro.selectOption(nome)
    const caso = page.getByRole('button').filter({ hasText: nome }).filter({ hasText: DIA.split('-').reverse().join('/') })
    await expect(caso).toBeVisible()
    await caso.click()
    const frases = page.getByTestId('sup-frase')
    await expect(frases.first()).toBeVisible()
    await expect(frases.filter({ hasText: 'pausa das 07:42 às 08:02: 19 min — o mínimo é 20 min' })).toHaveCount(1)
    await expect(frases.filter({ hasText: 'pausa das 11:37 às 12:03: 26 min — acima do tempo previsto (gestão, não é infração)' })).toHaveCount(1)
    await expect(page.getByText(/undefined/)).toHaveCount(0)
  })
})
