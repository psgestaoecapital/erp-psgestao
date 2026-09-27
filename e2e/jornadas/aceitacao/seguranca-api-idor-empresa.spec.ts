// Segurança · IDOR entre empresas nas rotas /api com service_role (ignoram RLS).
// Antes: bastava estar logado para ler/gravar dados de QUALQUER empresa passando o id dela.
// Agora a empresa pedida (ou a empresa REAL do registro) é conferida com get_user_company_ids()
// do próprio usuário: 403 fora dela, 400 sem empresa (sem empresa não é mais "todas").
// Aqui: (1) o bot lê a saúde da conciliação da Demonstração Comércio (200);
// (2) empresa inexistente/alheia → 403 e sem empresa → 400. Só leitura: nada é gravado.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const EMPRESA_ALHEIA = '00000000-0000-4000-a000-00000000dead'

async function tokenDoBot(): Promise<string> {
  return (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
}

test.describe('Segurança — rotas /api conferem a empresa do usuário (IDOR)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('seguranca-api-idor-empresa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('empresa do bot → /api/conciliacao/saude responde 200', async ({ request }) => {
    const token = await tokenDoBot()
    const resp = await request.get(`/api/conciliacao/saude?company_id=${DEMO_COMERCIO}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const corpo = await resp.json() as { saude?: unknown[]; error?: string }
    expect(resp.status(), JSON.stringify(corpo)).toBe(200)
    expect(Array.isArray(corpo.saude)).toBe(true)
  })

  test('empresa alheia → 403 e sem empresa → 400', async ({ request }) => {
    const headers = { Authorization: `Bearer ${await tokenDoBot()}` }

    const alheia = await request.get(`/api/conciliacao/saude?company_id=${EMPRESA_ALHEIA}`, { headers })
    const corpoAlheia = await alheia.json() as { ok?: boolean; saude?: unknown }
    expect(alheia.status(), JSON.stringify(corpoAlheia)).toBe(403)
    expect(corpoAlheia.ok).toBe(false)
    expect(corpoAlheia.saude).toBeUndefined()

    const semEmpresa = await request.get('/api/conciliacao/saude', { headers })
    const corpoSem = await semEmpresa.json() as { ok?: boolean; saude?: unknown }
    expect(semEmpresa.status(), JSON.stringify(corpoSem)).toBe(400)
    expect(corpoSem.ok).toBe(false)
    expect(corpoSem.saude).toBeUndefined()
  })
})
