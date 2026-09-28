// 🚨 Segurança PR E (CEO 28/09) · segredos Omie/Nibo/ContaAzul e senhas de certificado A1 saem de coluna de texto
// e vão para o Vault; o logado da empresa não lê nenhum deles. Migration 20260928235000.
// Nenhum teste lê ou transporta valor de segredo — só contagens e permissões.

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'

async function tokenDoBot(): Promise<string> {
  return (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
}

test.describe('Segurança PR E · segredos no Vault, nunca em coluna nem no navegador', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-segredos-vault-pre', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('sincronizar sem credencial salva responde com mensagem clara (servidor lê do Vault)', async ({ request }) => {
    const headers = { Authorization: `Bearer ${await tokenDoBot()}` }
    const r = await request.post('/api/omie/sync', { headers, data: { company_id: DEMO_GE, sync_type: 'clientes' } })
    expect(r.status(), 'sem chave no corpo e sem Vault → 400').toBe(400)
    expect(String((await r.json()).error ?? ''), 'mensagem para salvar em Conectores').toMatch(/Conectores/)
    expect((await request.post('/api/omie', { data: { endpoint: 'geral/empresas/', method: 'ListarEmpresas' } })).status(), 'proxy Omie exige login').toBe(401)
  })

  test('nenhum segredo em coluna; logado não lê o Vault', { tag: '@pos-migration' }, async () => {
    const comSegredo = await dbSelect<{ id: string }>('companies',
      'select=id&or=(omie_app_secret.not.is.null,omie_app_key.not.is.null,nibo_api_key.not.is.null,nibo_api_secret.not.is.null,contaazul_token.not.is.null)')
    expect(comSegredo, 'companies sem segredo em coluna').toEqual([])
    const certTexto = await dbSelect<{ id: string }>('erp_certificados_a1', 'select=id&senha_encrypted=not.is.null')
    expect(certTexto, 'nenhuma senha de certificado em texto').toEqual([])
    const credOmie = await dbSelect<{ company_id: string }>('erp_credencial', 'select=company_id&provider=eq.omie&chave=eq.app_secret&ativo=is.true')
    expect(new Set(credOmie.map(c => c.company_id)).size, 'as 6 empresas Omie com credencial no Vault').toBeGreaterThanOrEqual(6)

    const token = await tokenDoBot()
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_credencial_empresa_ler`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_provider: 'omie', p_chave: 'app_secret', p_company_id: DEMO_GE }),
    })
    expect(r.status, 'logado não executa a leitura do Vault').toBeGreaterThanOrEqual(400)
  })
})
