// CEO 28/09: o coletor antigo (Node + .env) sai do ar. Ele ficava público em /downloads/atak/* e era oferecido na tela
// Conectores ("Avançado — arquivos separados"). Não tinha chave dentro (conferido), mas chamava fn_atak_mapa_coletor,
// que está fechada desde a PR A — quem baixasse ficaria com um coletor que não funciona. O caminho oficial é o
// instalador gerado na tela (link assinado de 10 min).

import { test, expect } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload } from '../../support/api'

// A tela Conectores mora em /dashboard/industrial, e nenhuma demonstração tem a área Industrial (o AreaRedirectGuard
// manda o robô para outra área). Por isso o caminho principal é provado no que a tela chama para instalar o agente:
// /api/agente/instalador com a Frioeste (única empresa com agente), só leitura — 2 primeiros bytes do .exe ("MZ").
const FRIOESTE = '975365cc-9e5a-4251-9022-68c6bfde10d8'

test.describe('Coletor antigo fora do ar', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-coletor-antigo-fora-do-ar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('arquivos do coletor antigo não são mais servidos', async ({ request }) => {
    for (const arq of ['collector.js', 'package.json', 'README.md', 'INSTALACAO.md']) {
      const r = await request.get(`/downloads/atak/${arq}`)
      expect(r.status(), `/downloads/atak/${arq}`).toBe(404)
    }
  })

  test('caminho principal: o instalador oficial continua saindo pelo link assinado', async ({ request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await request.get(`/api/agente/instalador?company_id=${FRIOESTE}`, { headers: { Authorization: `Bearer ${token}` } })
    const corpo = await r.json() as { exe?: string; error?: string }
    expect(r.status(), JSON.stringify(corpo)).toBe(200)
    expect(corpo.exe, 'link do .exe').toMatch(/\/storage\/v1\/object\/sign\/agente\/agente-atak\.exe\?token=/)
    const exe = await fetch(corpo.exe!, { headers: { Range: 'bytes=0-1' } })
    expect([200, 206], 'download do .exe pelo link assinado').toContain(exe.status)
    const mz = new Uint8Array(await exe.arrayBuffer()).slice(0, 2)
    expect([mz[0], mz[1]], 'executável Windows (MZ)').toEqual([0x4d, 0x5a])
  })
})
