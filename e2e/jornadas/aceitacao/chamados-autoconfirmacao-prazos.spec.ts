// Confirmação automática de chamados (CEO 16/10, RD-97): aviso com 3 dias úteis, conclusão com 5 (2 depois do aviso),
// fim de semana e feriado não contam, resposta do cliente cancela, reabertura até 30 dias. Prova a decisão pura
// fn_sugestao_autoconfirmar_decisao (sem tocar dado de cliente). Precisa da migration → @pos-migration.
import { createClient } from '@supabase/supabase-js'
import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const sb = () => createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } })
// meio-dia de Brasília = 15:00Z
const dia = (iso: string) => `${iso}T15:00:00Z`
const decidir = async (aprovada: string, aviso: string | null, agora: string) => {
  const { data, error } = await sb().rpc('fn_sugestao_autoconfirmar_decisao', { p_aprovada_em: dia(aprovada), p_aviso_em: aviso ? dia(aviso) : null, p_agora: dia(agora) })
  expect(error).toBeNull()
  return data as string
}

test.describe('Chamados · confirmação automática (prazos em dias úteis)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-chamados-autoconfirmacao-prazos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  // 2026-10-05 é segunda-feira
  test('aviso só com 3 dias úteis sem resposta', async () => {
    expect(await decidir('2026-10-05', null, '2026-10-07')).toBe('nada')
    expect(await decidir('2026-10-05', null, '2026-10-08')).toBe('avisar')
  })
  test('fim de semana no meio não conta: resposta na quinta 08/10 → aviso só na quarta 14/10 (12/10 é feriado)', async () => {
    expect(await decidir('2026-10-08', null, '2026-10-12')).toBe('nada') // feriado nacional
    expect(await decidir('2026-10-08', null, '2026-10-13')).toBe('nada')
    expect(await decidir('2026-10-08', null, '2026-10-14')).toBe('avisar')
  })
  test('conclui 2 dias úteis depois do aviso (5 dias úteis no total)', async () => {
    expect(await decidir('2026-10-05', '2026-10-08', '2026-10-09')).toBe('nada')
    expect(await decidir('2026-10-05', '2026-10-08', '2026-10-12')).toBe('nada') // feriado
    expect(await decidir('2026-10-05', '2026-10-08', '2026-10-13')).toBe('concluir')
  })
  test('backlog: sem aviso e já vencido recebe aviso primeiro, nunca conclui direto', async () => {
    expect(await decidir('2026-09-01', null, '2026-10-13')).toBe('avisar')
  })
  test('aviso anterior à última resposta aprovada não vale (resposta do cliente cancela e recomeça)', async () => {
    expect(await decidir('2026-10-08', '2026-10-05', '2026-10-14')).toBe('avisar')
  })
  test('fora de dia útil nada acontece', async () => {
    expect(await decidir('2026-10-01', null, '2026-10-10')).toBe('nada') // sábado
  })
})
