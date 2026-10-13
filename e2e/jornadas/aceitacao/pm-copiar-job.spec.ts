// P&M · "Copiar de um job pronto" (spec aprovada pelo CEO, 03/10). Migration 20261003110000 · @pos-migration.
// Na "Agência (P&M) - DEMO" (robô só em demonstração). O teste cria o próprio job de origem (concluído, rodada 2,
// com tarefas marcadas, comentário, anexo e responsável) e confere, COMO O ROBÔ (as mesmas RPCs da tela):
//   1) a busca com erro de digitação e sem acento acha o job ("carosel dia das criancas …"); "Jobs parecidos" também;
//   2) a cópia leva briefing, peça, tempo estimado, cliente e tarefas (checklist desmarcado) e NÃO leva datas,
//      situação, rodada, comentários, aprovações, horas, responsáveis nem anexos (só se marcados);
//      prazo = hoje + a duração do original; copiado_de_job_id e a linha no histórico;
//   3) na tela: Novo Job → "Copiar de um job pronto" → busca → prévia → copiar (computador e celular, com prints).
// Limpeza sem apagar nada: o job de origem e as cópias vão para a lixeira (excluido_em).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbInsertMany, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'
import { diaEmSaoPaulo, prazoDaCopia } from '../../../src/lib/pm/copiarJob'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const MARCA = `Xilofone ${RUN}`
const TITULO = `Carrossel — Dia das Crianças ${MARCA}`
const dia = (n: number) => diaEmSaoPaulo(new Date(Date.now() + n * 86_400_000))

type Job = {
  id: string; numero: string; titulo: string; descricao: string; tipo: string; status: string; rodada_ajuste: number
  data_inicio: string | null; data_prazo: string | null; horas_estimadas: number; horas_realizadas: number
  responsavel_id: string | null; arquivos: unknown[]; cliente_id: string | null; copiado_de_job_id: string | null; excluido_em: string | null
}
type Tarefa = { titulo: string; status: string; responsavel_id: string | null; data_prazo: string | null; horas_realizadas: number; checklist: Array<Record<string, unknown> | string>; anexos: unknown[] }

