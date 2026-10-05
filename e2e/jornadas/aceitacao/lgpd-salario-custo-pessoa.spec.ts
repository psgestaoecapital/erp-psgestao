// LGPD · salário e custo por pessoa só para quem vê salário (CEO 04/10, tarefa ee360ddc) · migration 20261005180000
// (@pos-migration: o preview roda o código novo contra o banco ATUAL; a prova é em produção, logo após o deploy-migrations).
// O robô (logado, demonstração) é "adm"/"acesso_total": vê salário. Prova:
//  1) direito por coluna: select * / salario_base / custo_hora / custo_total direto → negado (42501), colunas comuns → ok;
//     anônimo sem nada;
//  2) quem vê salário lê e grava pelas funções protegidas, e cada acesso fica registrado (erp_custo_pessoa_acesso_log);
//  3) a API da lista de funcionários NUNCA devolve salario_base (service_role lê, a rota tira);
//  4) caminho principal das telas: Apontamento de horas grava pela função (custo da pessoa resolvido no servidor) e a
//     Margem por Job segue calculando pelo agregado; a ficha do funcionário mostra o salário a quem vê;
//  5) auditoria da regra: fn_seguranca_colunas_pessoa_legiveis volta vazia.
// O service_role só confere e limpa o que o teste criou/alterou (demonstração).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, dbPatch, rpc, registrarJornada, obterSessionPayload, BASE_URL } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('LGPD · salário_base e custo por pessoa protegidos', () => {
  let token = ''
  let roboId = ''
  let funcId = ''
  const DESC_TESTE = `[ACEITE LGPD] ${RUN}`

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-lgpd-salario-custo-pessoa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    for (const id of [DEMO_PM, DEMO_SST]) {
      const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${id}&select=is_demo`)
      expect(emp?.is_demo, 'a aceitação só roda em empresa de demonstração').toBe(true)
    }
    const s = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
    token = s.access_token
    roboId = s.user.id
    const [f] = await dbSelect<{ id: string }>('compliance_funcionarios', `company_id=eq.${DEMO_SST}&ativo=eq.true&select=id&order=nome_completo&limit=1`)
    funcId = f.id
  })

  test.afterAll(async () => {
    await dbDelete('agency_timesheet', `company_id=eq.${DEMO_PM}&descricao=eq.${encodeURIComponent(DESC_TESTE)}`)
    if (funcId) await dbPatch('compliance_funcionarios', `id=eq.${funcId}`, { salario_base: null })
  })

  const comoRobo = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init, headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const comoAnon = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init, headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const chamar = (fn: string, args: Record<string, unknown>) => comoRobo(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

  test('nenhuma coluna de salário/custo por pessoa é legível pelo logado nem pelo anônimo', { tag: '@pos-migration' }, async () => {
    const legiveis = await rpc<{ tabela: string; coluna: string; papel: string }[]>('fn_seguranca_colunas_pessoa_legiveis', {})
    expect(legiveis, `ainda legíveis: ${JSON.stringify(legiveis)}`).toEqual([])
    // a função de auditoria é só de serviço
    const r = await chamar('fn_seguranca_colunas_pessoa_legiveis', {})
    expect(r.ok, 'fn_seguranca_colunas_pessoa_legiveis fechada ao logado').toBe(false)
  })

  test('select direto: coluna sensível e select * negados; colunas comuns seguem', { tag: '@pos-migration' }, async () => {
    const ok = await comoRobo(`compliance_funcionarios?company_id=eq.${DEMO_SST}&select=id,nome_completo,cargo&limit=3`)
    expect(ok.ok, `colunas comuns: ${ok.status}`).toBe(true)
    expect(((await ok.json()) as unknown[]).length).toBeGreaterThan(0)
    for (const q of [`compliance_funcionarios?company_id=eq.${DEMO_SST}&select=salario_base`, `compliance_funcionarios?company_id=eq.${DEMO_SST}&select=*`,
      `agency_timesheet?company_id=eq.${DEMO_PM}&select=custo_hora`, `agency_timesheet?company_id=eq.${DEMO_PM}&select=custo_total`, `agency_timesheet?company_id=eq.${DEMO_PM}&select=*`]) {
      const r = await comoRobo(q)
      expect(r.ok, `${q} tem de ser negado (veio ${r.status})`).toBe(false)
      expect(await r.text(), q).toContain('42501')
    }
    const grava = await comoRobo(`compliance_funcionarios?id=eq.${funcId}`, { method: 'PATCH', body: JSON.stringify({ salario_base: 1 }) })
    expect(grava.ok, 'gravar salario_base direto é negado').toBe(false)
    const [depois] = await dbSelect<{ salario_base: number | null }>('compliance_funcionarios', `id=eq.${funcId}&select=salario_base`)
    expect(depois.salario_base, 'nada foi gravado').toBeNull()
  })

  test('anônimo não lê nem chama nada', { tag: '@pos-migration' }, async () => {
    for (const q of [`compliance_funcionarios?select=id`, `agency_timesheet?select=id`]) {
      const r = await comoAnon(q)
      expect(r.ok, `${q} para anônimo: ${r.status}`).toBe(false)
    }
    for (const [fn, args] of [['fn_compliance_funcionario_salario', { p_id: funcId }], ['fn_compliance_salarios', { p_company_id: DEMO_SST }],
      ['fn_pm_timesheet_custos', { p_company_id: DEMO_PM }], ['fn_pm_job_custos', { p_company_id: DEMO_PM }]] as const) {
      const r = await comoAnon(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
      expect(r.ok, `${fn} para anônimo: ${r.status}`).toBe(false)
    }
  })

  test('quem vê salário lê e grava pela função, e o acesso fica registrado', { tag: '@pos-migration' }, async () => {
    const antes = await dbSelect<{ id: number }>('erp_custo_pessoa_acesso_log', `company_id=eq.${DEMO_SST}&user_id=eq.${roboId}&select=id`)
    const g = await chamar('fn_compliance_funcionario_salario_salvar', { p_id: funcId, p_valor: 4321.5 })
    expect(g.ok, `gravar pela função: ${g.status} ${g.ok ? '' : await g.text()}`).toBe(true)
    const l = await chamar('fn_compliance_funcionario_salario', { p_id: funcId })
    expect(l.ok).toBe(true)
    const v = (await l.json()) as { pode_ver: boolean; salario_base: number | null }
    expect(v.pode_ver, 'o robô (adm/acesso_total) vê salário').toBe(true)
    expect(Number(v.salario_base)).toBe(4321.5)
    const lista = await chamar('fn_compliance_salarios', { p_company_id: DEMO_SST })
    const linhas = (await lista.json()) as { id: string; salario_base: number | null }[]
    expect(linhas.find((x) => x.id === funcId)?.salario_base).toBe(4321.5)
    const depois = await dbSelect<{ id: number; origem: string }>('erp_custo_pessoa_acesso_log', `company_id=eq.${DEMO_SST}&user_id=eq.${roboId}&select=id,origem`)
    expect(depois.length, 'gravação + 2 leituras registradas').toBeGreaterThanOrEqual(antes.length + 3)
    expect(depois.some((x) => x.origem === 'gravacao')).toBe(true)
    const media = await chamar('fn_compliance_salario_media_funcao', { p_company_id: DEMO_SST })
    expect(media.ok, 'média da função disponível a quem é da empresa').toBe(true)
    for (const g2 of (await media.json()) as { pessoas: number; media: number | null }[]) {
      if (g2.pessoas < 3) expect(g2.media, 'grupo com menos de 3 pessoas não mostra média').toBeNull()
    }
  })

  test('a API da lista de funcionários nunca devolve salario_base', async () => {
    const r = await fetch(`${BASE_URL}/api/compliance/funcionarios?company_id=${DEMO_SST}`, { headers: { Authorization: `Bearer ${token}` } })
    expect(r.ok, `GET /api/compliance/funcionarios: ${r.status}`).toBe(true)
    const j = (await r.json()) as { funcionarios: Record<string, unknown>[] }
    expect(j.funcionarios.length).toBeGreaterThan(0)
    for (const f of j.funcionarios) expect('salario_base' in f, 'a lista não leva salário').toBe(false)
  })

  test('Apontamento de horas grava pela função e a Margem por Job segue calculando', { tag: '@pos-migration' }, async ({ page }) => {
    const [membro] = await dbSelect<{ id: string; custo_hora: number | null }>('agency_equipe', `company_id=eq.${DEMO_PM}&custo_hora=gt.0&ativo=eq.true&select=id,custo_hora&limit=1`)
    const [job] = await dbSelect<{ id: string; titulo: string }>('agency_jobs', `company_id=eq.${DEMO_PM}&select=id,titulo&limit=1`)
    expect(membro, 'a demo P&M tem pessoa com custo/hora').toBeTruthy()

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.goto('/dashboard/pm/apontamento-horas')
    await aguardarConteudo(page)
    await page.locator('label', { hasText: /^Job/ }).locator('select').selectOption(job.id)
    await page.locator('label', { hasText: /^Responsável/ }).locator('select').selectOption(membro.id)
    await page.getByPlaceholder('horas').fill('2')
    await page.getByPlaceholder('descrição').fill(DESC_TESTE)
    await page.getByRole('button', { name: '+ Manual' }).click()
    await expect(page.getByText(/Apontamento CRIADO/)).toBeVisible({ timeout: 20000 })
    const [ap] = await dbSelect<{ horas: number; custo_hora: number | null; custo_total: number | null; user_id: string }>('agency_timesheet',
      `company_id=eq.${DEMO_PM}&descricao=eq.${encodeURIComponent(DESC_TESTE)}&select=horas,custo_hora,custo_total,user_id`)
    expect(Number(ap.custo_hora), 'custo/hora da pessoa resolvido no servidor').toBe(Number(membro.custo_hora))
    expect(Number(ap.custo_total)).toBe(2 * Number(membro.custo_hora))
    expect(ap.user_id, 'o apontamento é de quem está logado').toBe(roboId)

    // agregado por job: sem custo/hora de ninguém, com o custo do job
    const agg = (await (await chamar('fn_pm_job_custos', { p_company_id: DEMO_PM })).json()) as Record<string, unknown>[]
    expect(agg.length).toBeGreaterThan(0)
    for (const l of agg) expect('custo_hora' in l, 'agregado não devolve custo/hora').toBe(false)
    const doJob = agg.filter((l) => l.job_id === job.id && l.tem_custo === true)
    expect(doJob.length).toBe(1)
    expect(Number(doJob[0].custo_total)).toBeGreaterThanOrEqual(2 * Number(membro.custo_hora))

    // quem vê salário recebe o custo por apontamento
    const cs = (await (await chamar('fn_pm_timesheet_custos', { p_company_id: DEMO_PM })).json()) as { custo_total: number }[]
    expect(cs.some((c) => Number(c.custo_total) === 2 * Number(membro.custo_hora))).toBe(true)

    await page.goto('/dashboard/pm/margem-job')
    await aguardarConteudo(page)
    await expect(page.getByTestId(`margem-job-${job.id}`)).toBeVisible({ timeout: 20000 })
  })

  test('ficha do funcionário: quem vê salário vê o campo e grava', { tag: '@pos-migration' }, async ({ page }) => {
    expect((await chamar('fn_compliance_funcionario_salario_salvar', { p_id: funcId, p_valor: 4321.5 })).ok).toBe(true)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto(`/dashboard/compliance/funcionarios/${funcId}`)
    await aguardarConteudo(page)
    const campo = page.locator(`xpath=//label[normalize-space(.)="Salário base (R$)"]/following-sibling::input[1]`).first()
    await expect(campo, 'quem vê salário vê o campo').toBeVisible({ timeout: 20000 })
    await expect(campo).toHaveValue('4321.5')
    await expect(page.getByTestId('salario-media-funcao')).toHaveCount(0)
    await campo.fill('4400')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('Salvo com sucesso')).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => {
      const v = (await (await chamar('fn_compliance_funcionario_salario', { p_id: funcId })).json()) as { salario_base: number | null }
      return Number(v.salario_base)
    }, { timeout: 15000 }).toBe(4400)
  })
})
