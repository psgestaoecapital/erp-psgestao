// #1944 (Pdois · Jordana) · NFS-e com o grupo IBS/CBS do cadastro do serviço. O cIndOp que o cadastro preenche sozinho
// pelo NBS vinha da correlação LC116×NBS como número decimal ("100301.0", "20201.0" sem o zero da frente) — a emissão
// exige 6 dígitos (E0901) e, sem eles, a nota saía sem o grupo IBS/CBS. Catálogo global, só leitura aqui.

import { test, expect } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'
import { codigoIndicadorOperacaoValido } from '../../../src/lib/fiscal/retencoesFederaisNfse'

type Correlacao = { cclasstrib: string | null; cindop: string | null; ambiguo: boolean; encontrou: boolean }

test.describe('#1944 · correlação NBS → cIndOp com 6 dígitos', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-1944-correlacao-cindop', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('nenhuma linha da correlação com cIndOp fora de 6 dígitos', { tag: '@pos-migration' }, async () => {
    const ruins = await dbSelect<{ nbs: string; cindop: string }>('fiscal_correlacao_servico', 'cindop=not.is.null&cindop=not.match.%5E%5B0-9%5D%7B6%7D%24&select=nbs,cindop&limit=5')
    expect(ruins, 'cIndOp quebrado na correlação').toEqual([])
  })

  test('serviços da Pdois: o NBS preenche cIndOp que a emissão aceita (grupo IBS/CBS vai na nota)', { tag: '@pos-migration' }, async () => {
    // tabela do roteiro da contabilidade: campanhas publicitárias (17.06) e tráfego pago (17.25)
    for (const [nbs, lc116, esperado] of [['1.1406.11.00', '17.06', '100301'], ['1.1406.33.00', '17.25', '100101']] as const) {
      const [row] = await rpc<Correlacao[]>('fn_reforma_correlacao_servico', { p_nbs: nbs, p_lc116: lc116 })
      expect(row?.encontrou, `NBS ${nbs} na correlação`).toBe(true)
      expect(row.cindop, `cIndOp do NBS ${nbs}`).toBe(esperado)
      expect(row.cclasstrib).toBe('000001')
      expect(codigoIndicadorOperacaoValido(row.cindop), 'a rota de emissão aceita o código').toBe(true)
    }
  })
})
