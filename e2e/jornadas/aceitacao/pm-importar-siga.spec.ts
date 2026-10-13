// PM-J · importador de jobs do SIGA (CEO 02/10). Migration 20261002270000 · @pos-migration.
// Na "Agência (P&M) - DEMO", como o robô (gestor): sobe uma planilha no formato de exportação, o mapa das colunas vem
// sugerido, a prévia aplica a regra (60 dias + em aberto; concluído antigo fica fora), "Conferir no sistema" mostra o
// que já existe e o que é novo, e "Importar" grava só os novos (com a etiqueta "siga"). Rodar de novo não duplica.
// Limpeza: os jobs de teste vão para a lixeira.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const NUM = String(900000000 + (Date.now() % 99999999))
const hoje = new Date()
const dd = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const recente = dd(new Date(hoje.getTime() - 5 * 86_400_000))
const antigo = dd(new Date(hoje.getTime() - 200 * 86_400_000))
const CSV = [
  'Nº Job,Título do Job,Cliente,Responsável,Status,Prazo,Data de Criação,Tipo de Peça',
  `24101,Já existe na demo,Café Serra Azul,,Em produção,${recente},${recente},Post feed`,
  `${NUM},Teste importação SIGA,Café Serra Azul,,Em aprovação,${recente},${recente},Reels`,
  `${Number(NUM) + 1},Concluído há muito tempo,Café Serra Azul,,Concluído,${antigo},${antigo},Post feed`,
].join('\n')

test.describe('PM-J — importar jobs do SIGA', () => {
  test.afterAll(async () => {
    await dbPatch('agency_jobs', `company_id=eq.${DEMO_PM}&numero=eq.${NUM}`, { excluido_em: new Date().toISOString() }).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-importar-siga', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('planilha → mapa → prévia → conferir → importar só o novo', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/importar-siga')
    await aguardarConteudo(page)
    await page.getByTestId('siga-arquivo').setInputFiles({ name: 'jobs-siga.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') })
    await expect(page.getByTestId('siga-mapa-numero')).toHaveValue('0', { timeout: 15000 })
    await expect(page.getByTestId('siga-mapa-cliente')).toHaveValue('2')
    await expect(page.getByTestId('siga-n-entram')).toHaveText('2')
    await expect(page.getByTestId('siga-n-fora')).toHaveText('1')
    for (const k of ['pm.siga.arquivo', 'pm.siga.mapa', 'pm.siga.previa']) await expect(page.getByTestId(`ajuda-${k}`).first()).toBeVisible()
    await page.getByTestId('siga-conferir').click()
    await expect(page.getByTestId('siga-n-existem')).toHaveText('1', { timeout: 15000 })
    await expect(page.getByTestId('siga-n-novos')).toHaveText('1')
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-j-importar-siga-previa.png', fullPage: true })
    await page.getByTestId('siga-importar').click()
    await expect(page.getByTestId('siga-feito')).toContainText('1 job(s) importado(s)', { timeout: 15000 })
    const [job] = await dbSelect<{ status: string; tags: string[]; cliente_id: string | null }>('agency_jobs', `company_id=eq.${DEMO_PM}&numero=eq.${NUM}&select=status,tags,cliente_id`)
    expect(job.status).toBe('em_aprovacao')
    expect(job.tags).toContain('siga')
    expect(job.cliente_id, 'cliente achado no cadastro').toBeTruthy()
  })
})
