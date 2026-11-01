// Plano de Ação 5W2H — REUNIÃO e ações por reunião (CEO 14/10, Frioeste). Migration 20261014233030 → @pos-migration.
// Na "Indústria (SST) - DEMO" (o robô só toca demonstração). Prova, COMO O ROBÔ, as RPCs novas da reunião e o patch das
// RPCs de ação (vínculo, filtro por reunião, KPIs por reunião, busca por título da reunião).
//
// Hygiene (incidente 14/10): NUNCA seta setor_id; HARD DELETE (service_role) de reunião+ação (e históricos) da DEMO no
// início e no fim — nada sobra para travar fn_demo_reset de outra spec. A prova de tela (RD-95) roda SEM @pos.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, rpcComoRobo, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const ROTA = '/dashboard/industrial/plano-acao'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const MARCA = `ZZ-REU ${RUN}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Salvar = { ok: boolean; id?: string; codigo?: string; erro?: string }
type Status = { ok: boolean; erro?: string }
type Item = { id: string; codigo: string; titulo: string; origem: string | null; reuniao_id: string | null; reuniao_codigo: string | null; reuniao_titulo: string | null }
type Listar = { ok: boolean; resultados: Item[] }
type Reu = { ok: boolean; reunioes: Array<{ id: string; codigo: string; titulo: string; acoes_total: number; acoes_abertas: number; acoes_atrasadas: number; acoes_concluidas: number }> }
type Resumo = { ok: boolean; abertas: number; atrasadas: number }

async function limparDemo(): Promise<void> {
  await dbDelete('erp_plano_acao_historico', `company_id=eq.${DEMO_IND}`).catch(() => {})
  await dbDelete('erp_plano_acao', `company_id=eq.${DEMO_IND}`).catch(() => {})
  await dbDelete('erp_plano_acao_reuniao_historico', `company_id=eq.${DEMO_IND}`).catch(() => {})
  await dbDelete('erp_plano_acao_reuniao', `company_id=eq.${DEMO_IND}`).catch(() => {})
}