test.describe('P&M — copiar de um job pronto', () => {
  let token = ''
  let robo = ''
  let origem = ''
  let cli1 = ''
  let cli2 = ''

  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }
  const job = async (id: string) => (await dbSelect<Job>('agency_jobs', `id=eq.${id}&select=*`))[0]
  const tarefas = (id: string) => dbSelect<Tarefa>('agency_tarefas', `job_id=eq.${id}&select=titulo,status,responsavel_id,data_prazo,horas_realizadas,checklist,anexos&order=ordem`)

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    robo = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { sub: string }).sub
    const cls = await dbSelect<{ id: string }>('agency_clientes', `company_id=eq.${DEMO_PM}&select=id&order=created_at&limit=2`)
    expect(cls.length, 'a demo tem clientes P&M').toBe(2)
    ;[cli1, cli2] = [cls[0].id, cls[1].id]
    origem = (await dbInsert<{ id: string }>('agency_jobs', {
      company_id: DEMO_PM, cliente_id: cli1, titulo: TITULO, tipo: 'post_rede_social', status: 'concluida', rodada_ajuste: 2,
      descricao: `**Contexto:** promoção de brinquedos (${MARCA}).\n**Entregáveis:** carrossel 3 cards 1080×1350.`,
      data_inicio: dia(-12), data_prazo: dia(-7), horas_estimadas: 6, horas_realizadas: 7.5, responsavel_id: robo,
      arquivos: [{ nome: 'logo-cliente.png', url: 'https://exemplo.invalid/logo.png' }], tags: ['aceitacao-copiar-job'],
    })).id
    await dbInsertMany('agency_tarefas', [
      { company_id: DEMO_PM, job_id: origem, titulo: 'Redação', ordem: 0, status: 'concluida', responsavel_id: robo, data_prazo: dia(-9),
        horas_estimadas: 2, horas_realizadas: 3, checklist: [{ texto: 'Título', feito: true, feito_em: dia(-10) }, { texto: 'CTA', concluido: true }], anexos: [{ nome: 'ref.pdf' }] },
      { company_id: DEMO_PM, job_id: origem, titulo: 'Arte', ordem: 1, status: 'concluida', responsavel_id: null, data_prazo: dia(-8), horas_estimadas: 4, horas_realizadas: 4, checklist: [], anexos: [] },
    ])
    await dbInsert('agency_job_comentarios', { company_id: DEMO_PM, job_id: origem, texto: `Comentário do original ${MARCA}` })
  })
  test.afterAll(async () => {
    const agora = new Date().toISOString()
    // o original e todas as cópias (inclusive cópia de cópia) levam a marca no título
    await dbPatch('agency_jobs', `company_id=eq.${DEMO_PM}&titulo=ilike.*${encodeURIComponent(MARCA)}*&excluido_em=is.null`, { excluido_em: agora }).catch(() => {})
    if (origem) await dbPatch('agency_jobs', `id=eq.${origem}`, { excluido_em: agora }).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pm-copiar-job', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('busca com erro de digitação e sem acento acha o job; "Jobs parecidos" também', { tag: '@pos-migration' }, async () => {
    const [o] = await dbSelect<{ busca_texto: string }>('agency_jobs', `id=eq.${origem}&select=busca_texto`)
    expect(o.busca_texto, 'busca_texto preenchido pelo gatilho, sem acento').toContain('carrossel dia das criancas')
    const r = await rpcRobo<{ total: number; itens: Array<{ id: string; titulo: string }> }>('fn_pm_jobs_buscar', {
      p_company_id: DEMO_PM, p_texto: `carosel dia das criancas ${MARCA.toLowerCase().replace('xilofone', 'xilofne')}`, p_filtros: {}, p_pagina: 1, p_por_pagina: 10,
    })
    expect(r.itens[0]?.id, '"carosel dia das criancas xilofne" acha "Carrossel — Dia das Crianças Xilofone" em primeiro').toBe(origem)
    const filtrado = await rpcRobo<{ itens: Array<{ id: string }> }>('fn_pm_jobs_buscar', {
      p_company_id: DEMO_PM, p_texto: 'carosel', p_filtros: { pecas: ['post_rede_social'], situacoes: ['concluida'], clientes: [cli1] }, p_pagina: 1, p_por_pagina: 50,
    })
    expect(filtrado.itens.some((i) => i.id === origem), 'filtros de peça, situação e cliente mantêm o job').toBe(true)
    const fora = await rpcRobo<{ itens: Array<{ id: string }> }>('fn_pm_jobs_buscar', {
      p_company_id: DEMO_PM, p_texto: 'carosel', p_filtros: { situacoes: ['em_producao'] }, p_pagina: 1, p_por_pagina: 50,
    })
    expect(fora.itens.some((i) => i.id === origem), 'filtro de situação tira o job').toBe(false)
    const par = await rpcRobo<{ total: number; itens: Array<{ id: string }> }>('fn_pm_jobs_parecidos', { p_company_id: DEMO_PM, p_titulo: `Carrosel dia das crianças ${MARCA}`, p_limite: 5 })
    expect(par.total, 'Jobs parecidos (N)').toBeGreaterThanOrEqual(1)
    expect(par.itens.some((i) => i.id === origem)).toBe(true)
  })

  test('a cópia leva o que deve, não leva o resto, e o prazo é hoje + a duração do original', { tag: '@pos-migration' }, async () => {
    const r = await rpcRobo<{ ok: boolean; job_id: string; regra_prazo: string; data_prazo: string; tarefas: number }>('fn_pm_job_copiar', { p_job_id: origem, p_opcoes: {} })
    expect(r.ok).toBe(true)
    const o = await job(origem)
    const n = await job(r.job_id)
    const esperado = prazoDaCopia({ data_inicio: o.data_inicio, data_prazo: o.data_prazo, criado_em: null }, diaEmSaoPaulo(new Date()))
    expect(esperado.dias).toBe(5)
    expect(r.regra_prazo).toBe('duracao')
    expect(String(n.data_prazo).slice(0, 10), 'prazo = hoje + 5 dias').toBe(esperado.data_prazo)
    // leva
    expect(n.descricao).toBe(o.descricao)
    expect(n.tipo).toBe('post_rede_social')
    expect(Number(n.horas_estimadas)).toBe(6)
    expect(n.cliente_id).toBe(cli1)
    expect(n.copiado_de_job_id).toBe(origem)
    expect(n.numero && n.numero !== o.numero, 'número novo da empresa').toBeTruthy()
    // não leva
    expect(n.status).toBe('nao_iniciada')
    expect(n.rodada_ajuste).toBe(0)
    expect(n.data_inicio).toBeNull()
    expect(Number(n.horas_realizadas)).toBe(0)
    expect(n.responsavel_id, 'responsável só se marcado').toBeNull()
    expect(n.arquivos, 'anexos só se marcados').toEqual([])
    const ts = await tarefas(r.job_id)
    expect(ts.map((t) => t.titulo)).toEqual(['Redação', 'Arte'])
    expect(ts.every((t) => t.status === 'pendente' && t.responsavel_id === null && t.data_prazo === null && Number(t.horas_realizadas) === 0)).toBe(true)
    expect(ts[0].checklist, 'checklist desmarcado').toEqual([{ texto: 'Título', feito: false }, { texto: 'CTA', concluido: false }])
    expect(ts[0].anexos).toEqual([])
    const feed = await dbSelect<{ texto: string }>('agency_job_comentarios', `job_id=eq.${r.job_id}&select=texto`)
    expect(feed.map((f) => f.texto), 'só a linha da cópia no histórico — comentários do original não vão').toEqual([expect.stringContaining(`Copiado do job ${o.numero}`)])
    expect(await dbSelect('agency_aprovacoes', `job_id=eq.${r.job_id}&select=id`)).toEqual([])

    // com as opções marcadas e o cliente trocado
    const r2 = await rpcRobo<{ ok: boolean; job_id: string }>('fn_pm_job_copiar', { p_job_id: origem, p_opcoes: { responsaveis: true, anexos: true, cliente_id: cli2, titulo: `${TITULO} 2026` } })
    const n2 = await job(r2.job_id)
    expect(n2.responsavel_id).toBe(robo)
    expect(n2.arquivos).toHaveLength(1)
    expect(n2.cliente_id).toBe(cli2)
    expect(n2.titulo).toBe(`${TITULO} 2026`)
    const ts2 = await tarefas(r2.job_id)
    expect(ts2[0].responsavel_id).toBe(robo)
    expect(ts2[0].anexos).toHaveLength(1)
    expect(ts2[0].checklist).toEqual([{ texto: 'Título', feito: false }, { texto: 'CTA', concluido: false }])
  })

  test('tela: Novo Job → Copiar de um job pronto (computador e celular)', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/dashboard/producao?empresa=${DEMO_PM}&novo=job`)
    await aguardarConteudo(page)

    // "Jobs parecidos (N)" enquanto digita o título
    await page.getByTestId('job-titulo').fill(`Carrosel dia das crianças ${MARCA}`)
    await expect(page.getByTestId('jobs-parecidos-abrir')).toContainText('Jobs parecidos', { timeout: 15000 })
    await expect(page.getByTestId('ajuda-pm.job.titulo')).toBeVisible()

    await page.getByTestId('job-copiar-abrir').click()
    const dlg = page.getByTestId('copiar-job')
    await expect(dlg).toBeVisible()
    for (const k of ['pm.copiar.busca']) await expect(dlg.getByTestId(`ajuda-${k}`)).toBeVisible()
    await dlg.getByTestId('copiar-busca').fill(`carosel dia das criancas ${MARCA.toLowerCase()}`)
    await expect(dlg.getByTestId('copiar-item').first()).toContainText(MARCA, { timeout: 15000 })
    // as cópias do teste anterior também casam: o filtro "Concluída" deixa só o original
    await dlg.getByTestId('copiar-filtros-abrir').click()
    for (const k of ['pm.copiar.cliente_filtro', 'pm.copiar.peca_filtro', 'pm.copiar.situacao_filtro', 'pm.copiar.periodo']) await expect(dlg.getByTestId(`ajuda-${k}`).first()).toBeVisible()
    await dlg.getByTestId('copiar-filtro-situacao').selectOption('concluida')
    const primeiro = dlg.getByTestId('copiar-item').filter({ hasText: MARCA })
    await expect(primeiro).toHaveCount(1, { timeout: 15000 })
    await expect(primeiro).toHaveAttribute('data-numero', (await job(origem)).numero)
    await primeiro.click()
    const previa = dlg.getByTestId('copiar-previa')
    await expect(previa.getByTestId('copiar-previa-briefing')).toContainText('promoção de brinquedos', { timeout: 15000 })
    await expect(previa.getByTestId('copiar-previa-tarefas')).toContainText('Redação')
    await expect(previa.getByTestId('copiar-prazo-regra')).toHaveAttribute('data-regra', 'duracao')
    await expect(previa.getByTestId('copiar-prazo')).toHaveValue(dia(5))
    for (const k of ['pm.copiar.cliente', 'pm.copiar.titulo', 'pm.copiar.prazo', 'pm.copiar.responsaveis', 'pm.copiar.anexos']) await expect(previa.getByTestId(`ajuda-${k}`)).toBeVisible()
    await expect(previa.getByTestId('copiar-o-que-vai')).toContainText('Comentários')
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-copiar-job-computador.png', fullPage: false })
    await previa.getByTestId('copiar-titulo').fill(`${TITULO} (tela)`)
    await previa.getByTestId('copiar-confirmar').click()
    await expect(dlg).toBeHidden({ timeout: 15000 })
    await expect.poll(async () => (await dbSelect<{ id: string }>('agency_jobs', `copiado_de_job_id=eq.${origem}&titulo=eq.${encodeURIComponent(`${TITULO} (tela)`)}&select=id`)).length,
      { message: 'job novo criado pela tela', timeout: 15000 }).toBe(1)

    // celular: o "Copiar" abre em tela cheia, lista → prévia → voltar
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/dashboard/producao?empresa=${DEMO_PM}&novo=job`)
    await aguardarConteudo(page)
    await page.getByTestId('job-copiar-abrir').click()
    const cel = page.getByTestId('copiar-job')
    await cel.getByTestId('copiar-busca').fill(`criancas ${MARCA.toLowerCase()}`)
    await expect(cel.getByTestId('copiar-item').first()).toContainText(MARCA, { timeout: 15000 })
    await cel.getByTestId('copiar-item').first().click()
    await expect(cel.getByTestId('copiar-previa')).toBeVisible()
    await expect(cel.getByTestId('copiar-confirmar')).toBeVisible()
    await page.screenshot({ path: 'e2e/diagnostico-host/pm-copiar-job-celular.png', fullPage: false })
    await cel.getByTestId('copiar-voltar').click()
    await expect(cel.getByTestId('copiar-lista')).toBeVisible()
    await cel.getByTestId('copiar-fechar').click()
    await expect(cel).toBeHidden()
  })
})
