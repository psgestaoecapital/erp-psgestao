// Chamado #2710 (FCR · caixa jordana-code a155726a): markup GERAL da empresa + markup PRÓPRIO por produto + alteração em
// massa com prévia + modo "markup padrão de cada produto" no Formar preços. Critério da Jordana: 40% num produto e 30%
// geral → esse produto usa 40%, os demais 30%. Depende da migration *_precificacao_markup_padrao_produto → @pos-migration.
// Demonstração Comércio (GE), nunca empresa real. Produtos de teste apagados e markup geral devolvido ao que era no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `MK${Date.now().toString(36).toUpperCase()}`

type Ef = { ok?: boolean; erro?: string; markup_pct?: number | null; origem?: string | null; preco_sugerido?: number | null; markup_geral_pct?: number | null }
type Massa = { ok?: boolean; erro?: string; gravado?: boolean; total?: number; produtos?: { codigo: string; markup_depois: number | null; origem_depois: string | null }[] }
type Painel = { ok?: boolean; config?: { markup_geral_pct?: number | null }; produtos?: { codigo: string; preco_novo: number | null; markup_padrao_pct: number | null; markup_origem: string | null }[] }

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpcComoRobo<T>(fn, args)
  expect(r.status, `${fn}: ${r.texto}`).toBe(200)
  return r.corpo as T
}
const efetivo = (produto: string | null) => chamar<Ef>('fn_preco_markup_efetivo', { p_company_id: DEMO_COMERCIO, p_produto_id: produto, p_custo: 10 })

let geralAntes: number | null = null
const ids: Record<string, string> = {}

test.describe('Precificação: markup geral + markup por produto + em massa (chamado #2710)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-precificacao-markup-padrao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    await rpcComoRobo('fn_preco_markup_geral_salvar', { p_company_id: DEMO_COMERCIO, p_markup_pct: geralAntes }).catch(() => {})
    for (const id of Object.values(ids)) {
      await dbDelete('erp_preco_regra', `company_id=eq.${DEMO_COMERCIO}&escopo=eq.produto&escopo_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_produtos', `id=eq.${id}`).catch(() => {})
    }
  })

  test('40% no produto e 30% geral: o produto usa 40%, o outro 30%; em massa com prévia; Formar preços pelo markup padrão', { tag: '@pos-migration' }, async () => {
    geralAntes = (await efetivo(null)).markup_geral_pct ?? null

    for (const c of ['A', 'B']) {
      const p = await dbInsert<{ id: string }>('erp_produtos', {
        company_id: DEMO_COMERCIO, codigo: `${RUN}-${c}`, nome: `Markup teste ${RUN} ${c}`, unidade: 'UN',
        preco_custo: 10, preco_custo_medio: 10, preco_venda: 0, ativo: true,
      })
      ids[c] = p.id
    }

    // sem seleção nenhuma, a alteração em massa recusa (nunca a empresa inteira sem querer)
    expect((await chamar<Massa>('fn_preco_markup_produtos', { p_company_id: DEMO_COMERCIO, p_markup_pct: 40 })).erro).toBe('sem_selecao')

    // geral 30%
    expect((await chamar<{ ok?: boolean }>('fn_preco_markup_geral_salvar', { p_company_id: DEMO_COMERCIO, p_markup_pct: 30 })).ok).toBe(true)

    // prévia de 40% no produto A não grava
    const previa = await chamar<Massa>('fn_preco_markup_produtos', { p_company_id: DEMO_COMERCIO, p_markup_pct: 40, p_produto_ids: [ids.A] })
    expect(previa.gravado).toBe(false)
    expect(previa.total).toBe(1)
    expect((await efetivo(ids.A)).origem).toBe('geral')

    // grava 40% no A
    expect((await chamar<Massa>('fn_preco_markup_produtos', { p_company_id: DEMO_COMERCIO, p_markup_pct: 40, p_produto_ids: [ids.A], p_gravar: true })).gravado).toBe(true)
    const a = await efetivo(ids.A)
    const b = await efetivo(ids.B)
    expect([a.markup_pct, a.origem, a.preco_sugerido]).toEqual([40, 'produto', 14])
    expect([b.markup_pct, b.origem, b.preco_sugerido]).toEqual([30, 'geral', 13])

    // Formar preços › markup padrão de cada produto
    const painel = await chamar<Painel>('fn_produtos_precos_painel', { p_company_id: DEMO_COMERCIO, p_filtro: 'todos', p_busca: RUN, p_modo: 'markup_padrao', p_valor: null, p_arredondar: 'nenhum' })
    const linha = (c: string) => painel.produtos?.find((x) => x.codigo === `${RUN}-${c}`)
    expect(painel.config?.markup_geral_pct).toBe(30)
    expect([linha('A')?.preco_novo, linha('A')?.markup_origem]).toEqual([14, 'produto'])
    expect([linha('B')?.preco_novo, linha('B')?.markup_origem]).toEqual([13, 'geral'])

    // em massa pela busca: os dois voltam ao geral
    const volta = await chamar<Massa>('fn_preco_markup_produtos', { p_company_id: DEMO_COMERCIO, p_remover: true, p_busca: RUN, p_gravar: true })
    expect(volta.total).toBe(2)
    expect((await efetivo(ids.A)).origem).toBe('geral')
  })
})
