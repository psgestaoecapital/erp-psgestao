// PDCA fiscal (aud8 72/95) · /dashboard/fiscal/gov-nfse (NFSe Nacional gov.br).
// Antes, a tela quebrava na abertura com o banner "Erro ao carregar" e os indicadores caíam a ZERO
// (falso-zero), porque as consultas iniciais pediam colunas inexistentes (erp_gov_nfse_municipios.nome /
// v_gov_nfse_dps_pendentes.criado_em). Qualquer das duas falhando derrubava a tela inteira.
// Esta jornada prova (data-independente) que a tela abre SEM erro e com indicadores reais:
//  - o indicador "Municípios aderidos" renderiza "N municípios" (consulta OK), nunca "—";
//  - o indicador "DPSes pendentes" renderiza "N pendente(s)" (consulta OK), nunca "—";
//  - o bloco de falha "Não foi possível carregar" NÃO aparece na abertura.
// Demonstração Comércio (GE). Só leitura: não cria nem altera dado.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Fiscal · NFSe Nacional gov.br carrega sem "Erro ao carregar"', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('fiscal-gov-nfse-carrega', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('abre com indicadores reais e sem banner de erro', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/fiscal/gov-nfse')
    await aguardarConteudo(page)

    // cabeçalho da tela
    await expect(page.getByRole('heading', { name: /NFSe Nacional gov\.br/i })).toBeVisible()

    // nenhuma seção caiu no estado de FALHA ao carregar (o bug antigo)
    await expect(page.getByText('Não foi possível carregar', { exact: false })).toHaveCount(0)

    // indicador de municípios: "N municípios" (número real = consulta OK), nunca "—"
    await expect(page.getByText(/\d+\s+municípios/)).toBeVisible()

    // indicador de DPSes pendentes: "N pendente(s)" (número real = consulta OK), nunca "—"
    await expect(page.getByText(/\d+\s+pendentes?/)).toBeVisible()
  })
})
