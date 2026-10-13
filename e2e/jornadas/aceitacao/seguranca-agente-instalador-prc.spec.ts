// 🚨 Segurança PR C (CEO 28/09) · o instalador do agente ATAK saía do bucket PÚBLICO 'agente'. Agora a tela
// Conectores pede /api/agente/instalador, que confere empresa do usuário + conexão ATAK cadastrada e devolve URL
// ASSINADA (10 min) do .exe e do nssm.exe. Condição do CEO antes de fechar o bucket: a tela tem de baixar a versão
// publicada. Caminho principal: o robô pega o link da Frioeste (única empresa com agente) e baixa só os 2 primeiros
// bytes do .exe ("MZ") — leitura, nada é gravado. Negado: demo sem conexão ATAK → 404; empresa alheia → 403.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload } from '../../support/api'

const FRIOESTE = '975365cc-9e5a-4251-9022-68c6bfde10d8'
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const ALHEIA = '00000000-0000-4000-a000-0000000a9e01'

async function tokenDoBot(): Promise<string> {
  return (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
}

test.describe('Segurança PR C · instalador do agente por URL assinada', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-agente-instalador-prc', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('tela Conectores obtém link assinado e baixa o .exe publicado', async ({ request }) => {
    const headers = { Authorization: `Bearer ${await tokenDoBot()}` }
    const r = await request.get(`/api/agente/instalador?company_id=${FRIOESTE}`, { headers })
    const corpo = await r.json() as { ok?: boolean; exe?: string; nssm?: string; versao?: string | null; error?: string }
    expect(r.status(), JSON.stringify(corpo)).toBe(200)
    expect(corpo.exe, 'link do .exe').toMatch(/\/storage\/v1\/object\/sign\/agente\/agente-atak\.exe\?token=/)
    expect(corpo.nssm, 'link do nssm').toMatch(/\/storage\/v1\/object\/sign\/agente\/nssm\.exe\?token=/)
    expect(corpo.versao ?? '', 'versão publicada no manifesto').toMatch(/^\d+\.\d+\.\d+$/)
    const exe = await fetch(corpo.exe!, { headers: { Range: 'bytes=0-1' } })
    expect([200, 206], 'download do .exe pelo link assinado').toContain(exe.status)
    const mz = new Uint8Array(await exe.arrayBuffer()).slice(0, 2)
    expect([mz[0], mz[1]], 'executável Windows (MZ)').toEqual([0x4d, 0x5a])
  })

  test('sem conexão ATAK → 404; empresa alheia → 403; sem login → 401', async ({ request }) => {
    const headers = { Authorization: `Bearer ${await tokenDoBot()}` }
    expect((await request.get(`/api/agente/instalador?company_id=${DEMO_GE}`, { headers })).status()).toBe(404)
    expect((await request.get(`/api/agente/instalador?company_id=${ALHEIA}`, { headers })).status()).toBe(403)
    expect((await request.get(`/api/agente/instalador?company_id=${FRIOESTE}`)).status()).toBe(401)
  })
})
