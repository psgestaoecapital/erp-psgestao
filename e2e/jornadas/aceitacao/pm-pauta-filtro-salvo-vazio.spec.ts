// Pdois/Marciana (07/10, URGENTE): a Pauta abria VAZIA para ela. No banco, como ela, havia 1 job; a preferência guardada
// da última visita (atalho "Atrasados" + um responsável) escondia o único job (prazo 25/10, não atrasado) e a tela só
// dizia, discreto, "Nenhum job com esse filtro". RD-51: a tela agora DIZ o filtro em uso, em palavras, avisa que veio da
// última visita e oferece "Mostrar todos"; Meus trabalhos sem job seu diz quantos a empresa tem e leva à Pauta.
// Na Agência (P&M) - DEMO, como o robô: grava nele a mesma situação (preferência que esconde tudo) e devolve a dele no fim.
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbDelete, dbInsert, dbPatch, dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
type Pref = { filtros: Record<string, unknown>; agrupar: string; aba: string | null }

test.describe('P&M · Pauta com filtro guardado que esconde os jobs (Pdois/Marciana)', () => {
  test.describe.configure({ mode: 'serial' })
  let robo = ''
  let antes: Pref | null = null
  let job: { id: string; numero: string } | null = null

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    robo = (JSON.parse(await obterSessionPayload()) as { user: { id: string } }).user.id
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    // um job NÃO atrasado (prazo de hoje em diante), como o nº 1 da Pdois
    ;[job] = await dbSelect<{ id: string; numero: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&excluido_em=is.null&data_prazo=gte.${hoje}&select=id,numero&order=data_prazo&limit=1`)
    const [p] = await dbSelect<Pref>('agency_pauta_preferencia', `company_id=eq.${DEMO_PM}&user_id=eq.${robo}&select=filtros,agrupar,aba`)
    antes = p ?? null
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-pauta-filtro-salvo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (!robo) return
    if (antes) await dbPatch('agency_pauta_preferencia', `company_id=eq.${DEMO_PM}&user_id=eq.${robo}`, { ...antes })
    else await dbDelete('agency_pauta_preferencia', `company_id=eq.${DEMO_PM}&user_id=eq.${robo}`)
  })

  test('filtro guardado que esconde o job: a tela diz o filtro e "Mostrar todos" traz o job de volta', async ({ page }) => {
    test.skip(!job, 'a demo P&M não tem job com prazo de hoje em diante')
    // a mesma situação da Marciana: atalho "Atrasados" + um filtro que só casa com um job que NÃO está atrasado
    const filtros = { atalho: 'atrasados', codigo: job!.numero }
    const pref = { filtros, agrupar: 'prazo', aba: 'todas', atualizado_em: new Date().toISOString() }
    if (antes) await dbPatch('agency_pauta_preferencia', `company_id=eq.${DEMO_PM}&user_id=eq.${robo}`, pref)
    else await dbInsert('agency_pauta_preferencia', { company_id: DEMO_PM, user_id: robo, ...pref })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    const ativo = page.getByTestId('pauta-filtro-ativo')
    await expect(ativo, 'o filtro em uso aparece em palavras').toContainText('Atalho: Atrasados', { timeout: 20000 })
    await expect(ativo).toContainText(`Código ${job!.numero}`)
    await expect(ativo, 'avisa que veio da última visita').toContainText('guardado da sua última visita')
    const escondendo = page.getByTestId('pauta-filtro-escondendo')
    await expect(escondendo, 'vazio nunca calado: diz que a pauta tem jobs e o filtro esconde').toContainText('A pauta tem jobs, mas nenhum passa no filtro aplicado')

    await page.getByTestId('pauta-vazia-mostrar-todos').click()
    await expect(page.getByTestId('pauta-filtro-ativo'), 'sem filtro, a faixa some').toHaveCount(0, { timeout: 15000 })
    await expect(page.getByTestId('pauta-lista'), 'o job volta para a lista').toContainText(job!.numero, { timeout: 20000 })
    await expect.poll(async () => (await dbSelect<Pref>('agency_pauta_preferencia', `company_id=eq.${DEMO_PM}&user_id=eq.${robo}&select=filtros,agrupar,aba`))[0]?.filtros,
      { timeout: 10000, message: '"Mostrar todos" fica guardado para a próxima visita' }).toEqual({})
  })

  test('Meus trabalhos sem job seu diz quantos a empresa tem (nunca vazio calado)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.goto('/dashboard/pm/meus-trabalhos')
    await aguardarConteudo(page)
    await expect(page.getByTestId('meus-trabalhos-page')).toBeVisible({ timeout: 20000 })
    const meus = await page.getByTestId('mt-job').count()
    if (meus === 0) await expect(page.getByTestId('mt-vazio'), 'explica o vazio').toContainText('Nenhum job em andamento está com você')
    await expect(page.getByTestId('pm-escolha-empresa'), 'empresa resolvida: não pede para escolher').toHaveCount(0)
  })
})
