// PM-D · Meu Dia, cronômetro, comentários com @, minhas últimas ações e anotações (CEO 02/10, visita à Pdois).
// Migration 20261002280000 · @pos-migration. Na "Agência (P&M) - DEMO", como o robô ("Assistente PS"):
//   1) Meu dia mostra o que é dele (atrasados/hoje), menções com @ para ele, a anotação fixada e as últimas ações;
//   2) cronômetro: iniciar num job, continua contando depois de recarregar a página, parar grava as horas;
//   3) comentário com @ no job aberto da Pauta (lista de sugestões enquanto digita) chega com a menção certa;
//   4) anotação nova aparece e some ao arquivar. Prints computador e celular.
// Limpeza: o comentário de teste vai para a lixeira (excluido_em), o cronômetro do teste fica fechado e o cenário
// da demo é re-armado (fn_demo_seed_pm_dia).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const CEO = '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'
const MARCA = `teste PM-D ${Date.now()}`

test.describe('PM-D — Meu dia', () => {
  let me = ''
  test.beforeAll(async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    me = (JSON.parse(atob(token.split('.')[1])) as { sub: string }).sub
  })
  test.afterAll(async () => {
    await dbPatch('agency_job_comentarios', `company_id=eq.${DEMO_PM}&texto=like.*${encodeURIComponent(MARCA)}*`, { excluido_em: new Date().toISOString() }).catch(() => {})
    await dbPatch('agency_anotacoes', `company_id=eq.${DEMO_PM}&texto=like.*${encodeURIComponent(MARCA)}*`, { excluido_em: new Date().toISOString() }).catch(() => {})
    if (me) await dbPatch('agency_timesheet', `company_id=eq.${DEMO_PM}&user_id=eq.${me}&fim_em=is.null`, { fim_em: new Date().toISOString(), horas: 0.01 }).catch(() => {})
    await rpc('fn_demo_seed_pm_dia', { p_company_id: DEMO_PM }).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-d-meu-dia', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('Meu dia: meus jobs, menções, anotações, cronômetro e últimas ações — prints', { tag: '@pos-migration' }, async ({ page }) => {
    // começa sem cronômetro aberto do robô
    await dbPatch('agency_timesheet', `company_id=eq.${DEMO_PM}&user_id=eq.${me}&fim_em=is.null`, { fim_em: new Date().toISOString(), horas: 0.01 })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/meu-dia')
    await aguardarConteudo(page)
    await expect(page.getByTestId('meu-dia-page')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('dia-mencao').first()).toContainText('@Assistente PS', { timeout: 20000 })
    await expect(page.getByTestId('dia-anotacoes')).toContainText('Ligar para a Clínica Sorriso')
    await expect(page.getByTestId('dia-acao').first()).toBeVisible()
    await expect(page.getByTestId('ajuda-pm.dia.anotacao.texto')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-d-meu-dia-computador.png', fullPage: true })

    // cronômetro: iniciar → conta → sobrevive ao recarregar → parar grava horas
    const select = page.getByTestId('cronometro-job-select')
    const opcoes = await select.locator('option').allTextContents()
    expect(opcoes.length, 'robô tem jobs para o cronômetro').toBeGreaterThan(1)
    await select.selectOption({ index: 1 })
    await page.getByTestId('cronometro-iniciar').click()
    await expect(page.getByTestId('cronometro-parar')).toBeVisible({ timeout: 15000 })
    const t1 = await page.getByTestId('cronometro-tempo').innerText()
    await page.waitForTimeout(2200)
    expect(await page.getByTestId('cronometro-tempo').innerText(), 'relógio andando').not.toBe(t1)
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.getByTestId('cronometro-parar'), 'continua rodando depois de recarregar').toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-d-cronometro.png', fullPage: false })
    await page.getByTestId('cronometro-parar').click()
    await expect(page.getByTestId('cronometro-msg')).toContainText('apontadas', { timeout: 15000 })
    const abertos = await dbSelect<{ id: string }>('agency_timesheet', `company_id=eq.${DEMO_PM}&user_id=eq.${me}&fim_em=is.null&select=id`)
    expect(abertos.length, 'cronômetro fechado no banco').toBe(0)

    // anotação: guardar e arquivar
    await page.getByTestId('dia-nota-texto').fill(`Lembrar do briefing da Pet Amigo — ${MARCA}`)
    await page.getByTestId('dia-nota-salvar').click()
    const nota = page.getByTestId('dia-nota').filter({ hasText: MARCA })
    await expect(nota).toBeVisible({ timeout: 15000 })
    await nota.getByRole('button', { name: 'arquivar' }).click()
    await expect(nota).toHaveCount(0, { timeout: 15000 })

    // celular
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/pm/meu-dia')
    await aguardarConteudo(page)
    await expect(page.getByTestId('cronometro')).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-d-meu-dia-celular.png', fullPage: false })
  })

  test('comentário com @ no job da Pauta chega com a menção', { tag: '@pos-migration' }, async ({ page }) => {
    const [job] = await dbSelect<{ id: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&numero=eq.24111&select=id`)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/dashboard/pm/pauta?job=${job.id}`)
    await aguardarConteudo(page)
    const caixa = page.getByTestId('job-comentario-texto')
    await expect(caixa).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('cronometro')).toBeVisible()
    await caixa.click()
    // a lista de pessoas é a dos usuários da empresa (Bloco 1); o usuário do CEO na demo chama-se "Administrador"
    await caixa.pressSequentially('@Adm')
    await expect(page.getByTestId('job-mencao-sugestoes')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('job-mencao-opcao').filter({ hasText: '@Administrador' }).click()
    await caixa.pressSequentially(`plantas atualizadas na landing — ${MARCA}`)
    await expect(caixa).toHaveValue(new RegExp(`^@Administrador plantas atualizadas`))
    await page.getByTestId('job-comentario-enviar').click()
    await expect(page.getByTestId('job-comentario').filter({ hasText: MARCA })).toBeVisible({ timeout: 15000 })
    const [c] = await dbSelect<{ mencoes: string[]; autor_id: string }>('agency_job_comentarios', `company_id=eq.${DEMO_PM}&texto=like.*${encodeURIComponent(MARCA)}*&select=mencoes,autor_id`)
    expect(c.mencoes, 'menção ao Administrador (CEO) gravada').toContain(CEO)
    expect(c.autor_id, 'comentário em nome do robô').toBe(me)
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-d-comentario-mencao.png', fullPage: false })
  })
})
