// RD-83 · CAMINHO PRINCIPAL da Matriz de Conformidade (#75), no CELULAR: abrir a matriz na Demonstração Indústria
// (SST), ver a primeira pessoa sem rolar, abrir "Filtros", aplicar um setor e conferir que a contagem muda (e bate
// com o banco). Depois salva os prints de celular (390) e computador (1440) no artefato aceitacao-diagnostico-host.
// Só leitura; só a demonstração. Não depende de migration (roda bloqueante no preview).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

test.describe('Caminho principal — Matriz de Conformidade no celular (#75)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-compliance-matriz', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abrir, filtrar por setor pela gaveta e a contagem muda (bate com o banco)', async ({ page }) => {
    test.setTimeout(120_000)
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const ativos = await dbSelect<{ id: string }>('compliance_funcionarios', `company_id=eq.${DEMO_SST}&ativo=eq.true&select=id`)
    const abate = await dbSelect<{ id: string }>('compliance_funcionarios', `company_id=eq.${DEMO_SST}&ativo=eq.true&setor=eq.Abate&select=id`)
    expect(abate.length).toBeGreaterThan(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/compliance/matriz')
    await aguardarConteudo(page)

    const contagem = page.getByTestId('matriz-contagem')
    await expect(contagem).toContainText(`${ativos.length} funcionários`, { timeout: 30000 })

    // a primeira pessoa aparece na primeira tela, sem rolar
    const primeira = page.getByText('Ana Paula Demo').first()
    await expect(primeira).toBeVisible()
    const box = await primeira.boundingBox()
    expect(box && box.y + box.height <= 844, 'a primeira pessoa aparece sem rolar').toBeTruthy()

    // cabeçalho com sigla curta (horizontal)
    await expect(page.getByTestId('matriz-sigla').filter({ hasText: /^ASO$/ })).toBeVisible()

    // Filtros → gaveta → setor Abate
    await page.getByTestId('matriz-filtros').click()
    const gaveta = page.getByTestId('matriz-gaveta')
    await gaveta.getByLabel('Setor').selectOption('Abate')
    await gaveta.getByTestId('matriz-gaveta-fechar').click()
    await expect(contagem, 'a contagem muda com o filtro').toContainText(`${abate.length} funcionários`, { timeout: 20000 })
    await expect(page.getByTestId('matriz-filtros')).toHaveText('Filtros (1)')
    await expect(page.getByTestId('matriz-filtro-ativo').filter({ hasText: 'Abate' })).toBeVisible()

    // tira o filtro pela etiqueta → volta ao total
    await page.getByTestId('matriz-filtro-ativo').filter({ hasText: 'Abate' }).click()
    await expect(contagem).toContainText(`${ativos.length} funcionários`, { timeout: 20000 })

    // prints para o CEO (#75): celular e computador — pasta que o aceitacao-pr.yml sempre sobe como artefato
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'e2e/diagnostico-host/prints-75-matriz-celular.png' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.getByText('Ana Paula Demo').first()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'e2e/diagnostico-host/prints-75-matriz-computador.png' })
  })
})
