// Mão de obra compartilhada (CEO 03/10 + correções do Eng. Chefe). Depende da migration 20261003130000 → @pos-migration.
// Demonstração Agência (P&M) — b0700000-…-0002 (is_demo). Nada de empresa real.
//  1) REGRA LGPD: o robô (adm da demo = vê salário) pede o custo da hora de uma pessoa → recebe o INDIVIDUAL e a entrega
//     fica no log de acesso; um usuário sem papel de salário (criado só para o teste, robô, ligado só à demo) recebe a
//     MÉDIA DA FUNÇÃO — nunca o individual — e não lê o custo de cada apontamento.
//  2) P&M: a hora que a pessoa aponta (pela API, como a tela) ganha o custo da hora da Mão de obra (gatilho no banco).
//  3) Menu: um item "Mão de obra" por área; o da P&M leva a /dashboard/_compartilhado/mao-obra?area=pm e a tela abre com
//     a área e as funções-modelo da P&M; a do Hub continua em /dashboard/projetos/mao-obra.
// Dados de teste: a função e as fichas são removidas no fim; a pessoa de teste (CPF fixo) fica inativa na demo (o cadastro
// compartilhado não aceita DELETE físico — RD-30) e é reaproveitada na próxima rodada; o usuário de teste é apagado.

import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, dbPatch, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = Date.now().toString(36)
const FUNCAO = `Designer aceite ${RUN}`
const CPF_TESTE = '11144477735'
const URL_SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type CustoUsuario = { ok: boolean; encontrado: boolean; individual: boolean; tipo: string; custo_hora: number | null }

let funcaoId = ''
let pessoaId = ''
let fichaId = ''
let botId = ''
let botToken = ''
let semSalarioId = ''
let semSalarioToken = ''
let jobId = ''

async function rpcComo<T>(token: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as T
}

// abre o menu como o usuário faz (celular: gaveta; computador: menu lateral) e abre as seções da sanfona
async function abrirMenu(page: Page) {
  const gaveta = page.getByTestId('mobile-drawer-toggle')
  const celular = await gaveta.isVisible().catch(() => false)
  if (celular) await gaveta.click()
  const menu = page.getByTestId(celular ? 'menu-gaveta' : 'menu-lateral')
  await expect(menu).toBeVisible({ timeout: 10000 })
  await expect.poll(async () => menu.locator('nav').locator('a[href], button').count(), { timeout: 20000, message: 'menu carregou' }).toBeGreaterThan(0)
  for (let i = 0; i < 8; i++) {
    const fechada = menu.locator('nav button[aria-expanded="false"]').first()
    if (!(await fechada.count())) break
    await fechada.click()
  }
  return menu
}

