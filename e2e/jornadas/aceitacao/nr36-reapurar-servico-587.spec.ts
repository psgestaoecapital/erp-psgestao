// #587 · núcleo + porta da apuração NR-36 (Eng. Chefe 05/10). fn_nr36_apurar_nucleo e fn_nr36_reapurar_servico são só
// service_role (sem assert, sem forjar identidade); a porta da tela segue protegida. Tudo na empresa DEMO, janela de
// 2023 (sem dado): nenhuma linha de cliente é tocada; o backup do teste é removido no fim.

import { test, expect } from '../../support/fixtures'
import { rpc, dbDelete, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const backups: string[] = []

async function comoAnon(fn: string, args: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
}

test.describe('NR-36: núcleo + porta e reapuração por serviço (#587)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-587-reapurar-servico', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of backups) await dbDelete('nr36_pausa_apurada_backup', `backup_id=eq.${id}`).catch(() => {})
  })

  test('núcleo e reapurar_servico não são chamáveis por anon; a porta da tela continua protegida', { tag: '@pos-migration' }, async () => {
    const args = { p_company_id: DEMO_SST, p_dt_ini: '2023-01-01', p_dt_fim: '2023-01-02', p_cpf: null }
    for (const [fn, a] of [
      ['fn_nr36_apurar_nucleo', args],
      ['fn_nr36_classificar_eventos_nucleo', { p_company_id: DEMO_SST }],
      ['fn_nr36_reapurar_servico', { p_company: DEMO_SST, p_ini: '2023-01-01', p_fim: '2023-01-02' }],
      ['fn_nr36_apurar', args],
    ] as Array<[string, Record<string, unknown>]>) {
      const r = await comoAnon(fn, a)
      expect([401, 403, 404], `${fn} bloqueada para anon (status ${r.status})`).toContain(r.status)
    }
  })

  test('reapurar_servico: backup carimbado, relatório antes→depois e teto de 31 dias', { tag: '@pos-migration' }, async () => {
    const r = await rpc<{ ok: boolean; backup_id: string; linhas_backup: number; dias_que_mudaram: number; antes_para_depois: unknown[] }>(
      'fn_nr36_reapurar_servico', { p_company: DEMO_SST, p_ini: '2023-01-01', p_fim: '2023-01-31' })
    backups.push(r.backup_id)
    expect(r.ok).toBe(true)
    expect(r.linhas_backup).toBe(0) // janela de 2023 não tem apuração
    expect(r.dias_que_mudaram).toBe(0)
    expect(Array.isArray(r.antes_para_depois)).toBe(true)
    await expect(rpc('fn_nr36_reapurar_servico', { p_company: DEMO_SST, p_ini: '2023-01-01', p_fim: '2023-02-15' })).rejects.toThrow(/periodo_maximo_31_dias/)
  })
})
