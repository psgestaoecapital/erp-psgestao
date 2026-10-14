// Plano de Ação 5W2H — NÚCLEO COMUM da Indústria (CEO 14/10, reunião Frioeste). Migration 20261014230030 → @pos-migration.
// Na "Indústria (SST) - DEMO" (o robô só toca demonstração). Prova, COMO O ROBÔ (as mesmas RPCs da tela):
//   1) criar/listar com o ATRASO calculado (prazo < hoje e não concluída), concluir EXIGE resultado, resumo (KPIs),
//      guardas (título obrigatório) e o histórico de edição (título/prazo/responsável);
//   2) pela tela: KPIs, formulário 5W2H com "?" em todo campo, e criar uma ação de ponta a ponta.
// Limpeza: as ações criadas (marcadas no título) saem pelo próprio fn_plano_acao_excluir (exclusão lógica).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, rpcComoRobo, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const ROTA = '/dashboard/industrial/plano-acao'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const MARCA = `ZZ-TESTE ${RUN}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Salvar = { ok: boolean; id?: string; codigo?: string; erro?: string }
type Item = {
  id: string; codigo: string; titulo: string; status: string; prioridade: string
  quando: string | null; responsavel_nome: string | null; setor_id: string | null
  resultado_obtido: string | null; atrasada: boolean
}
type Listar = { ok: boolean; resultados: Item[] }
type Resumo = { ok: boolean; abertas: number; em_andamento: number; atrasadas: number; concluidas_mes: number; pct_no_prazo: number | null }
type Status = { ok: boolean; erro?: string }

