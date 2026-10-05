// P&M · Social mínimo (CEO 03/10): planejamento, posts, calendário e post aprovado virando job.
// Migration 20261003120000 · @pos-migration. Na "Agência (P&M) - DEMO" (is_demo), como o robô (com a RLS dele):
//   1) banco: dois planejamentos do mesmo cliente e mês com campanhas diferentes são aceitos; a mesma campanha (caixa e
//      espaços não importam) é recusada; rede fora da lista da empresa é recusada; post aprovado vira job com
//      prazo = publicação − antecedência da peça; mudar a publicação move o prazo; prazo do job depois da publicação é
//      recusado;
//   2) tela (computador e celular): cria o planejamento e o post pela tela, aprova e vê o job; calendário semana/mês com
//      os posts da demonstração e o "?" dos campos. Prints em e2e/diagnostico-host/.
// Dados próprios (campanha "E2E Social …"); no fim vão para a lixeira — planejamento, posts e jobs (nada é apagado).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const CARIMBO = Date.now().toString(36).toUpperCase()

// datas sem fuso (AAAA-MM-DD)
const somarDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const proximoMes = () => { const x = new Date(`${hojeSP().slice(0, 7)}-01T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10) }

type Resp<T> = { status: number; dados: T; texto: string }

test.describe('P&M Social — planejamento, posts, calendário e post que vira job', () => {
  let token = ''
  const api = async <T,>(metodo: string, caminho: string, corpo?: unknown): Promise<Resp<T>> => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
      method: metodo,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    const texto = await r.text()
    let dados: T = null as T
    try { dados = JSON.parse(texto) as T } catch { /* corpo vazio */ }
    return { status: r.status, dados, texto }
  }

  test.beforeAll(async () => { token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token })
  // limpeza suave: os planejamentos de teste (e os posts, pelo gatilho) e os jobs gerados vão para a lixeira
  test.afterAll(async () => {
    const planos = await dbSelect<{ id: string }>('agency_planejamentos', `company_id=eq.${DEMO_PM}&campanha=like.E2E%20Social*&excluido_em=is.null&select=id`).catch(() => [])
    if (!planos.length) return
    const ids = planos.map((p) => p.id).join(',')
    const posts = await dbSelect<{ job_id: string | null }>('agency_posts', `planejamento_id=in.(${ids})&select=job_id`).catch(() => [])
    const jobs = posts.map((p) => p.job_id).filter(Boolean)
    const agora = new Date().toISOString()
    if (jobs.length) await dbPatch('agency_jobs', `id=in.(${jobs.join(',')})&excluido_em=is.null`, { excluido_em: agora }).catch(() => {})
    await dbPatch('agency_planejamentos', `id=in.(${ids})`, { excluido_em: agora }).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-social', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('banco: campanhas no mesmo mês, redes da empresa, post aprovado vira job e o prazo acompanha', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [cli] = await dbSelect<{ id: string }>('erp_clientes', `company_id=eq.${DEMO_PM}&nome_fantasia=eq.Pet%20Amigo&select=id&limit=1`)
    const [peca] = await dbSelect<{ id: string; antecedencia_dias: number }>('agency_servico', `company_id=eq.${DEMO_PM}&nome=eq.Reels&select=id,antecedencia_dias&limit=1`)
    expect(cli?.id, 'cliente da demonstração').toBeTruthy()
    expect(peca?.antecedencia_dias, 'peça com antecedência (padrão 2)').toBe(2)
    const mes = proximoMes()

    // 1) dois planejamentos do mesmo cliente e mês, campanhas diferentes; a mesma campanha é recusada
    const base = { company_id: DEMO_PM, cliente_id: cli.id, mes }
    const a = await api<{ id: string; mes: string }[]>('POST', 'agency_planejamentos', { ...base, campanha: `E2E Social A ${CARIMBO}`, titulo: 'E2E Social A' })
    expect(a.status, a.texto).toBe(201)
    const b = await api<{ id: string }[]>('POST', 'agency_planejamentos', { ...base, mes: somarDias(mes, 9), campanha: `E2E Social B ${CARIMBO}`, titulo: 'E2E Social B' })
    expect(b.status, b.texto).toBe(201)
    const dup = await api('POST', 'agency_planejamentos', { ...base, campanha: `  e2e social a ${CARIMBO.toLowerCase()} `, titulo: 'duplicado' })
    expect(dup.status, 'mesma campanha no mesmo mês é recusada').toBe(409)
    expect(dup.texto).toContain('Já existe um planejamento deste cliente')
    const planoA = a.dados[0].id

    // 2) redes: fora da lista da empresa é recusada; as da lista são aceitas
    const lista = await api<{ valor: string }[]>('POST', 'rpc/fn_agency_config_listar', { p_company_id: DEMO_PM, p_lista: 'rede_social' })
    expect(lista.dados.map((r) => r.valor)).toEqual(expect.arrayContaining(['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'google']))
    const ruim = await api('POST', 'agency_posts', { company_id: DEMO_PM, planejamento_id: planoA, cliente_id: cli.id, assunto: 'E2E rede inválida', redes: ['instagram', 'orkut-e2e'] })
    expect(ruim.status, 'rede fora da lista').toBe(400)
    expect(ruim.texto).toContain('orkut-e2e')

    const dia = somarDias(mes, 19)
    const post = await api<{ id: string; job_id: string | null; redes: string[] }[]>('POST', 'agency_posts', {
      company_id: DEMO_PM, planejamento_id: planoA, cliente_id: cli.id, assunto: `E2E Social post ${CARIMBO}`, redes: ['instagram', 'facebook'],
      servico_id: peca.id, publicar_em: `${dia}T18:00:00-03:00`, arte: 'Pet no banho', legenda: 'Seu pet merece!', hashtags: '#pet',
    })
    expect(post.status, post.texto).toBe(201)
    expect(post.dados[0].job_id, 'rascunho não vira job').toBeNull()
    const postId = post.dados[0].id

    // 2b) rede em uso por post não sai da lista (a empresa oculta; remover é recusado e nada é apagado)
    const listaIds = await api<{ id: string; valor: string }[]>('POST', 'rpc/fn_agency_config_listar', { p_company_id: DEMO_PM, p_lista: 'rede_social' })
    const insta = listaIds.dados.find((r) => r.valor === 'instagram')
    expect(insta?.id, 'instagram na lista da empresa').toBeTruthy()
    const rem = await api<{ ok: boolean; erro?: string }>('POST', 'rpc/fn_agency_config_excluir', { p_id: insta!.id })
    expect(rem.dados.ok, 'rede usada em post não pode ser removida').toBe(false)
    expect(rem.dados.erro).toBe('opcao_em_uso')

    // 3) aprovado → job com prazo = publicação − antecedência
    const ap = await api<{ job_id: string }[]>('PATCH', `agency_posts?id=eq.${postId}`, { status: 'aprovado' })
    expect(ap.status, ap.texto).toBe(200)
    const jobId = ap.dados[0].job_id
    expect(jobId, 'post aprovado vira job').toBeTruthy()
    const [job] = await dbSelect<{ numero: string; data_prazo: string; descricao: string; servico_id: string; status: string }>('agency_jobs', `id=eq.${jobId}&select=numero,data_prazo,descricao,servico_id,status`)
    expect(job.data_prazo).toBe(somarDias(dia, -2))
    expect(job.numero, 'número pelo gatilho do Bloco 1').toMatch(/^\d+$/)
    expect(job.servico_id).toBe(peca.id)
    expect(job.descricao).toContain('**Legenda:** Seu pet merece!')

    // 4) a publicação mudou → o prazo do job acompanha
    const novoDia = somarDias(dia, 5)
    const mv = await api('PATCH', `agency_posts?id=eq.${postId}`, { publicar_em: `${novoDia}T10:00:00-03:00` })
    expect(mv.status, mv.texto).toBe(200)
    const [job2] = await dbSelect<{ data_prazo: string }>('agency_jobs', `id=eq.${jobId}&select=data_prazo`)
    expect(job2.data_prazo).toBe(somarDias(novoDia, -2))

    // 5) prazo do job depois da publicação é recusado; no dia da publicação é aceito
    const tarde = await api('PATCH', `agency_jobs?id=eq.${jobId}`, { data_prazo: somarDias(novoDia, 1) })
    expect(tarde.status, 'prazo depois da publicação').toBe(400)
    expect(tarde.texto).toContain('não pode ser depois da publicação')
    const noDia = await api('PATCH', `agency_jobs?id=eq.${jobId}`, { data_prazo: novoDia })
    expect(noDia.status, noDia.texto).toBe(200)
  })

  test('tela: planejamento e post pela tela, aprovação vira job, calendário — computador e celular', { tag: '@pos-migration' }, async ({ page }) => {
    const [peca] = await dbSelect<{ id: string }>('agency_servico', `company_id=eq.${DEMO_PM}&nome=eq.Carrossel&select=id&limit=1`)
    const mes = proximoMes()
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })

    // demonstração do mês: 2 clientes com planejamento
    await page.goto('/dashboard/pm/planejamento')
    await aguardarConteudo(page)
    await expect(page.getByTestId('planejamento-card').first()).toBeVisible({ timeout: 20000 })
    expect(await page.getByTestId('planejamento-card').count(), 'demonstração: planejamento do mês de 2 clientes').toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('ajuda-pm.planejamento.filtro_mes')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-social-planejamentos.png', fullPage: false })

    // novo planejamento pela tela
    await page.getByTestId('planejamento-novo').click()
    const ed = page.getByTestId('planejamento-editor')
    await ed.getByTestId('planejamento-cliente-input').fill('Pet Amigo')
    await ed.getByTestId('planejamento-cliente-opcao').first().click({ timeout: 15000 })
    await ed.getByTestId('planejamento-mes').fill(mes.slice(0, 7))
    await ed.getByTestId('planejamento-campanha').fill(`E2E Social tela ${CARIMBO}`)
    await ed.getByTestId('planejamento-titulo').fill(`E2E Social tela ${CARIMBO}`)
    await expect(ed.getByTestId('ajuda-pm.planejamento.campanha')).toBeVisible()
    await ed.getByTestId('planejamento-salvar').click()
    await expect(ed.getByTestId('post-novo')).toBeVisible({ timeout: 15000 })

    // post pela tela, já aprovado → vira job
    await ed.getByTestId('post-novo').click()
    const pf = page.getByTestId('post-form')
    await pf.getByTestId('post-assunto').fill(`E2E Social carrossel ${CARIMBO}`)
    await pf.getByTestId('post-publicar-em').fill(`${somarDias(mes, 14)}T18:00`)
    await pf.getByTestId('post-peca').selectOption(peca.id)
    await pf.getByTestId('post-rede-instagram').check({ force: true })
    await pf.getByTestId('post-rede-linkedin').check({ force: true })
    await pf.getByTestId('post-legenda').fill('Legenda de teste do robô.')
    await expect(pf.getByTestId('post-prazo-previsto')).toContainText(somarDias(mes, 12).split('-').reverse().join('/'))
    await expect(pf.getByTestId('ajuda-pm.post.redes')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-social-post-form.png', fullPage: false })
    await pf.getByTestId('post-status').selectOption('aprovado')
    await pf.getByTestId('post-salvar').click()
    await expect(page.getByTestId('planejamento-toast')).toContainText('job', { timeout: 15000 })
    await expect(ed.getByTestId('post-job').first()).toContainText(`prazo ${somarDias(mes, 12).split('-').reverse().join('/')}`)
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-social-post-job.png', fullPage: false })

    // calendário: mês da demonstração com posts; semana e mês
    await page.goto('/dashboard/pm/calendario')
    await aguardarConteudo(page)
    await page.getByTestId('calendario-visao-mes').click()
    await expect(page.getByTestId('calendario-mes')).toBeVisible()
    await expect(page.getByTestId('calendario-post').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('ajuda-pm.calendario.visao')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-social-calendario-mes.png', fullPage: false })
    await page.getByTestId('calendario-visao-semana').click()
    await expect(page.getByTestId('calendario-semana')).toBeVisible()

    // celular
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/pm/calendario')
    await aguardarConteudo(page)
    await page.getByTestId('calendario-visao-mes').click()
    await expect(page.getByTestId('calendario-mes-celular')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-social-calendario-celular.png', fullPage: false })
    await page.goto('/dashboard/pm/planejamento')
    await aguardarConteudo(page)
    await page.getByTestId('planejamento-card').first().click({ timeout: 20000 })
    await expect(page.getByTestId('post-item').first()).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-social-planejamento-celular.png', fullPage: false })
  })
})
