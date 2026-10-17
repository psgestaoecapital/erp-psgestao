// CEO 16/10 · confirmação automática de chamados: aviso com 3 dias úteis, conclusão com 5, resposta cancela, backlog
// avisa no 1º ciclo e conclui 2 dias úteis depois. Migration 20261018000010 (@pos-migration). Só funções puras, sem gravar.

import { test, expect } from '../../support/fixtures'
import { rpc } from '../../support/api'

// resposta aprovada na segunda 05/10/2026 (BRT); 12/10 é feriado nacional (N. Sra. Aparecida), então os dias úteis
// seguintes são 06, 07, 08, 09, 13...
const RESP = '2026-10-05T15:00:00Z'
const dec = (aviso: string | null, respondeu: boolean, agora: string) =>
  rpc<string>('fn_sugestao_autoconfirmar_decisao', { p_resposta_em: RESP, p_aviso_em: aviso, p_cliente_respondeu: respondeu, p_agora: agora })

test.describe('Confirmação automática de chamados', () => {
  test('aviso no 3º dia útil, conclusão no 5º, fim de semana e feriado não contam', { tag: '@pos-migration' }, async () => {
    expect(await dec(null, false, '2026-10-07T11:00:00Z'), '2 dias úteis: ainda não avisa').toBe('aguardar')
    expect(await dec(null, false, '2026-10-08T11:00:00Z'), '3º dia útil: avisa').toBe('avisar')
    expect(await dec(null, false, '2026-10-10T11:00:00Z'), 'sábado nunca age').toBe('aguardar')
    expect(await dec('2026-10-08T11:00:00Z', false, '2026-10-09T11:00:00Z'), '4º dia útil: espera').toBe('aguardar')
    expect(await dec('2026-10-08T11:00:00Z', false, '2026-10-13T11:00:00Z'), '5º dia útil (12/10 feriado): conclui').toBe('concluir')
    expect(await rpc<string>('fn_sugestao_dia_util_apos', { p_data: '2026-10-09', p_dias: 1 }), 'sexta + 1 du pula fim de semana e feriado').toBe('2026-10-13')
  })

  test('resposta do cliente cancela; backlog avisa no 1º ciclo e conclui 2 dias úteis depois', { tag: '@pos-migration' }, async () => {
    expect(await dec('2026-10-08T11:00:00Z', true, '2026-10-13T11:00:00Z'), 'resposta depois do aviso cancela').toBe('cancelar')
    expect(await dec(null, true, '2026-10-13T11:00:00Z'), 'resposta sem aviso: nada a fazer').toBe('aguardar')
    expect(await dec(null, false, '2026-10-14T11:00:00Z'), 'backlog: avisa no 1º ciclo').toBe('avisar')
    expect(await dec('2026-10-14T11:00:00Z', false, '2026-10-15T11:00:00Z'), 'backlog: 1 du depois ainda espera').toBe('aguardar')
    expect(await dec('2026-10-14T11:00:00Z', false, '2026-10-16T11:00:00Z'), 'backlog: 2 du depois conclui').toBe('concluir')
  })
})
