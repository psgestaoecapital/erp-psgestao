// Achado do caminho do #136: a tela de Conexões bancárias disparava "Minified React error #418" (hidratação) no
// celular. Causa: useCompanyIds lia o localStorage no inicializador do useState — o servidor (sem localStorage)
// pintava "Selecione uma empresa…" e o cliente pintava a tela da empresa → HTML diferente. Agora o 1º render é igual
// ao do servidor e a empresa escolhida entra logo após montar. O hook é usado por ~135 telas; aqui ficam 3 que
// mudam de conteúdo conforme a empresa. Só leitura. Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const TELAS: { rota: string; texto: RegExp }[] = [
  { rota: '/dashboard/financeiro/conexoes-bancarias', texto: /conex(ões|oes) banc(á|a)rias/i },
  { rota: '/dashboard/commerce/estoque', texto: /estoque/i },
  { rota: '/dashboard/financeiro/pagar?area=gestao_empresarial', texto: /pagar/i },
]

test.describe('Telas por empresa abrem sem erro de hidratação', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hidratacao-empresa-sel', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  for (const t of TELAS) {
    test(`abrir ${t.rota} sem erro de JavaScript`, async ({ page }) => {
      const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
      expect(emp?.is_demo, 'só na demonstração').toBe(true)
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
      const erros: string[] = []
      page.on('pageerror', (e) => erros.push(e.message))
      await page.goto(t.rota)
      await aguardarConteudo(page)
      await expect(page.getByText(t.texto).first(), 'a tela abre').toBeVisible({ timeout: 20000 })
      await expect(page.getByText(/Selecione uma empresa espec/i)).toHaveCount(0)
      expect(erros, 'sem erro de JavaScript (inclui React #418)').toEqual([])
    })
  }
})