test.describe('Indústria — Plano de Ação 5W2H · Reunião', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_IND}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await obterSessionPayload()
    await limparDemo()
  })
  test.afterAll(async () => { await limparDemo() })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-industria-plano-acao-reuniao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('RPCs: cria reunião, vincula ação (origem=reunião), filtra/resume por reunião, busca e exclui preservando a ação', { tag: '@pos-migration' }, async () => {
    // guarda: título obrigatório
    const semTit = await rpcComoRobo<Salvar>('fn_plano_acao_reuniao_salvar', { p_company_id: DEMO_IND, p_reuniao: { titulo: '  ' } })
    expect(semTit.corpo?.ok).toBe(false); expect(semTit.corpo?.erro).toBe('titulo_obrigatorio')

    // cria a reunião
    const re = await rpcComoRobo<Salvar>('fn_plano_acao_reuniao_salvar', { p_company_id: DEMO_IND, p_reuniao: {
      titulo: `Semanal ${MARCA}`, data_hora: `${dia(0)}T09:00`, local: 'Sala', dono_nome: 'Cleverton',
      participantes: 'João, Maria', pauta: 'Rendimento', status: 'realizada' } })
    expect(re.corpo?.ok, re.texto).toBe(true)
    expect(re.corpo?.codigo).toMatch(/^RE-\d{4}-\d{4}$/)
    const reId = re.corpo!.id!

    // ação vinculada à reunião (sem setor) → nasce com origem='reuniao'
    const a1 = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `Trocar sensor ${MARCA}`, quando: dia(-1), prioridade: 'alta', reuniao_id: reId } })
    expect(a1.corpo?.ok).toBe(true)
    const a1Id = a1.corpo!.id!
    // uma ação fora da reunião
    const a2 = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `Avulsa ${MARCA}`, quando: dia(30), prioridade: 'media' } })
    expect(a2.corpo?.ok).toBe(true)

    // reuniao_id inválido é recusado
    const inval = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `X ${MARCA}`, reuniao_id: '00000000-0000-4000-a000-0000000000ff' } })
    expect(inval.corpo?.ok).toBe(false); expect(inval.corpo?.erro).toBe('reuniao_invalida')

    // listar geral: a ação da reunião traz o vínculo e origem=reuniao
    const geral = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND })
    const r1 = geral.corpo!.resultados.find((r) => r.id === a1Id)!
    expect(r1.origem).toBe('reuniao')
    expect(r1.reuniao_id).toBe(reId)
    expect(r1.reuniao_codigo).toBe(re.corpo!.codigo)

    // filtro por reunião: só a ação dela
    const soReu = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND, p_reuniao: reId })
    expect(soReu.corpo!.resultados.map((r) => r.id).sort()).toEqual([a1Id].sort())

    // busca pelo título da reunião acha a ação vinculada
    const busca = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND, p_busca: `Semanal ${MARCA}` })
    expect(busca.corpo!.resultados.some((r) => r.id === a1Id)).toBe(true)

    // resumo por reunião: 1 ação, atrasada (prazo ontem)
    const resumo = await rpcComoRobo<Resumo>('fn_plano_acao_resumo', { p_company_id: DEMO_IND, p_reuniao: reId })
    expect(resumo.corpo?.ok).toBe(true)
    expect(resumo.corpo!.abertas).toBe(1)
    expect(resumo.corpo!.atrasadas).toBe(1)

    // listar reuniões com contagem
    const reuList = await rpcComoRobo<Reu>('fn_plano_acao_reuniao_listar', { p_company_id: DEMO_IND })
    const rr = reuList.corpo!.reunioes.find((r) => r.id === reId)!
    expect(rr.acoes_total).toBe(1)
    expect(rr.acoes_atrasadas).toBe(1)

    // excluir a reunião: ela some, mas a ação continua (só perde o vínculo)
    const exc = await rpcComoRobo<Status>('fn_plano_acao_reuniao_excluir', { p_id: reId })
    expect(exc.corpo?.ok).toBe(true)
    const depois = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND })
    const r1b = depois.corpo!.resultados.find((r) => r.id === a1Id)!
    expect(r1b, 'a ação continua no plano').toBeTruthy()
    expect(r1b.reuniao_id, 'sem vínculo após excluir a reunião').toBeNull()
    expect((await rpcComoRobo<Reu>('fn_plano_acao_reuniao_listar', { p_company_id: DEMO_IND })).corpo!.reunioes.some((r) => r.id === reId)).toBe(false)
  })

  // Tela (sem @pos): seletor de reunião, nova reunião com "?" em todo campo, e criar ação dentro da reunião.
  test('pela tela: nova reunião, "?" em todo campo e nova ação vinculada', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto(ROTA)
    await aguardarConteudo(page)

    await page.getByTestId('plano-reuniao-nova').click()
    const form = page.getByTestId('plano-form')
    await expect(form).toBeVisible()
    expect(await form.locator('[data-testid^="ajuda-industrial.plano_acao.reuniao_"]').count()).toBeGreaterThanOrEqual(7)
    const titulo = `Pela tela ${MARCA}`
    await form.getByTestId('reuniao-titulo').fill(titulo)
    await form.getByTestId('reuniao-dono').fill('Cleverton')
    await form.getByTestId('reuniao-salvar').click()
    await expect(form).toBeHidden({ timeout: 15000 })

    // selecionada automaticamente → resumo visível
    await expect(page.getByTestId('plano-reuniao-resumo')).toBeVisible({ timeout: 15000 })
    // nova ação dentro da reunião
    await page.getByTestId('plano-reuniao-nova-acao').click()
    const acaoForm = page.getByTestId('plano-form')
    await acaoForm.getByTestId('campo-titulo').fill(`Ação da reunião ${MARCA}`)
    await acaoForm.getByTestId('campo-quando').fill(dia(10))
    await acaoForm.getByTestId('plano-salvar').click()
    await expect(acaoForm).toBeHidden({ timeout: 15000 })
    await expect(page.getByTestId('plano-card').filter({ hasText: `Ação da reunião ${MARCA}` })).toBeVisible({ timeout: 15000 })

    // confirma no banco: a ação ficou vinculada e com origem=reuniao
    await expect.poll(async () => (await dbSelect<{ origem: string; reuniao_id: string | null }>('erp_plano_acao',
      `company_id=eq.${DEMO_IND}&titulo=eq.${encodeURIComponent(`Ação da reunião ${MARCA}`)}&excluido_em=is.null&select=origem,reuniao_id`))[0]?.origem,
      { timeout: 15000, message: 'ação criada pela tela com origem=reuniao' }).toBe('reuniao')
  })
})