test.describe('Indústria — Plano de Ação 5W2H', () => {
  let setorId: string | null = null
  const criados: string[] = []

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_IND}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await obterSessionPayload() // garante login do bot (cacheado)
    const setores = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_IND}&select=id&order=nome&limit=1`)
    setorId = setores[0]?.id ?? null
  })

  test.afterAll(async () => {
    // exclusão lógica das ações do teste (as criadas por RPC e as marcadas no título pela tela)
    const extras = await dbSelect<{ id: string }>('erp_plano_acao', `company_id=eq.${DEMO_IND}&titulo=ilike.*${encodeURIComponent(MARCA)}*&excluido_em=is.null&select=id`).catch(() => [])
    for (const id of new Set([...criados, ...extras.map((e) => e.id)])) {
      await rpcComoRobo<Status>('fn_plano_acao_excluir', { p_id: id }).catch(() => {})
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-industria-plano-acao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('RPCs: cria, lista com atraso calculado, conclui exigindo resultado, resume e guarda o histórico', { tag: '@pos-migration' }, async () => {
    // guarda: título obrigatório
    const semTitulo = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: { titulo: '   ' } })
    expect(semTitulo.status).toBe(200)
    expect(semTitulo.corpo?.ok).toBe(false)
    expect(semTitulo.corpo?.erro).toBe('titulo_obrigatorio')

    // A: prazo ONTEM, alta, com setor e responsável → deve calcular ATRASADA
    const a = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `Trocar sensor da câmara ${MARCA}`, o_que: 'Trocar o sensor', por_que: 'Evitar parada',
      onde: 'Câmara 2', setor_id: setorId ?? '', quando: dia(-1), responsavel_nome: 'João (Manutenção)',
      como: 'Chamar fornecedor', custo_estimado: '1500', prioridade: 'alta', origem: 'reuniao', origem_ref: 'Ata 14/10',
    } })
    expect(a.corpo?.ok, a.texto).toBe(true)
    expect(a.corpo?.codigo).toMatch(/^PA-\d{4}-\d{4}$/)
    const idA = a.corpo!.id!; criados.push(idA)

    // B: prazo +30d → NÃO atrasada
    const b = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `Revisar limpeza ${MARCA}`, quando: dia(30), prioridade: 'media', responsavel_nome: 'Maria',
    } })
    expect(b.corpo?.ok).toBe(true)
    const idB = b.corpo!.id!; criados.push(idB)

    // listar: A atrasada, B não
    const lista = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND })
    expect(lista.corpo?.ok).toBe(true)
    const ra = lista.corpo!.resultados.find((r) => r.id === idA)!
    const rb = lista.corpo!.resultados.find((r) => r.id === idB)!
    expect(ra.atrasada, 'A (prazo ontem, aberta) é atrasada').toBe(true)
    expect(rb.atrasada, 'B (prazo +30d) não é atrasada').toBe(false)

    // concluir A SEM resultado → recusa
    const semRes = await rpcComoRobo<Status>('fn_plano_acao_status', { p_id: idA, p_status: 'concluida' })
    expect(semRes.corpo?.ok).toBe(false)
    expect(semRes.corpo?.erro).toBe('resultado_obrigatorio')

    // mover para em_andamento, depois concluir COM resultado
    expect((await rpcComoRobo<Status>('fn_plano_acao_status', { p_id: idA, p_status: 'em_andamento' })).corpo?.ok).toBe(true)
    const concl = await rpcComoRobo<Status>('fn_plano_acao_status', { p_id: idA, p_status: 'concluida', p_resultado: 'Sensor trocado, câmara estável' })
    expect(concl.corpo?.ok).toBe(true)

    const lista2 = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND })
    const ra2 = lista2.corpo!.resultados.find((r) => r.id === idA)!
    expect(ra2.status).toBe('concluida')
    expect(ra2.atrasada, 'concluída não conta como atrasada').toBe(false)
    expect(ra2.resultado_obtido).toContain('Sensor trocado')

    // filtro só_atrasadas pega B? não (B não está atrasada); pega nenhuma das minhas após concluir A
    const soAtras = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND, p_so_atrasadas: true })
    expect(soAtras.corpo!.resultados.some((r) => r.id === idA), 'A concluída sai das atrasadas').toBe(false)

    // resumo (KPIs) coerente
    const resumo = await rpcComoRobo<Resumo>('fn_plano_acao_resumo', { p_company_id: DEMO_IND })
    expect(resumo.corpo?.ok).toBe(true)
    expect(resumo.corpo!.abertas).toBeGreaterThanOrEqual(1) // B segue aberta
    expect(resumo.corpo!.concluidas_mes).toBeGreaterThanOrEqual(1) // A concluída neste mês

    // edição de B muda o título → histórico registra
    const ed = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_id: idB, p_plano: {
      titulo: `Revisar limpeza (v2) ${MARCA}`, quando: dia(15), prioridade: 'media', responsavel_nome: 'Carlos',
    } })
    expect(ed.corpo?.ok).toBe(true)
    const hist = await dbSelect<{ campo: string }>('erp_plano_acao_historico', `plano_id=eq.${idB}&select=campo&order=em`)
    const campos = hist.map((h) => h.campo)
    expect(campos, 'histórico de título/prazo/responsável').toEqual(expect.arrayContaining(['titulo', 'prazo', 'responsavel']))
  })

  test('pela tela: KPIs, "?" em todo campo do 5W2H e criar uma ação', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto(ROTA)
    await aguardarConteudo(page)

    await expect(page.getByTestId('kpi-atrasadas')).toBeVisible()
    // "?" dos indicadores
    await expect(page.getByTestId('ajuda-industrial.plano_acao.kpi_atrasadas')).toBeVisible()

    // abre o formulário 5W2H
    await page.getByTestId('plano-novo').click()
    const form = page.getByTestId('plano-form')
    await expect(form).toBeVisible()
    // "?" em todo campo (os 14 do formulário) — pelo menos 12 visíveis
    expect(await form.locator('[data-testid^="ajuda-industrial.plano_acao."]').count()).toBeGreaterThanOrEqual(12)

    // o "?" abre o cartão com os 4 blocos
    await form.getByTestId('ajuda-industrial.plano_acao.quando').click()
    const cartao = page.getByTestId('ajuda-cartao-industrial.plano_acao.quando')
    await expect(cartao).toBeVisible()
    for (const bloco of ['O que preencher', 'Para que serve no cálculo', 'Exemplo', 'Erro comum']) await expect(cartao.getByText(bloco, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    // cria uma ação de ponta a ponta
    const titulo = `Pela tela ${MARCA}`
    await form.getByTestId('campo-titulo').fill(titulo)
    await form.getByTestId('campo-quando').fill(dia(10))
    await form.getByTestId('campo-quem').fill('Operador DEMO')
    await form.getByTestId('plano-salvar').click()
    await expect(form).toBeHidden({ timeout: 15000 })

    // o card aparece no quadro
    await expect(page.getByTestId('plano-card').filter({ hasText: titulo })).toBeVisible({ timeout: 15000 })
    // confirma no banco (e guarda para limpeza)
    await expect.poll(async () => (await dbSelect<{ id: string }>('erp_plano_acao',
      `company_id=eq.${DEMO_IND}&titulo=eq.${encodeURIComponent(titulo)}&excluido_em=is.null&select=id`)).length,
      { timeout: 15000, message: 'ação criada pela tela existe no banco' }).toBe(1)
  })
})
