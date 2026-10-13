// #107 (Frioeste · SST) · "os relatórios que subi têm colaboradores com horário de entrada e saída de pausa e no entanto
// está puxando como pendente horário de saída na aba Conferência, e no painel aparece como aguardando conferência".
// Causa: desde 16/09 o importador grava a pausa FECHADA com fim_origem NULL (o carimbo 'registrado' só existiu no
// backfill de 15/09) e a Conferência/o motor tratavam NULL como "sem confirmação". Migration 20260927190000: a origem
// efetiva é 'registrado' quando o relatório trouxe o fim de uma pausa normal/excesso/insuficiente.
// 1º teste (@pos-migration): pausa fechada, sem carimbo, NÃO aparece na Conferência.
// 2º teste (caminho principal, roda no preview): a Conferência abre e lista a pausa realmente sem saída.
// Demonstração Indústria (SST), nunca a Frioeste; as duas pausas de teste são removidas no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const DIA = '2026-09-18'
const ids: string[] = []
let colaborador = ''

test.describe('Conferência de pausas — pausa com saída no relatório não é pendente (#107)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ nome: string; cpf: string }>('ind_ponto_colaborador',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=nome,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    colaborador = c.nome
    // igual ao que o importador grava hoje: pausa fechada de 22 min, classe normal, fim_origem NULL
    ids.push((await dbInsert<{ id: string }>('ind_ponto_pausa', {
      company_id: DEMO_SST, cpf: c.cpf, data: DIA, tipo: 'termica_253',
      inicio: `${DIA}T09:07:00-03:00`, fim: `${DIA}T09:29:00-03:00`, duracao_seg: 1320,
      classe_evento: 'pausa_normal', raw: { origem: 'e2e-107' },
    })).id)
    // pausa realmente sem saída: esta TEM de aparecer na Conferência
    ids.push((await dbInsert<{ id: string }>('ind_ponto_pausa', {
      company_id: DEMO_SST, cpf: c.cpf, data: DIA, tipo: 'termica_253',
      inicio: `${DIA}T14:13:00-03:00`, fim: null, classe_evento: 'pausa_aberta', raw: { origem: 'e2e-107' },
    })).id)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-107-pausa-fechada', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (ids.length) await dbDelete('ind_ponto_pausa', `id=in.(${ids.join(',')})`).catch(() => {})
  })

  async function abrirConferencia(page: import('@playwright/test').Page) {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/compliance/pausas-tecnicas')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: 'Conferência' }).click()
    await expect(page.getByText('Conferência — pausas sem hora de saída')).toBeVisible({ timeout: 20000 })
  }
  const linha = (page: import('@playwright/test').Page, inicio: string) =>
    page.locator('tbody tr').filter({ hasText: colaborador }).filter({ hasText: inicio })

  test('caminho principal: a pausa sem saída aparece na Conferência para confirmar', async ({ page }) => {
    await abrirConferencia(page)
    await expect(linha(page, '14:13'), 'pausa aberta às 14:13 listada').toBeVisible({ timeout: 20000 })
  })

  test('pausa com entrada e saída no relatório NÃO aparece como pendente @pos-migration', async ({ page }) => {
    await abrirConferencia(page)
    await expect(linha(page, '14:13')).toBeVisible({ timeout: 20000 })
    await expect(linha(page, '09:07'), 'pausa 09:07→09:29 (fechada) fora da Conferência').toHaveCount(0)
  })
})
