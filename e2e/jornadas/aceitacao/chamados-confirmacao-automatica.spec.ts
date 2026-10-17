// Confirmação automática de chamados (CEO 16/10) · @pos-migration. Prova os PRAZOS pelas funções puras (não grava nada):
// 3 dias úteis avisa, 5 conclui, fim de semana e feriado no meio, backlog (aviso + 2 dias úteis).
import { test, expect } from '@playwright/test'

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  expect(r.ok, await r.clone().text()).toBeTruthy()
  return (await r.json()) as T
}
const fase = (aprovada: string, limite: string | null, hoje: string) => rpc<string>('fn_sugestao_autoconfirmar_fase', { p_aprovada: aprovada, p_limite: limite, p_hoje: hoje })

test.describe('Chamados — confirmação automática @pos-migration', () => {
  test.skip(!URL || !KEY, 'sem credenciais de serviço')

  test('3 dias úteis avisa, 2 ainda não', async () => {
    expect(await fase('2026-10-13', null, '2026-10-15')).toBe('nada')
    expect(await fase('2026-10-13', null, '2026-10-16')).toBe('avisar')
  })
  test('fim de semana no meio não conta', async () => {
    expect(await fase('2026-10-15', null, '2026-10-19')).toBe('nada')   // qui → seg = 1 dia útil
    expect(await fase('2026-10-15', null, '2026-10-20')).toBe('avisar') // → 3º dia útil (ter)
    expect(await rpc<string>('fn_sugestao_somar_du', { p_data: '2026-10-15', p_n: 5 })).toBe('2026-10-22')
  })
  test('feriado nacional no meio não conta (20/11)', async () => {
    expect(await rpc<string>('fn_sugestao_somar_du', { p_data: '2026-11-13', p_n: 5 })).toBe('2026-11-23')
  })
  test('conclui no limite, não antes; backlog = aviso + 2 dias úteis', async () => {
    expect(await rpc<string>('fn_sugestao_autoconfirmar_limite', { p_aprovada: '2026-10-13', p_hoje: '2026-10-16' })).toBe('2026-10-20')
    expect(await rpc<string>('fn_sugestao_autoconfirmar_limite', { p_aprovada: '2026-09-27', p_hoje: '2026-10-19' })).toBe('2026-10-21')
    expect(await fase('2026-09-27', '2026-10-21', '2026-10-20')).toBe('nada')
    expect(await fase('2026-09-27', '2026-10-21', '2026-10-21')).toBe('concluir')
  })
})
