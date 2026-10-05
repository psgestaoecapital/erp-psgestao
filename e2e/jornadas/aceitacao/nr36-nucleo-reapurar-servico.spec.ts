// NR-36 · núcleo + porta (Eng. Chefe 05/10). Migration 20261005150010: fn_nr36_apurar_nucleo e fn_nr36_reapurar_servico
// são só service_role; a porta fn_nr36_apurar continua com o guarda de empresa. Aqui, como usuário logado (robô):
// o núcleo e a reapuração NÃO podem ser chamados; a porta continua recusando empresa sem acesso.
import { test, expect } from '../../support/fixtures'
import { obterSessionPayload } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const EMPRESA_ALHEIA = '00000000-0000-4000-a000-000000000000'

async function rpc(fn: string, args: Record<string, unknown>) {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
}

test.describe('NR-36 núcleo + porta', () => {
  test('núcleo e reapuração de serviço não são chamáveis por usuário logado @pos-migration', async () => {
    const nuc = await rpc('fn_nr36_apurar_nucleo', { p_company_id: EMPRESA_ALHEIA, p_dt_ini: '2022-01-01', p_dt_fim: '2022-01-02', p_cpf: null })
    expect([401, 403, 404], 'núcleo negado').toContain(nuc.status)
    const rea = await rpc('fn_nr36_reapurar_servico', { p_company: EMPRESA_ALHEIA, p_ini: '2022-01-01', p_fim: '2022-01-02' })
    expect([401, 403, 404], 'reapuração de serviço negada').toContain(rea.status)
  })

  test('a porta fn_nr36_apurar segue recusando empresa sem acesso @pos-migration', async () => {
    const r = await rpc('fn_nr36_apurar', { p_company_id: EMPRESA_ALHEIA, p_dt_ini: '2022-01-01', p_dt_fim: '2022-01-02', p_cpf: null })
    expect([401, 403]).toContain(r.status)
  })
})
