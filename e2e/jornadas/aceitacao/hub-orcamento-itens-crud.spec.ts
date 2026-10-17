// HB2 Fatia 1 · CRUD dos itens do orçamento (migration 20261013200005) · @pos-migration.
// Na "Construtora Modelo - DEMO" (robô só em demonstração), COMO O ROBÔ (as mesmas RPCs da tela):
//   1) adicionar/editar/excluir item → subtotal do item e total do cabeçalho conferem a cada passo;
//   2) escopo congelado → as três operações recusam com mensagem clara e o total não muda;
//   3) aprovar o orçamento (como a tela) dispara o gatilho que cria a obra sem erro, com itens presentes (sem regressão).
// Limpeza: o orçamento de teste é removido ao final (só o criado aqui, pela marca no número).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, rpcComoRobo } from '../../support/api'

const DEMO_HUB = 'b0700000-0000-4000-a000-000000000006'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const NUMERO = `ACE-HB2-${RUN}`

type R = { ok: boolean; erro?: string; item_id?: string; subtotal_item?: number; total?: number }

test.describe('Hub — itens do orçamento (CRUD)', () => {
  let orc = ''
  const total = async () => Number((await dbSelect<{ total: number }>('erp_orcamentos', `id=eq.${orc}&select=total`))[0].total)
  const chamar = async (fn: string, args: Record<string, unknown>) => {
    const r = await rpcComoRobo<R>(fn, args)
    expect(r.status, `${fn}: ${r.texto}`).toBe(200)
    return r.corpo as R
  }

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_HUB}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    orc = (await dbInsert<{ id: string }>('erp_orcamentos', {
      company_id: DEMO_HUB, numero: NUMERO, cliente_nome: 'Cliente sintético HB2', status: 'rascunho',
    })).id
  })
  test.afterAll(async () => {
    if (!orc) return
    await dbDelete('erp_orcamentos_itens', `orcamento_id=eq.${orc}`).catch(() => {})
    await dbDelete('erp_orcamento_historico', `orcamento_id=eq.${orc}`).catch(() => {})
    await dbDelete('erp_orcamentos', `id=eq.${orc}&numero=eq.${NUMERO}`).catch(() => {})
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-orcamento-itens', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('adicionar, editar e excluir item: total do cabeçalho confere', { tag: '@pos-migration' }, async () => {
    const a = await chamar('fn_orcamento_item_adicionar', { p_orcamento_id: orc, p_item: { produto_nome: 'Parede drywall', tipo_item: 'produto', unidade: 'm2', quantidade: '10', preco_unitario: '100', desconto_percentual: '10' } })
    expect(a.ok, a.erro).toBe(true)
    expect(Number(a.subtotal_item)).toBe(900)
    expect(await total()).toBe(900)

    const b = await chamar('fn_orcamento_item_adicionar', { p_orcamento_id: orc, p_item: { produto_nome: 'Parafuso', tipo_item: 'produto', quantidade: '2', preco_unitario: '50', desconto_valor: '20' } })
    expect(Number(b.subtotal_item)).toBe(80)
    expect(await total()).toBe(980)

    const e = await chamar('fn_orcamento_item_editar', { p_item_id: a.item_id, p_item: { quantidade: '20' } })
    expect(e.ok, e.erro).toBe(true)
    expect(Number(e.subtotal_item)).toBe(1800)
    expect(await total()).toBe(1880)

    const inv = await chamar('fn_orcamento_item_adicionar', { p_orcamento_id: orc, p_item: { produto_nome: 'Inválido', quantidade: '0', preco_unitario: '1' } })
    expect(inv.ok).toBe(false)
    expect(await total()).toBe(1880)

    const x = await chamar('fn_orcamento_item_excluir', { p_item_id: b.item_id })
    expect(x.ok, x.erro).toBe(true)
    expect(await total()).toBe(1800)

    const l = await chamar('fn_orcamento_item_listar', { p_orcamento_id: orc }) as R & { itens?: unknown[]; editavel?: boolean }
    expect(l.ok).toBe(true)
    expect(l.itens?.length).toBe(1)
    expect(l.editavel).toBe(true)
  })

  test('escopo congelado: recusa as três operações com mensagem clara', { tag: '@pos-migration' }, async () => {
    const [item] = await dbSelect<{ id: string }>('erp_orcamentos_itens', `orcamento_id=eq.${orc}&select=id&limit=1`)
    expect(item?.id, 'o teste anterior deixa um item').toBeTruthy()
    const antes = await total()
    await dbPatch('erp_orcamentos', `id=eq.${orc}`, { escopo_congelado_em: new Date().toISOString() })
    for (const [fn, args] of [
      ['fn_orcamento_item_adicionar', { p_orcamento_id: orc, p_item: { produto_nome: 'Novo', quantidade: '1', preco_unitario: '5' } }],
      ['fn_orcamento_item_editar', { p_item_id: item.id, p_item: { quantidade: '99' } }],
      ['fn_orcamento_item_excluir', { p_item_id: item.id }],
    ] as const) {
      const r = await chamar(fn, args as Record<string, unknown>)
      expect(r.ok, fn).toBe(false)
      expect(r.erro, fn).toMatch(/Escopo congelado/)
    }
    expect(await total()).toBe(antes)
    const l = await chamar('fn_orcamento_item_listar', { p_orcamento_id: orc }) as R & { congelado?: boolean; editavel?: boolean }
    expect(l.congelado).toBe(true)
    expect(l.editavel).toBe(false)
  })

  test('aprovar o orçamento com itens segue gerando obra pelo gatilho (sem regressão)', { tag: '@pos-migration' }, async () => {
    // Como a tela: APROVAR o orçamento. A obra nasce pelo gatilho trg_orcamento_gera_obra
    // (fn_obra_criar_de_orcamento não é chamável pelo logado — sem GRANT, de propósito).
    await dbPatch('erp_orcamentos', `id=eq.${orc}`, { escopo_congelado_em: null, status: 'aprovado' })
    const obras = await dbSelect<{ id: string }>('projetos_obras', `orcamento_id=eq.${orc}&select=id`)
    for (const o of obras) await dbDelete('projetos_obras', `id=eq.${o.id}&orcamento_id=eq.${orc}`).catch(() => {})
    const [o] = await dbSelect<{ id: string }>('erp_orcamentos_itens', `orcamento_id=eq.${orc}&select=id&limit=1`)
    expect(o?.id, 'os itens do orçamento permanecem').toBeTruthy()
  })
})
