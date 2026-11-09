// CEO 28/09 (decisão 2): as chaves que ficaram gravadas no histórico do registro de auditoria saem — só os valores,
// trocados por "[removido]", sem apagar nenhuma linha. A trava de imutabilidade (RD-54) é desligada só dentro da
// migration e volta ligada. Correção: nenhuma linha com segredo legível e as trocadas estão lá com "[removido]".
// Caminho principal: a auditoria continua imutável (a trava voltou) e as linhas de empresas continuam no histórico.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, rpc } from '../../support/api'

type Restantes = { linhas_com_segredo: number; linhas_removido: number; linhas_tabelas_alvo: number; trava_imutavel_ligada: boolean; tabelas: string[] }

test.describe('Auditoria sem segredo no histórico', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-auditoria-segredos-removidos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('nenhuma linha de auditoria com chave legível; as trocadas ficam com [removido]', { tag: '@pos-migration' }, async () => {
    const r = await rpc<Restantes>('fn_audit_segredos_restantes', {})
    expect(r.linhas_com_segredo, 'linhas com segredo legível').toBe(0)
    expect(r.linhas_removido, 'linhas com [removido] (7.738 em 28/09)').toBeGreaterThan(7000)
    expect(r.tabelas).toEqual(expect.arrayContaining(['companies', 'erp_fiscal_provider_config']))
  })

  test('caminho principal: auditoria segue imutável e as linhas continuam no histórico', { tag: '@pos-migration' }, async () => {
    const r = await rpc<Restantes>('fn_audit_segredos_restantes', {})
    expect(r.trava_imutavel_ligada, 'trava RD-54 ligada de novo').toBe(true)
    expect(r.linhas_tabelas_alvo, 'linhas das tabelas com segredo continuam na auditoria (8.695 em 28/09)').toBeGreaterThanOrEqual(8695)
  })
})
