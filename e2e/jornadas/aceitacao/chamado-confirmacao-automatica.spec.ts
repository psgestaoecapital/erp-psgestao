// Confirmação automática de chamados (CEO 16/10, RD-97) · migration 20261017230010 · @pos-migration.
// Prova os prazos nas funções puras (sem tocar chamado de cliente): 3 e 5 dias úteis, fim de semana e feriado no meio,
// resposta do cliente cancelando, backlog e reabertura até 30 dias.
import { test, expect } from '../../support/fixtures'
import { obterSessionPayload } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('Chamados — confirmação automática', { tag: '@pos-migration' }, () => {
  let token = ''
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }
  const somar = (d: string, n: number) => rpc<string>('fn_sugestao_somar_dias_uteis', { p_data: d, p_dias: n })
  const decidir = (base: string, aviso: string | null, hoje: string, respondeu = false) =>
    rpc<string>('fn_sugestao_autoconfirmar_decisao', { p_base: base, p_aviso: aviso, p_hoje: hoje, p_cliente_respondeu: respondeu })

  test.beforeAll(async () => { token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token })

  test('3 e 5 dias úteis, com fim de semana e feriado no meio', async () => {
    expect(await somar('2026-10-14', 3)).toBe('2026-10-19') // qua → qui, sex, seg
    expect(await somar('2026-10-16', 3)).toBe('2026-10-21') // sex → seg, ter, qua (fim de semana no meio)
    expect(await somar('2026-10-30', 3)).toBe('2026-11-05') // 02/11 (Finados) não conta
  })

  test('aviso aos 3 du, conclusão 2 du depois do aviso; resposta do cliente cancela', async () => {
    expect(await decidir('2026-10-14', null, '2026-10-16')).toBe('nada')
    expect(await decidir('2026-10-14', null, '2026-10-19')).toBe('avisar')
    expect(await decidir('2026-10-14', '2026-10-19', '2026-10-20')).toBe('nada')
    expect(await decidir('2026-10-14', '2026-10-19', '2026-10-21')).toBe('concluir')
    expect(await decidir('2026-10-14', '2026-10-19', '2026-10-21', true)).toBe('cancelar')
    expect(await decidir('2026-10-14', null, '2026-10-19', true)).toBe('nada')
  })

  test('backlog: aviso no 1º ciclo e conclusão 2 du depois', async () => {
    expect(await decidir('2026-09-27', null, '2026-10-19')).toBe('avisar')
    expect(await decidir('2026-09-27', '2026-10-19', '2026-10-20')).toBe('nada')
    expect(await decidir('2026-09-27', '2026-10-19', '2026-10-21')).toBe('concluir')
  })

  test('reabrir só até 30 dias depois da conclusão', async () => {
    expect(await rpc<boolean>('fn_sugestao_pode_reabrir', { p_concluido_em: '2026-10-01T12:00:00Z', p_agora: '2026-10-31T12:00:00Z' })).toBe(true)
    expect(await rpc<boolean>('fn_sugestao_pode_reabrir', { p_concluido_em: '2026-10-01T12:00:00Z', p_agora: '2026-11-01T12:00:01Z' })).toBe(false)
  })
})
