// CEO 16/10 · confirmação automática de chamados: aviso com 3 dias úteis, conclusão com 5 dias úteis, backlog com
// aviso e conclusão 2 dias úteis depois, fim de semana e feriado fora da conta. Só funções puras (nenhum dado de cliente).
// @pos-migration: depende de 20261017230010_chamado_autoconfirmacao_5du.sql.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, rpc } from '../../support/api'

type Regra = { acao: string; limite?: string }
const regra = (aprovada: string, hoje: string, avisado = false, limite: string | null = null) =>
  rpc<Regra>('fn_sugestao_autoconfirmar_regra', { p_aprovada_em: aprovada, p_hoje: hoje, p_avisado: avisado, p_limite: limite })

test.describe('Chamado · confirmação automática (5 dias úteis)', { tag: '@pos-migration' }, () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-chamado-autoconfirmacao-5du', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('dias úteis pulam fim de semana e feriado nacional', async () => {
    // sex 2026-10-09: 12/10 (segunda) é feriado → +3 du = qui 15/10; +5 du = seg 19/10
    expect(await rpc<string>('fn_sugestao_somar_du', { p_data: '2026-10-09', p_dias: 3 })).toBe('2026-10-15')
    expect(await rpc<string>('fn_sugestao_somar_du', { p_data: '2026-10-09', p_dias: 5 })).toBe('2026-10-19')
  })

  test('aviso só a partir do 3º dia útil; conclusão no 5º', async () => {
    expect((await regra('2026-10-19', '2026-10-21')).acao).toBe('nada')              // 2 du
    const av = await regra('2026-10-19', '2026-10-22')                              // 3 du (seg→qui)
    expect(av.acao).toBe('avisar')
    expect(av.limite).toBe('2026-10-26')                                            // 5 du
    expect((await regra('2026-10-19', '2026-10-23', true, '2026-10-26')).acao).toBe('nada')
    expect((await regra('2026-10-19', '2026-10-26', true, '2026-10-26')).acao).toBe('concluir')
  })

  test('fim de semana no meio não conta', async () => {
    // quinta 22/10 + 3 du = terça 27/10
    expect((await regra('2026-10-22', '2026-10-26')).acao).toBe('nada')
    expect((await regra('2026-10-22', '2026-10-27')).acao).toBe('avisar')
  })

  test('backlog: aviso no 1º ciclo e conclusão 2 dias úteis depois', async () => {
    const av = await regra('2026-09-27', '2026-10-19')                              // muito antigo, segunda
    expect(av.acao).toBe('avisar')
    expect(av.limite).toBe('2026-10-21')
    expect((await regra('2026-09-27', '2026-10-20', true, '2026-10-21')).acao).toBe('nada')
    expect((await regra('2026-09-27', '2026-10-21', true, '2026-10-21')).acao).toBe('concluir')
  })
})
