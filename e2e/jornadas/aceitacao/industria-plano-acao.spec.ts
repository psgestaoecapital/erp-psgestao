// Plano de Ação 5W2H — NÚCLEO COMUM da Indústria (CEO 14/10, reunião Frioeste). Migration 20261014230030 → @pos-migration.
// Na "Indústria (SST) - DEMO" (o robô só toca demonstração). Prova, COMO O ROBÔ (as mesmas RPCs da tela):
//   criar/listar com o ATRASO calculado (prazo < hoje e não concluída), concluir EXIGE resultado, resumo (KPIs),
//   guardas (título obrigatório) e o histórico de edição (título/prazo/responsável).
//
// IMPORTANTE (incidente 14/10 — main vermelha): a DEMO industrial é compartilhada com as specs LTCAT (mesma empresa
// …005), que rodam fn_demo_reset. Uma ação que referenciasse prod_setor travava o reset (FK setor_id = NO ACTION) e
// derrubava as LTCAT. Por isso aqui: (1) NUNCA setamos setor_id; (2) limpamos por HARD DELETE (service_role) no início
// E no fim — nenhuma linha de erp_plano_acao sobra para a DEMO depois da suíte. O "?" em todo campo (RD-95) é provado
// na tela SEM o @pos (a tela é garantida no preview/aceitação da main; o @pos de produção prova a MIGRATION pelas RPCs).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, rpcComoRobo, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_IND = 'b0700000-0000-4000-a000-000000000005'
const ROTA = '/dashboard/industrial/plano-acao'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const MARCA = `ZZ-TESTE ${RUN}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Salvar = { ok: boolean; id?: string; codigo?: string; erro?: string }
type Item = { id: string; codigo: string; titulo: string; status: string; quando: string | null; resultado_obtido: string | null; atrasada: boolean }
type Listar = { ok: boolean; resultados: Item[] }
type Resumo = { ok: boolean; abertas: number; em_andamento: number; atrasadas: number; concluidas_mes: number; pct_no_prazo: number | null }
type Status = { ok: boolean; erro?: string }

// Limpa TODA linha de plano de ação da DEMO industrial (histórico primeiro por FK). A DEMO é descartável e a feature
// é nova (sem seed de plano), então apagar por empresa é seguro — e evita que sobre linha referenciando prod_setor.
async function limparDemo(): Promise<void> {
  await dbDelete('erp_plano_acao_historico', `company_id=eq.${DEMO_IND}`).catch(() => {})
  await dbDelete('erp_plano_acao', `company_id=eq.${DEMO_IND}`).catch(() => {})
}

test.describe('Indústria — Plano de Ação 5W2H', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_IND}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await obterSessionPayload() // garante login do bot (cacheado)
    await limparDemo()          // limpa resíduo de execuções anteriores antes de qualquer fn_demo_reset de outra spec
  })
  test.afterAll(async () => { await limparDemo() })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-industria-plano-acao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('RPCs: cria, lista com atraso calculado, conclui exigindo resultado, resume e guarda o histórico', { tag: '@pos-migration' }, async () => {
    // guarda: título obrigatório
    const semTitulo = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: { titulo: '   ' } })
    expect(semTitulo.status).toBe(200)
    expect(semTitulo.corpo?.ok).toBe(false)
    expect(semTitulo.corpo?.erro).toBe('titulo_obrigatorio')

    // A: prazo ONTEM, alta, com responsável (SEM setor_id — ver nota do topo) → deve calcular ATRASADA
    const a = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `Trocar sensor da câmara ${MARCA}`, o_que: 'Trocar o sensor', por_que: 'Evitar parada',
      onde: 'Câmara 2', quando: dia(-1), responsavel_nome: 'João (Manutenção)',
      como: 'Chamar fornecedor', custo_estimado: '1500', prioridade: 'alta', origem: 'reuniao', origem_ref: 'Ata 14/10',
    } })
    expect(a.corpo?.ok, a.texto).toBe(true)
    expect(a.corpo?.codigo).toMatch(/^PA-\d{4}-\d{4}$/)
    const idA = a.corpo!.id!

    // B: prazo +30d → NÃO atrasada
    const b = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_plano: {
      titulo: `Revisar limpeza ${MARCA}`, quando: dia(30), prioridade: 'media', responsavel_nome: 'Maria',
    } })
    expect(b.corpo?.ok).toBe(true)
    const idB = b.corpo!.id!

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

    // filtro só_atrasadas: A concluída sai das atrasadas
    const soAtras = await rpcComoRobo<Listar>('fn_plano_acao_listar', { p_company_id: DEMO_IND, p_so_atrasadas: true })
    expect(soAtras.corpo!.resultados.some((r) => r.id === idA), 'A concluída sai das atrasadas').toBe(false)

    // resumo (KPIs) coerente
    const resumo = await rpcComoRobo<Resumo>('fn_plano_acao_resumo', { p_company_id: DEMO_IND })
    expect(resumo.corpo?.ok).toBe(true)
    expect(resumo.corpo!.abertas).toBeGreaterThanOrEqual(1) // B segue aberta
    expect(resumo.corpo!.concluidas_mes).toBeGreaterThanOrEqual(1) // A concluída neste mês

    // edição de B muda o título/prazo/responsável → histórico registra
    const ed = await rpcComoRobo<Salvar>('fn_plano_acao_salvar', { p_company_id: DEMO_IND, p_id: idB, p_plano: {
      titulo: `Revisar limpeza (v2) ${MARCA}`, quando: dia(15), prioridade: 'media', responsavel_nome: 'Carlos',
    } })
    expect(ed.corpo?.ok).toBe(true)
    const hist = await dbSelect<{ campo: string }>('erp_plano_acao_historico', `plano_id=eq.${idB}&select=campo&order=em`)
    const campos = hist.map((h) => h.campo)
    expect(campos, 'histórico de título/prazo/responsável').toEqual(expect.arrayContaining(['titulo', 'prazo', 'responsavel']))
  })

  // Tela: KPIs + "?" em todo campo do 5W2H + criar uma ação. SEM @pos: no veredito de produção o build do front pode
  // ainda não estar no ar logo após o deploy; a tela é provada no preview/aceitação da main. O @pos prova a MIGRATION
  // pelas RPCs (teste acima). A ação criada aqui NÃO tem setor e é limpa no afterAll.
  test('pela tela: KPIs, "?" em todo campo do 5W2H e criar uma ação', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_IND)
    await page.goto(ROTA)
    await aguardarConteudo(page)

    await expect(page.getByTestId('kpi-atrasadas')).toBeVisible()
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

    // cria uma ação de ponta a ponta (sem setor — ver nota do topo)
    const titulo = `Pela tela ${MARCA}`
    await form.getByTestId('campo-titulo').fill(titulo)
    await form.getByTestId('campo-quando').fill(dia(10))
    await form.getByTestId('campo-quem').fill('Operador DEMO')
    await form.getByTestId('plano-salvar').click()
    await expect(form).toBeHidden({ timeout: 15000 })

    await expect(page.getByTestId('plano-card').filter({ hasText: titulo })).toBeVisible({ timeout: 15000 })
    await expect.poll(async () => (await dbSelect<{ id: string }>('erp_plano_acao',
      `company_id=eq.${DEMO_IND}&titulo=eq.${encodeURIComponent(titulo)}&excluido_em=is.null&select=id`)).length,
      { timeout: 15000, message: 'ação criada pela tela existe no banco' }).toBe(1)
  })
})
