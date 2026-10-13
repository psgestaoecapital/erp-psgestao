// #94 / #142 (Gean) · NF-e de DEVOLUÇÃO DE COMPRA saía sem a nota de origem nas observações (NF-e 620, 621, 622
// de 25/09: chave referenciada gravada, "informações complementares" vazias). A correção de 23/09 cobriu só a
// devolução de VENDA. Agora a rota de devolução de compra manda "Devolução referente à NF-e nº X, série Y,
// emitida em DD/MM/AAAA - chave …", e a tela mostra essa prévia antes de emitir (mesma função).
// Sem migration: roda no preview. Demonstração Comércio (GE); nenhuma nota é emitida (fixture bloqueia /api/fiscal).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'
import { textoObsDevolucaoCompra } from '../../../src/lib/fiscal/obsDevolucaoTexto'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'

test.describe('Devolução de compra — NF de origem nas observações (#94/#142)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-devolucao-compra-obs-94', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('regra do texto: dados da nota recebida; sem ela, número e série saem da chave', async () => {
    // Caso real do #142 (NF-e 622 → NF 1766077 do fornecedor, emitida 23/09 às 14:31 de Brasília).
    const chave = '42260984586205001081550000017660771996525791'
    expect(textoObsDevolucaoCompra(chave, { numero: '1766077', serie: '0', data_emissao: '2026-09-23 17:31:15+00' }))
      .toBe(`Devolução referente à NF-e nº 1766077, série 0, emitida em 23/09/2026 - chave de acesso ${chave}.`)
    // Emitida 22:30 de Brasília = 01:30 UTC do dia seguinte: vale o dia de Brasília.
    expect(textoObsDevolucaoCompra(chave, { numero: '1766077', serie: '0', data_emissao: '2026-09-24 01:30:00+00' }))
      .toContain('emitida em 23/09/2026')
    // Sem a nota recebida: número 1766077 e série 0 vêm da própria chave.
    expect(textoObsDevolucaoCompra(chave, null)).toBe(`Devolução referente à NF-e nº 1766077, série 0 - chave de acesso ${chave}.`)
  })

  test('a tela mostra a observação que vai na nota, a partir da NF de compra', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [rec] = await dbSelect<{ id: string; numero: string; serie: string; data_emissao: string; chave_acesso: string }>('erp_nfe_recebidas',
      `company_id=eq.${DEMO_COMERCIO}&chave_acesso=not.is.null&select=id,numero,serie,data_emissao,chave_acesso&order=numero.desc&limit=1`)
    expect(rec, 'a demonstração tem NF-e de compra recebida').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto(`/dashboard/fiscal/nfe/devolucao?recebida_id=${rec.id}`)
    await aguardarConteudo(page)

    const esperado = textoObsDevolucaoCompra(rec.chave_acesso, rec)
    await expect(page.getByTestId('nfe-devol-obs')).toHaveText(esperado, { timeout: 20000 })
    expect(esperado).toContain(`NF-e nº ${rec.numero}, série ${rec.serie}, emitida em `)
  })
})
