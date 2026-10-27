// Chamado #2710 (FCR · caixa jordana-code a155726a), última parte: na entrada da nota de compra, o preço de venda sugerido
// segue o markup do produto (ou o geral) sobre o custo da nota ÷ fator da embalagem, e "Gravar preço" atualiza o produto
// com histórico. Usa só funções já publicadas (fn_preco_markup_efetivo, fn_produto_preco_aplicar) e a mesma conta da tela
// (src/lib/precificacao/entradaNota). Demonstração Comércio (GE), nunca empresa real; tudo desfeito no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, rpcComoRobo, registrarJornada } from '../../support/api'
import { custoProdutoDaNota, precoPorMarkup } from '../../../src/lib/precificacao/entradaNota'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `PV${Date.now().toString(36).toUpperCase()}`
const MOTIVO = 'Entrada da nota de compra (markup padrão)'

type Ef = { ok?: boolean; markup_pct?: number | null; origem?: string | null; preco_sugerido?: number | null; markup_geral_pct?: number | null }

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpcComoRobo<T>(fn, args)
  expect(r.status, `${fn}: ${r.texto}`).toBe(200)
  return r.corpo as T
}

let geralAntes: number | null = null
const ids: Record<string, string> = {}

test.describe('Entrada da nota: preço de venda sugerido pelo markup padrão (chamado #2710)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-preco-venda-entrada-nota', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    await rpcComoRobo('fn_preco_markup_geral_salvar', { p_company_id: DEMO_COMERCIO, p_markup_pct: geralAntes }).catch(() => {})
    for (const id of Object.values(ids)) {
      await dbDelete('erp_preco_historico', `produto_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_preco_regra', `company_id=eq.${DEMO_COMERCIO}&escopo=eq.produto&escopo_id=eq.${id}`).catch(() => {})
      await dbDelete('erp_produtos', `id=eq.${id}`).catch(() => {})
    }
  })

  test('CX de 12 a R$ 120: produto com 40% sugere R$ 14,00, o do geral 30% R$ 13,00; Gravar preço atualiza com histórico', async () => {
    geralAntes = (await chamar<Ef>('fn_preco_markup_efetivo', { p_company_id: DEMO_COMERCIO, p_produto_id: null })).markup_geral_pct ?? null

    for (const c of ['A', 'B']) {
      const p = await dbInsert<{ id: string }>('erp_produtos', {
        company_id: DEMO_COMERCIO, codigo: `${RUN}-${c}`, nome: `Preço entrada ${RUN} ${c}`, unidade: 'UN',
        preco_custo: 9, preco_custo_medio: 9, preco_venda: 11, ativo: true,
      })
      ids[c] = p.id
    }
    expect((await chamar<{ ok?: boolean }>('fn_preco_markup_geral_salvar', { p_company_id: DEMO_COMERCIO, p_markup_pct: 30 })).ok).toBe(true)
    expect((await chamar<{ ok?: boolean; gravado?: boolean }>('fn_preco_markup_produtos', { p_company_id: DEMO_COMERCIO, p_markup_pct: 40, p_produto_ids: [ids.A], p_gravar: true })).gravado).toBe(true)

    // linha da nota: 1 CX = 12 UN, custo real R$ 120 por CX → R$ 10 por UN (a conta da tela)
    const custo = custoProdutoDaNota(120, 100, 12)
    expect(custo).toBe(10)

    const a = await chamar<Ef>('fn_preco_markup_efetivo', { p_company_id: DEMO_COMERCIO, p_produto_id: ids.A, p_custo: custo })
    const b = await chamar<Ef>('fn_preco_markup_efetivo', { p_company_id: DEMO_COMERCIO, p_produto_id: ids.B, p_custo: custo })
    expect([a.origem, a.preco_sugerido, precoPorMarkup(custo, a.markup_pct)]).toEqual(['produto', 14, 14])
    expect([b.origem, b.preco_sugerido, precoPorMarkup(custo, b.markup_pct)]).toEqual(['geral', 13, 13])

    // "Gravar preço": o sugerido no A; no B o usuário editou para 13,50
    const ga = await chamar<{ ok?: boolean; preco_antes?: number; preco_depois?: number }>('fn_produto_preco_aplicar', { p_produto_id: ids.A, p_novo_preco: 14, p_regra_id: null, p_motivo: MOTIVO })
    expect([ga.ok, Number(ga.preco_antes), Number(ga.preco_depois)]).toEqual([true, 11, 14])
    expect((await chamar<{ ok?: boolean }>('fn_produto_preco_aplicar', { p_produto_id: ids.B, p_novo_preco: 13.5, p_regra_id: null, p_motivo: MOTIVO })).ok).toBe(true)

    const prods = await dbSelect<{ codigo: string; preco_venda: number }>('erp_produtos', `id=in.(${ids.A},${ids.B})&select=codigo,preco_venda`)
    const preco = (c: string) => Number(prods.find((p) => p.codigo === `${RUN}-${c}`)?.preco_venda)
    expect([preco('A'), preco('B')]).toEqual([14, 13.5])

    const hist = await dbSelect<{ produto_id: string; preco_antes: number; preco_depois: number; motivo: string }>(
      'erp_preco_historico', `produto_id=in.(${ids.A},${ids.B})&select=produto_id,preco_antes,preco_depois,motivo`)
    expect(hist.length).toBe(2)
    expect(hist.every((h) => h.motivo === MOTIVO && Number(h.preco_antes) === 11)).toBe(true)

    // preço inválido é recusado e não mexe no produto
    expect((await chamar<{ ok?: boolean; erro?: string }>('fn_produto_preco_aplicar', { p_produto_id: ids.A, p_novo_preco: 0, p_regra_id: null, p_motivo: MOTIVO })).erro).toBe('preco_invalido')
  })
})
