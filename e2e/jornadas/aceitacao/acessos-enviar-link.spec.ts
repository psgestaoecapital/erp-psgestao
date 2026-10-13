// Admin › Acessos · "Enviar link de acesso" (CEO 29/09 · caso Renato/Tryo): cada pessoa tem o botão; convite pendente
// também. A rota /api/acessos/enviar-link é SIMULADA no navegador — nenhum e-mail real sai e nada é gravado no auth
// (RD-87: teste não toca tabela de autenticação em produção). Confere: botão em cada pessoa, o pedido leva a pessoa e a
// empresa certas, a tela mostra o resultado e o "Último envio … por …"; convite pendente aparece e reenvia.
// Demonstração Comércio (GE).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const INVITE_ID = '00000000-0000-4000-a000-0000000e2e01'
const INVITE_EMAIL = 'e2e-convite-pendente@exemplo.com'

test.describe('Acessos — enviar link de acesso', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-acessos-enviar-link', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('cada pessoa tem "Enviar link de acesso"; envia para a pessoa certa e mostra o último envio; convite pendente reenvia', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    const posts: Array<Record<string, unknown>> = []
    await page.route('**/api/acessos/enviar-link**', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, ultimos_envios: {},
          convites_pendentes: [{ id: INVITE_ID, email: INVITE_EMAIL, created_at: '2026-09-20T12:00:00Z', expires_at: '2026-09-25T12:00:00Z' }],
        }) })
      }
      const body = req.postDataJSON() as Record<string, unknown>
      posts.push(body)
      const convite = !!body.invite_id
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, rotulo: convite ? 'Convite reenviado' : 'E-mail para criar senha nova enviado',
        destino: convite ? INVITE_EMAIL : 'pessoa@exemplo.com', enviado_em: '2026-09-29T13:05:00Z', por: 'robo@psgestao.com',
      }) })
    })
    page.on('dialog', (d) => d.accept())
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/admin/acessos')
    await aguardarConteudo(page)

    const pessoas = page.locator('[data-testid^="pessoa-"]')
    await expect(pessoas.first(), 'a tela lista as pessoas da empresa').toBeVisible({ timeout: 30000 })

    // pessoa: abrir, enviar, conferir pedido e resultado
    const primeira = pessoas.first()
    await primeira.locator('button').first().click()
    const botao = primeira.getByTestId('enviar-link')
    await expect(botao, 'cada pessoa tem o botão').toBeVisible()
    await expect(botao).toHaveText(/Enviar link de acesso/)
    await botao.click()
    await expect(primeira, 'mostra o que foi enviado').toContainText('E-mail para criar senha nova enviado', { timeout: 15000 })
    await expect(primeira.getByTestId('ultimo-envio'), 'registra quem e quando').toContainText(/Último envio: .* por robo@psgestao\.com/)
    expect(posts[0]?.company_id, 'pedido vai para a empresa certa').toBe(DEMO)
    expect(typeof posts[0]?.user_id === 'string' && (posts[0].user_id as string).length === 36, 'pedido leva a pessoa (user_id)').toBe(true)
    expect(posts[0]?.invite_id, 'pessoa com conta não vai como convite').toBeUndefined()

    // convite pendente: aparece (vencido) e reenvia
    const conv = page.getByTestId(`convite-${INVITE_EMAIL}`)
    await expect(conv, 'convite pendente aparece na tela').toBeVisible()
    await expect(conv).toContainText('venceu')
    await conv.getByTestId('enviar-link').click()
    await expect(conv).toContainText('Convite reenviado', { timeout: 15000 })
    expect(posts[1]).toEqual({ company_id: DEMO, invite_id: INVITE_ID })
  })
})
