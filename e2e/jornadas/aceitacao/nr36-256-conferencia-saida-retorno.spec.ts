// #256 (Frioeste · SST) · "por vezes eles não registram a saída e registram apenas o retorno; preciso poder identificar se
// o horário é entrada ou saída e ajustar". Causa: o relatório traz a pausa em pares (início, fim); faltando uma batida,
// o par desliza e o dia inteiro fica deslocado (caso real 22/09: 13:30–15:02, 15:32–18:42, 19:05–20:17, 20:39–aberta).
// Migration 20260929020000: fn_nr36_marcas_dia / fn_nr36_reler_dia / fn_nr36_reler_dia_desfazer + editor na Conferência.
// Demonstração Indústria (SST), nunca a Frioeste. O dia de teste é único por execução e é removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
// dia único por execução, SEMPRE em 2020 (sem horário de verão no Brasil desde 2019 — com horário de verão o
// 07:42-03:00 vira 08:42 em São Paulo e o teste erra; falhou assim em produção em 29/09). Um ano por teste de pausas,
// para um não pisar no dia do outro: #256 = 2020, #272 = 2021, apuração por colaborador = 2022, #273 = 2023.
const base = new Date(Date.UTC(2020, 0, 1) + (Math.floor(Date.now() / 60000) % 360) * 86400000)
const DIA = base.toISOString().slice(0, 10)
const DIA_BR = DIA.split('-').reverse().join('/')
const ts = (h: string) => `${DIA}T${h}:00-03:00`
let cpf = ''
let colaborador = ''
const originais: string[] = []

async function comoRobo<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  expect(r.status, `${fn} responde`).toBe(200)
  return (await r.json()) as T
}

type Pausa = { id: string; inicio: string; fim: string | null; duracao_seg: number | null; inicio_origem: string | null }
const pausasDoDia = () => dbSelect<Pausa>('ind_ponto_pausa',
  `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&select=id,inicio,fim,duracao_seg,inicio_origem&order=inicio`)

