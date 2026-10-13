// PM-C · rodada de ajuste, "Aguardando" com motivo e aprovação do cliente com prazo (CEO 02/10, visita à Pdois).
// Migration 20261002260000 · @pos-migration. Na "Agência (P&M) - DEMO", como o robô:
//   1) o cenário mostra aprovações abertas com prazo (vencida e vence hoje), rodadas com motivo e esperas com motivo;
//   2) na tela, pelo job aberto da Pauta: "Pedir ajuste" com motivo → o código ganha a letra; "Aguardando…" com motivo →
//      tempo parado; "Retomar"; "Enviar para aprovação" → prazo; "Cliente aprovou" → concluído. Prints computador e celular.
// No fim o cenário da demo é re-armado (fn_demo_seed_pm_pauta + fn_demo_seed_pm_fluxo) e a preferência do robô volta limpa.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

test.describe('PM-C — fluxo do job na Pauta', () => {
  let token = ''
  const preferencia = async (filtros: Record<string, unknown>) => {
    const me = JSON.parse(atob(token.split('.')[1])) as { sub: string }
    await fetch(`${SUPABASE_URL}/rest/v1/agency_pauta_preferencia?on_conflict=company_id,user_id`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ company_id: DEMO_PM, user_id: me.sub, filtros, agrupar: 'prazo', aba: 'todas' }) })
  }
  test.beforeAll(async () => { token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token })
  test.afterAll(async () => {
    await rpc('fn_demo_seed_pm_pauta', { p_company_id: DEMO_PM }).catch(() => {})
    await rpc('fn_demo_seed_pm_fluxo', { p_company_id: DEMO_PM }).catch(() => {})
    await preferencia({}).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-c-fluxo-job', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('cenário: aprovações com prazo, rodadas e esperas com motivo', { tag: '@pos-migration' }, async () => {
    const abertas = await dbSelect<{ prazo_em: string }>('agency_aprovacoes', `company_id=eq.${DEMO_PM}&decisao=is.null&select=prazo_em`)
    expect(abertas.length, 'aprovações abertas').toBeGreaterThanOrEqual(5)
    expect(abertas.some((a) => new Date(a.prazo_em).getTime() < Date.now()), 'ao menos uma vencida').toBe(true)
    const rod = await dbSelect<{ motivo: string }>('agency_job_rodadas', `company_id=eq.${DEMO_PM}&select=motivo`)
    expect(rod.length, 'histórico de rodadas').toBeGreaterThanOrEqual(5)
    expect(rod.every((r) => (r.motivo ?? '').length > 10), 'toda rodada tem motivo').toBe(true)
    const esp = await dbSelect<{ aguardando_motivo: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&status=eq.aguardando&excluido_em=is.null&select=aguardando_motivo`)
    expect(new Set(esp.map((e) => e.aguardando_motivo)).size, 'motivos de espera variados').toBeGreaterThanOrEqual(3)
  })

  test('tela: pedir ajuste, aguardar, retomar, enviar e aprovar — prints', { tag: '@pos-migration' }, async ({ page }) => {
    await preferencia({ codigo: '24125' })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await page.getByTestId('pauta-codigo-24125').click({ timeout: 20000 })
    const job = page.getByTestId('pauta-job')
    await expect(job.getByTestId('job-fluxo')).toBeVisible({ timeout: 15000 })
    const msg = job.getByTestId('job-fluxo-msg')

    // pedir ajuste: sem motivo o botão fica travado; com motivo, 24125 vira 24125A
    await job.getByTestId('job-pedir-ajuste').click()
    await expect(job.getByTestId('job-ajuste-salvar')).toBeDisabled()
    await expect(job.getByTestId('ajuda-pm.job.ajuste.motivo')).toBeVisible()
    await job.getByTestId('job-ajuste-motivo').fill('Cliente pediu o filhote olhando para a câmera e o logo maior.')
    await job.getByTestId('job-ajuste-salvar').click()
    await expect(msg).toContainText('24125A', { timeout: 15000 })
    await expect(job.getByTestId('job-codigo')).toHaveText('24125A')
    await expect(job.getByTestId('job-rodada-A')).toContainText('filhote olhando para a câmera')

    // aguardando com motivo → tempo parado → retomar
    await job.getByTestId('job-aguardar').click()
    await job.getByTestId('job-aguardar-de').selectOption('cliente')
    await job.getByTestId('job-aguardar-motivo').selectOption('material_cliente')
    await job.getByTestId('job-aguardar-salvar').click()
    await expect(job.getByTestId('job-aguardando-info')).toContainText('Material do cliente', { timeout: 15000 })
    await expect(job.getByTestId('job-aguardando-info')).toContainText('parado há')
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-c-job-aguardando.png', fullPage: false })
    await job.getByTestId('job-retomar').click()
    await expect(msg).toContainText('retomado', { timeout: 15000 })

    // aprovação: prazo padrão (2 dias úteis, 18h) → cliente aprovou
    await job.getByTestId('job-enviar-aprovacao').click()
    await expect(job.getByTestId('ajuda-pm.job.aprovacao.prazo')).toBeVisible()
    await job.getByTestId('job-aprovacao-enviar').click()
    await expect(job.getByTestId('job-aprovacao-prazo')).toContainText('às 18h', { timeout: 15000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-c-job-aprovacao.png', fullPage: false })
    await job.getByTestId('job-aprovar').click()
    await expect(msg).toContainText('Aprovado pelo cliente', { timeout: 15000 })

    const [j] = await dbSelect<{ status: string; rodada_ajuste: number }>('agency_jobs', `company_id=eq.${DEMO_PM}&numero=eq.24125&select=status,rodada_ajuste`)
    expect(j.status).toBe('concluida')
    expect(j.rodada_ajuste).toBe(1)
    const feed = await dbSelect<{ texto: string }>('agency_job_comentarios', `company_id=eq.${DEMO_PM}&texto=like.Ajuste%20A%20pedido*&select=texto&order=criado_em.desc&limit=1`)
    expect(feed[0]?.texto, 'ação registrada no feed do job').toContain('filhote')

    // lista: selo da aprovação (vencida / vence hoje) num job em aprovação do cenário
    await preferencia({})
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await page.getByTestId('pauta-aba-em_aprovacao').click()
    await expect(page.locator('[data-testid="pauta-selo-aprovacao"][data-nivel="vencida"]').first()).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-c-pauta-aprovacoes.png', fullPage: false })

    // celular: job com aprovação vencida aberto
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await page.getByTestId('pauta-aba-em_aprovacao').click()
    await page.getByTestId('pauta-codigo-24108').click({ timeout: 20000 })
    await expect(page.getByTestId('job-aprovacao-prazo')).toHaveAttribute('data-nivel', 'vencida', { timeout: 15000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-c-job-celular.png', fullPage: false })
  })
})
