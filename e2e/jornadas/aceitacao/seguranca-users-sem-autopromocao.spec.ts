// 🚨 Segurança HOTFIX (28/09) · o usuário logado podia se promover a administrador trocando o próprio users.role
// (ou system_role) — abria todas as empresas. Migration 20260928140000: gatilho barra a troca de papel/acesso
// vinda da API por quem não é administrador PS. O usuário segue editando o próprio nome.

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

async function sessao(): Promise<{ token: string; id: string }> {
  const s = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
  return { token: s.access_token, id: s.user.id }
}

async function patchUsuario(token: string, id: string, body: Record<string, unknown>): Promise<number> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  return r.status
}

test.describe('Segurança · usuário não se promove a administrador', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-users-autopromocao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('o usuário segue editando o próprio nome', async () => {
    const { token, id } = await sessao()
    const [eu] = await dbSelect<{ full_name: string | null }>('users', `id=eq.${id}&select=full_name`)
    expect(await patchUsuario(token, id, { full_name: eu?.full_name ?? 'Robô' }), 'salvar o próprio nome').toBeLessThan(300)
  })

  test('trocar o próprio papel para administrador é recusado', { tag: '@pos-migration' }, async () => {
    const { token, id } = await sessao()
    const [antes] = await dbSelect<{ role: string; system_role: string | null }>('users', `id=eq.${id}&select=role,system_role`)
    expect(antes?.role, 'o robô não é administrador').not.toMatch(/^(adm|acesso_total)$/)

    expect(await patchUsuario(token, id, { role: 'adm' }), 'role → adm').toBeGreaterThanOrEqual(400)
    expect(await patchUsuario(token, id, { system_role: 'PS_ADMIN_CVM' }), 'system_role → PS_ADMIN_CVM').toBeGreaterThanOrEqual(400)

    const [depois] = await dbSelect<{ role: string; system_role: string | null }>('users', `id=eq.${id}&select=role,system_role`)
    expect(depois?.role).toBe(antes?.role)
    expect(depois?.system_role).toBe(antes?.system_role)
  })
})