test.describe('Conferência de pausas — dizer se o horário é saída ou retorno (#256)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ nome: string; cpf: string }>('ind_ponto_colaborador',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=nome,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    cpf = c.cpf; colaborador = c.nome
    // o dia como o relatório trouxe, com a saída das 13:08 faltando: todos os pares deslocados
    const linhas: Array<[string, string | null, string]> = [['13:30', '15:02', 'pausa_nao_fechada'], ['15:32', '18:42', 'pausa_nao_fechada'],
      ['19:05', '20:17', 'pausa_nao_fechada'], ['20:39', null, 'pausa_aberta']]
    for (const [ini, fim, classe] of linhas) {
      originais.push((await dbInsert<{ id: string }>('ind_ponto_pausa', {
        company_id: DEMO_SST, cpf, data: DIA, tipo: 'termica_253', inicio: ts(ini), fim: fim ? ts(fim) : null,
        duracao_seg: fim ? (Number(fim.slice(0, 2)) * 60 + Number(fim.slice(3)) - Number(ini.slice(0, 2)) * 60 - Number(ini.slice(3))) * 60 : null,
        classe_evento: classe, raw: { origem: 'e2e-256' },
      })).id)
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-256-conferencia-saida-retorno', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (!cpf) return
    await dbDelete('ind_ponto_pausa', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
    await dbDelete('nr36_pausa_historico', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
  })

  test('a responsável marca 13:30 como retorno, acrescenta a saída 13:08 e o dia fecha com as pausas reais', { tag: '@pos-migration' }, async ({ page }) => {
    page.on('dialog', d => void d.accept())
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/compliance/pausas-tecnicas')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: 'Conferência' }).click()
    const linha = page.locator('tbody tr').filter({ hasText: colaborador }).filter({ hasText: DIA_BR }).filter({ hasText: '13:30' })
    await expect(linha, 'a pausa deslocada das 13:30 está pendente').toBeVisible({ timeout: 20000 })

    await page.getByTestId(`conf-marcas-${originais[0]}`).click()
    const modal = page.getByTestId('marcas-dia-modal')
    await expect(modal).toBeVisible()
    // lido como veio: 92, 190 e 72 min (o erro do chamado)
    await expect(page.getByTestId('marcas-previa')).toContainText('92 min')

    // cada horário a partir das 13:30 troca de papel; acrescenta a saída que faltou
    for (const [h, p] of [['1330', 'retorno'], ['1502', 'saida'], ['1532', 'retorno'], ['1842', 'saida'], ['1905', 'retorno'], ['2017', 'saida'], ['2039', 'retorno']]) {
      await page.getByTestId(`marca-${h}-${p}`).click()
    }
    await page.getByTestId('marca-nova-hora').fill('13:08')
    await page.getByTestId('marca-nova-papel').selectOption('saida')
    await page.getByTestId('marca-nova-add').click()
    const previa = page.getByTestId('marcas-previa')
    await expect(previa).toContainText('13:08 → 13:30 · 22 min')
    await expect(previa).toContainText('15:02 → 15:32 · 30 min')
    await expect(previa).toContainText('18:42 → 19:05 · 23 min')
    await expect(previa).toContainText('20:17 → 20:39 · 22 min')

    await page.getByTestId('marcas-salvar').click()
    await expect(modal).toBeHidden({ timeout: 20000 })
    await expect(page.getByText(/Dia relido: 4 pausa\(s\)/)).toBeVisible()
    await expect(linha, 'o dia saiu da Conferência').toHaveCount(0)

    const pausas = await pausasDoDia()
    expect(pausas.map(p => Math.round((p.duracao_seg ?? 0) / 60)), 'as 4 pausas reais').toEqual([22, 30, 23, 22])
    expect(pausas[0].inicio_origem, 'a saída 13:08 fica marcada como digitada').toBe('manual')
    const hist = await dbSelect<{ pausa_id_original: string; referencia: string }>('nr36_pausa_historico',
      `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&select=pausa_id_original,referencia`)
    expect(hist.map(h => h.pausa_id_original).sort(), 'a leitura anterior inteira foi para o histórico (RD-30)').toEqual([...originais].sort())
    expect(hist.every(h => h.referencia.startsWith('#256 lote ')), 'no lote da releitura').toBe(true)
  })

  test('desfazer volta o dia à leitura anterior, com os mesmos registros', { tag: '@pos-migration' }, async () => {
    const r = await comoRobo<{ ok: boolean; restauradas?: number; mensagem?: string }>('fn_nr36_reler_dia_desfazer', { p_company_id: DEMO_SST, p_cpf: cpf, p_data: DIA })
    expect(r.ok, r.mensagem).toBe(true)
    expect(r.restauradas).toBe(4)
    const pausas = await pausasDoDia()
    expect(pausas.map(p => p.id).sort(), 'os 4 registros originais de volta').toEqual([...originais].sort())
    const nada = await comoRobo<{ ok: boolean; erro?: string }>('fn_nr36_reler_dia_desfazer', { p_company_id: DEMO_SST, p_cpf: cpf, p_data: DIA })
    expect(nada.erro, 'não há mais o que desfazer').toBe('nada_a_desfazer')
  })

  test('retorno sem saída não se fecha pelo fim: fica pendente até informar a saída', { tag: '@pos-migration' }, async () => {
    const r = await comoRobo<{ ok: boolean; mensagem?: string }>('fn_nr36_reler_dia', {
      p_company_id: DEMO_SST, p_cpf: cpf, p_data: DIA,
      p_marcas: [{ hora: '13:30', papel: 'retorno' }, { hora: '15:02', papel: 'saida' }, { hora: '15:32', papel: 'retorno' }],
    })
    expect(r.ok, r.mensagem).toBe(true)
    const pend = await comoRobo<Array<{ pausa_id: string; data: string; inicio_local: string; sem_saida: boolean }>>('fn_nr36_pausas_pendentes_listar', { p_company_id: DEMO_SST, p_limite: 5000 })
    const semSaida = pend.find(p => p.data === DIA && p.inicio_local === '13:30')
    expect(semSaida?.sem_saida, 'o retorno das 13:30 aparece pendente, sem saída').toBe(true)
    const conf = await comoRobo<{ ok: boolean; erro?: string }>('fn_nr36_confirmar_fim_pausa', { p_pausa_id: semSaida!.pausa_id, p_acao: 'confirmar_estimativa', p_fim_manual: null })
    expect(conf.erro, 'confirmar o fim sem saída é recusado').toBe('sem_saida')
  })
})
