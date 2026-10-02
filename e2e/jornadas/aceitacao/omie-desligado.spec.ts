// Omie DESCONECTADO EM DEFINITIVO (CEO 02/10/2026). Migration 20261002230000.
//   1) (código) as rotas que falavam com o Omie respondem 410 "desligado" — nenhuma chamada sai;
//      a tela Conectores mostra o Omie como "Desligado em 02/10/2026", sem campos de credencial nem Sincronizar;
//   2) (@pos-migration) no banco: o controle de sync recusa "reativar"/"sincronizar agora", o provedor Omie está
//      inativo em todas as empresas e as 12 credenciais Omie estão inativas com a observação (o segredo saiu do cofre).
// Só leitura: nada é gravado (a chamada ao controle de sync é recusada antes de qualquer efeito).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const ROTULO = 'Desligado em 02/10/2026'

test.describe('Omie desligado em 02/10/2026', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-omie-desligado', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('rotas do Omie respondem 410 e a tela Conectores mostra "Desligado em 02/10/2026"', async ({ page }) => {
    for (const rota of ['/api/omie/sync', '/api/omie', '/api/sync/omie/full', '/api/sync/omie/clientes']) {
      const r = await page.request.post(rota, { data: { company_id: DEMO_GE } })
      expect(r.status(), `${rota} desligada`).toBe(410)
      expect((await r.json()).desligado, rota).toBe(true)
    }

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/conectores')
    await aguardarConteudo(page)
    await expect(page.getByTestId('conector-status-omie')).toHaveText(ROTULO)
    await page.getByTestId('conector-card-omie').click()
    await expect(page.getByTestId('conector-desligado-omie')).toBeVisible()
    await expect(page.getByText('Sincronizar Agora')).toHaveCount(0)
  })

  test('banco: sync recusa reativar/sincronizar; provedor e credenciais do Omie inativos', { tag: '@pos-migration' }, async () => {
    const r = await rpc<{ erro?: string }>('fn_sync_controle', { p_acao: 'reativar_todos', p_company_id: null })
    expect(r?.erro).toBe('Omie desligado em 02/10/2026')
    const s = await rpc<{ erro?: string }>('fn_sync_controle', { p_acao: 'sync_agora', p_company_id: DEMO_GE })
    expect(s?.erro).toBe('Omie desligado em 02/10/2026')

    const prov = await dbSelect<{ ativo: boolean }>('erp_provider_config', 'provider=eq.omie&select=ativo')
    expect(prov.filter((p) => p.ativo).length, 'nenhum provedor Omie ativo').toBe(0)

    const cred = await dbSelect<{ ativo: boolean; observacao: string | null }>('erp_credencial', 'provider=eq.omie&select=ativo,observacao')
    expect(cred.length, 'as 12 credenciais seguem registradas (sem o segredo)').toBe(12)
    expect(cred.every((c) => !c.ativo && (c.observacao ?? '').includes('Omie desligado em 02/10/2026'))).toBe(true)

    const reg = await dbSelect<{ acao: string; valor_anterior: Record<string, unknown> }>('audit_log_global',
      'acao=eq.omie_credencial_removida&select=acao,valor_anterior')
    expect(reg.length, 'remoção registrada: nome, empresa e data').toBe(12)
    expect(reg.every((x) => typeof x.valor_anterior?.nome === 'string' && !('valor' in (x.valor_anterior ?? {})) && !('secret' in (x.valor_anterior ?? {}))),
      'registro nunca carrega o valor do segredo').toBe(true)
  })
})
