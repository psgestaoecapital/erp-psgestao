// 🚨 Segurança HOTFIX (28/09) · o usuário logado podia se promover a administrador trocando o próprio users.role
// (ou system_role) — abria todas as empresas. Migration 20260928140000: gatilho barra a troca de papel/acesso
// vinda da API por quem não é administrador PS. O usuário segue editando o próprio nome.
// Migration 20260928141000: user_scope só leitura pela API (o usuário se dava outro papel dentro da empresa).
// Migration 20260928142000: convite só pode ser ACEITO pelo próprio (não reescrito para outra empresa/papel).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

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

    // migration 20260928141000: user_scope (papel/nível/alçada dentro da empresa) não se grava direto pela API
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_scope?user_id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ nivel: 'editar' }),
    })
    expect(r.status, 'user_scope só leitura pela API').toBeGreaterThanOrEqual(400)
  })

  test('convite não é reescrito para outra empresa nem outro papel', { tag: '@pos-migration' }, async () => {
    const { token, id } = await sessao()
    const code = `SEG-${Date.now().toString(36)}`
    const inv = await dbInsert<{ id: string }>('invites', {
      company_id: DEMO_OFICINA, invite_code: code, role: 'viewer', email: 'convite-teste@psgestao.invalid',
      is_used: false, expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/invites?id=eq.${inv.id}`, {
        method: 'PATCH',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ company_id: DEMO_GE, client_role: 'CLIENT_OWNER', used_by: id, is_used: true }),
      })
      expect(r.status, 'reescrever convite').toBeGreaterThanOrEqual(400)
      const [depois] = await dbSelect<{ company_id: string; is_used: boolean }>('invites', `id=eq.${inv.id}&select=company_id,is_used`)
      expect(depois?.company_id).toBe(DEMO_OFICINA)
      expect(depois?.is_used).toBe(false)
    } finally {
      await dbDelete('invites', `id=eq.${inv.id}`).catch(() => {})
    }
  })
})