test.describe('Mão de obra compartilhada — LGPD do custo da hora, P&M e menu por área', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    // robô (sessão real do bot): adm da demo → vê salário
    const sess = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
    botToken = sess.access_token; botId = sess.user.id

    // usuário SEM papel de salário, só para o teste (robô → só pode ser ligado a empresa demo; apagado no fim)
    const admin = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    const email = `robo-mao-obra-${RUN}@teste.psgestao.invalid`
    const senha = `Mo-${RUN}-${Math.random().toString(36).slice(2)}!9`
    const criado = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
    if (criado.error || !criado.data.user) throw new Error(`não criou o usuário de teste: ${criado.error?.message}`)
    semSalarioId = criado.data.user.id
    await admin.from('users').upsert({ id: semSalarioId, email, full_name: `Robô Mão de obra ${RUN}`, role: 'visualizador', is_robo: true })
    const uc = await admin.from('user_companies').insert({ user_id: semSalarioId, company_id: DEMO_AG, role: 'visualizador' })
    if (uc.error) throw new Error(`não ligou o usuário de teste à demo: ${uc.error.message}`)
    const login = await createClient(URL_SB, ANON, { auth: { autoRefreshToken: false, persistSession: false } }).auth.signInWithPassword({ email, password: senha })
    if (login.error || !login.data.session) throw new Error(`login do usuário de teste falhou: ${login.error?.message}`)
    semSalarioToken = login.data.session.access_token

    // função + pessoa (4.000 CLT, conferida) + perfil padrão (2 × 2.500, conferido): a média da função ≠ custo da pessoa
    funcaoId = (await rpc<{ id: string }>('fn_mao_obra_funcao_salvar', { p_company_id: DEMO_AG, p_id: null, p_dados: { nome: FUNCAO, forma_pagamento: 'mensal' } })).id
    const comp = (valor: number) => [{ tipo: 'fixo', subtipo: 'mensal', valor }]
    const [pessoa] = await dbSelect<{ id: string }>('compliance_funcionarios', `company_id=eq.${DEMO_AG}&cpf=eq.${CPF_TESTE}&select=id`)
    if (pessoa) {
      pessoaId = pessoa.id
      for (const k of await dbSelect<{ id: string }>('erp_mao_obra_custo', `funcionario_id=eq.${pessoaId}&select=id`)) {
        await dbDelete('erp_mao_obra_acesso_log', `ficha_id=eq.${k.id}`).catch(() => {})
        await dbDelete('erp_mao_obra_componente', `ficha_id=eq.${k.id}`).catch(() => {})
        await dbDelete('erp_mao_obra_custo', `id=eq.${k.id}`).catch(() => {})
      }
      await dbPatch('compliance_funcionarios', `id=eq.${pessoaId}`, { ativo: true, data_demissao: null })
      fichaId = (await rpc<{ id: string }>('fn_mao_obra_ficha_salvar', { p_company_id: DEMO_AG, p_ficha: { tipo: 'pessoa', funcionario_id: pessoaId, funcao_id: funcaoId, vinculo: 'clt', horas_produtivas_mes: 160, componentes: comp(4000) }, p_pessoa: null })).id
    } else {
      const r = await rpc<{ id: string; funcionario_id: string }>('fn_mao_obra_ficha_salvar', {
        p_company_id: DEMO_AG, p_ficha: { tipo: 'pessoa', funcao_id: funcaoId, vinculo: 'clt', horas_produtivas_mes: 160, componentes: comp(4000) },
        p_pessoa: { nome_completo: 'Pessoa de teste (robô) — Mão de obra', cpf: CPF_TESTE, data_admissao: '2026-01-01' } })
      fichaId = r.id; pessoaId = r.funcionario_id
    }
    await rpc('fn_mao_obra_ficha_conferir', { p_ficha_id: fichaId, p_conferido: true })
    const perfil = await rpc<{ id: string }>('fn_mao_obra_ficha_salvar', { p_company_id: DEMO_AG, p_ficha: { tipo: 'perfil', funcao_id: funcaoId, vinculo: 'clt', quantidade_pessoas: 2, horas_produtivas_mes: 176, componentes: comp(2500) }, p_pessoa: null })
    await rpc('fn_mao_obra_ficha_conferir', { p_ficha_id: perfil.id, p_conferido: true })
    // a pessoa é o usuário sem papel de salário (é ela quem aponta as horas)
    await rpc('fn_mao_obra_pessoa_vincular_usuario', { p_funcionario_id: pessoaId, p_user_id: semSalarioId })
    const [job] = await dbSelect<{ id: string }>('agency_jobs', `company_id=eq.${DEMO_AG}&select=id&order=created_at.asc&limit=1`)
    jobId = job?.id ?? ''
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-mao-obra-compartilhada', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (semSalarioId) await dbDelete('agency_timesheet', `company_id=eq.${DEMO_AG}&user_id=eq.${semSalarioId}`).catch(() => {})
    if (pessoaId) await dbPatch('compliance_funcionarios', `id=eq.${pessoaId}`, { user_id: null, ativo: false }).catch(() => {})
    if (funcaoId) {
      for (const k of await dbSelect<{ id: string }>('erp_mao_obra_custo', `funcao_id=eq.${funcaoId}&select=id`).catch(() => [])) {
        await dbDelete('erp_mao_obra_acesso_log', `ficha_id=eq.${k.id}`).catch(() => {})
        await dbDelete('erp_mao_obra_componente', `ficha_id=eq.${k.id}`).catch(() => {})
      }
      await dbDelete('erp_mao_obra_custo', `funcao_id=eq.${funcaoId}`).catch(() => {})
      await dbDelete('erp_funcao_mao_obra', `id=eq.${funcaoId}`).catch(() => {})
    }
    if (semSalarioId) {
      const admin = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
      await admin.auth.admin.deleteUser(semSalarioId).catch(() => {})
    }
  })

  test('LGPD: quem vê salário recebe o custo individual (e fica no log); quem não vê recebe a média da função', { tag: '@pos-migration' }, async () => {
    // referência (serviço): o custo individual da pessoa e a média da função
    const media = Number((await rpc<{ custo_hora: number }>('fn_funcao_custo_hora', { p_funcao_id: funcaoId })).custo_hora)

    const autorizado = await rpcComo<CustoUsuario>(botToken, 'fn_mao_obra_custo_hora_usuario', { p_company_id: DEMO_AG, p_user_id: semSalarioId })
    expect(autorizado.individual, 'adm da empresa vê o custo da pessoa').toBe(true)
    expect(autorizado.tipo).toBe('individual')
    const individual = Number(autorizado.custo_hora)
    expect(individual).toBeGreaterThan(0)
    expect(individual, 'pessoa (4.000) ≠ média da função (com o perfil de 2.500)').not.toBe(media)
    const log = await dbSelect<{ id: number }>('erp_mao_obra_acesso_log', `ficha_id=eq.${fichaId}&user_id=eq.${botId}&origem=eq.custo_hora_usuario&select=id`)
    expect(log.length, 'a entrega do custo individual ficou no log de acesso').toBeGreaterThan(0)

    const semSalario = await rpcComo<CustoUsuario>(semSalarioToken, 'fn_mao_obra_custo_hora_usuario', { p_company_id: DEMO_AG, p_user_id: semSalarioId })
    expect(semSalario.individual, 'sem papel de salário: nunca o individual').toBe(false)
    expect(semSalario.tipo).toBe('media_funcao')
    expect(Number(semSalario.custo_hora)).toBe(media)
    expect(JSON.stringify(semSalario)).not.toContain(String(individual))
    const logSem = await dbSelect<{ id: number }>('erp_mao_obra_acesso_log', `user_id=eq.${semSalarioId}&select=id`)
    expect(logSem.length, 'sem individual, sem entrega no log').toBe(0)

    // o custo de cada apontamento (custo da pessoa) não é lido direto pelo cliente
    const direto = await fetch(`${URL_SB}/rest/v1/agency_timesheet?company_id=eq.${DEMO_AG}&select=custo_hora&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${semSalarioToken}` } })
    expect(direto.ok, 'custo_hora do apontamento fechado para o cliente').toBe(false)
  })

  test('P&M: a hora apontada pela pessoa ganha o custo da hora da Mão de obra', { tag: '@pos-migration' }, async () => {
    test.skip(!jobId, 'a demo P&M não tem job')
    const fim = new Date(); const ini = new Date(fim.getTime() - 2 * 3600_000)
    // como a tela de apontamento: o usuário grava sem custo — o banco põe o da Mão de obra
    const resp = await fetch(`${URL_SB}/rest/v1/agency_timesheet`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${semSalarioToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: DEMO_AG, job_id: jobId, user_id: semSalarioId, data: fim.toISOString().slice(0, 10), horas: 2,
        descricao: `aceite mão de obra ${RUN}`, inicio_em: ini.toISOString(), fim_em: fim.toISOString() }),
    })
    expect(resp.ok, `apontamento gravado (${resp.status})`).toBe(true)
    const [ap] = await dbSelect<{ custo_hora: number; custo_total: number }>('agency_timesheet',
      `company_id=eq.${DEMO_AG}&user_id=eq.${semSalarioId}&descricao=eq.${encodeURIComponent(`aceite mão de obra ${RUN}`)}&select=custo_hora,custo_total`)
    const esperado = await rpc<CustoUsuario>('fn_mao_obra_custo_hora_usuario', { p_company_id: DEMO_AG, p_user_id: semSalarioId })
    expect(Number(ap?.custo_hora), 'custo da hora = o da ficha conferida da pessoa').toBe(Number(esperado.custo_hora))
    expect(Number(ap.custo_total)).toBeCloseTo(2 * Number(esperado.custo_hora), 2)
    // a margem lê o TOTAL do job (nunca por pessoa)
    const tot = await rpcComo<{ jobs: { job_id: string; horas: number; custo: number }[] }>(semSalarioToken, 'fn_pm_custo_jobs', { p_company_id: DEMO_AG })
    const doJob = tot.jobs.find((j) => j.job_id === jobId)
    expect(Number(doJob?.horas)).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(tot)).not.toContain('custo_hora')
  })

  test('menu por área: o item "Mão de obra" da P&M abre a tela compartilhada com a área; o Hub segue no lugar', { tag: '@pos-migration' }, async ({ page }) => {
    const modulos = await dbSelect<{ id: string; rota: string }>('module_catalog',
      'id=in.(pm_mao_obra,industrial_mao_obra,oficina_mao_obra,odonto_mao_obra,agro_mao_obra,ge_mao_obra,projetos_mao_obra)&select=id,rota')
    const rota = Object.fromEntries(modulos.map((m) => [m.id, m.rota]))
    expect(rota).toEqual({
      pm_mao_obra: '/dashboard/_compartilhado/mao-obra?area=pm', industrial_mao_obra: '/dashboard/_compartilhado/mao-obra?area=industrial',
      oficina_mao_obra: '/dashboard/_compartilhado/mao-obra?area=oficina', odonto_mao_obra: '/dashboard/_compartilhado/mao-obra?area=odonto',
      agro_mao_obra: '/dashboard/_compartilhado/mao-obra?area=agro', ge_mao_obra: '/dashboard/_compartilhado/mao-obra?area=gestao_empresarial',
      projetos_mao_obra: '/dashboard/projetos/mao-obra',
    })
    const menuPm = await rpc<{ modulo_id: string; rota: string }[]>('fn_modulos_sidebar_por_area', { p_area_id: 'pm', p_company_id: DEMO_AG, p_user_id: null })
    expect(menuPm.find((m) => m.modulo_id === 'pm_mao_obra')?.rota).toBe('/dashboard/_compartilhado/mao-obra?area=pm')

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
    await page.goto('/dashboard/pm/pauta?area=pm')
    await aguardarConteudo(page)
    const menu = await abrirMenu(page)
    const item = menu.locator('a[href="/dashboard/_compartilhado/mao-obra?area=pm"]').first()
    await expect(item, 'item "Mão de obra" no menu da P&M').toBeVisible({ timeout: 20000 })
    await item.click()
    await expect(page).toHaveURL(/\/dashboard\/_compartilhado\/mao-obra\?area=pm/)
    await aguardarConteudo(page)
    await expect(page.getByTestId('mao-obra-page')).toBeVisible()
    await expect(page.getByTestId('mao-obra-area')).toHaveAttribute('data-area', 'pm')
    await page.getByTestId('mao-obra-aba-funcoes').click()
    const nomes = page.getByTestId('mao-obra-modelo-nomes')
    for (const n of ['Designer', 'Social media', 'Redator', 'Editor de vídeo', 'Atendimento', 'Tráfego']) await expect(nomes).toContainText(n)
    // a pessoa aparece ligada ao usuário
    await page.getByTestId('mao-obra-aba-equipe').click()
    await expect(page.getByTestId('mao-obra-equipe')).toContainText(`Robô Mão de obra ${RUN}`)

    // outra área, mesma tela: a Oficina oferece as funções da oficina
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/_compartilhado/mao-obra?area=oficina')
    await aguardarConteudo(page)
    await expect(page.getByTestId('mao-obra-area')).toHaveAttribute('data-area', 'oficina')
    await page.getByTestId('mao-obra-aba-funcoes').click()
    await expect(page.getByTestId('mao-obra-modelo-nomes')).toContainText('Mecânico')

    // o Hub continua no lugar, com a mesma tela
    await page.goto('/dashboard/projetos/mao-obra')
    await aguardarConteudo(page)
    await expect(page.getByTestId('mao-obra-page')).toBeVisible()
    await expect(page.getByTestId('mao-obra-area')).toHaveAttribute('data-area', 'hub')
  })
})
