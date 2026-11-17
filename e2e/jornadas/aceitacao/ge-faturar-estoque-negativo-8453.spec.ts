// GE · Chamado #8453 — Faturar com estoque negativo: config por empresa (bloquear/avisar/liberar).
// Migration 20261118180035 · @pos-migration. Code: code-desenvolvedor-3.
//
// Prova os 3 modos COMO O USUÁRIO (as mesmas RPCs da tela: fn_empresa_salvar_estoque_negativo + fn_faturar),
// na "Comércio (GE) - DEMO" (robô só em demonstração). Para cada modo o teste cria o próprio produto
// (estoque 2) e um pedido de 1 item (quantidade 5 → saldo resultante -3) e confere:
//   bloquear → a RPC falha (erro claro "Estoque insuficiente"); NENHUMA baixa gravada (estoque segue 2,
//              pedido NÃO faturado);
//   avisar   → fatura e devolve avisos com o item negativo (saldo_depois -3); estoque vai a -3; faturado;
//   liberar  → fatura em silêncio (avisos vazio); estoque vai a -3; faturado.
// Limpeza no fim: apaga só o que criou (receber/movimentações/itens/pedido/produto) e volta a regra para 'avisar'.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpcComoRobo, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)

type Prod = { id: string; estoque_atual: number }
type Ped = { id: string; status: string }
type FatOk = { ok?: boolean; estoque_negativo_modo?: string; avisos?: Array<{ produto?: string | null; saldo_depois?: number }> }

const criados: { produtos: string[]; pedidos: string[] } = { produtos: [], pedidos: [] }

async function criarCenario(sufixo: string): Promise<{ produto: string; pedido: string }> {
  const prod = await dbInsert<{ id: string }>('erp_produtos', {
    company_id: DEMO_GE, codigo: `E2E-8453-${RUN}-${sufixo}`, nome: `Produto estoque negativo ${RUN}-${sufixo}`,
    estoque_atual: 2, preco_custo: 10, ativo: true,
  })
  criados.produtos.push(prod.id)
  const ped = await dbInsert<{ id: string }>('erp_pedidos', {
    company_id: DEMO_GE, numero: `E2E8453${RUN}${sufixo}`.slice(0, 20), cliente_nome: `Cliente E2E ${RUN}`,
    status: 'aberto', total: 50, titulos_gerados: false,
  })
  criados.pedidos.push(ped.id)
  await dbInsert('erp_pedidos_itens', {
    pedido_id: ped.id, company_id: DEMO_GE, tipo_item: 'produto', produto_id: prod.id,
    produto_nome: `Produto estoque negativo ${RUN}-${sufixo}`, quantidade: 5, ordem: 1,
  })
  return { produto: prod.id, pedido: ped.id }
}

const estoqueDe = async (id: string) => (await dbSelect<Prod>('erp_produtos', `id=eq.${id}&select=id,estoque_atual`))[0]?.estoque_atual
const statusDe = async (id: string) => (await dbSelect<Ped>('erp_pedidos', `id=eq.${id}&select=id,status`))[0]?.status
const setModo = (modo: string) => rpcComoRobo('fn_empresa_salvar_estoque_negativo', { p_company_id: DEMO_GE, p_modo: modo })

test.describe('GE — faturar com estoque negativo (config por empresa) #8453', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
    // confirma que o robô tem acesso à empresa (a tela grava por RPC company-scoped)
    const r = await setModo('avisar')
    expect(r.corpo, `robô precisa ter acesso à GE DEMO (resp: ${r.texto})`).toMatchObject({ sucesso: true })
  })

  test.afterAll(async () => {
    try {
      for (const ped of criados.pedidos) {
        // erp_receber tem a trava RD-30 (trg_bloqueia_delete_fisico): documento financeiro não se apaga
        // por DELETE físico. Limpeza do título gerado no faturamento é por SOFT-DELETE (deleted_at), igual
        // ao purgarReceberDemo. Não há FK de erp_receber→erp_pedidos, então o pedido é apagado logo abaixo.
        await dbPatch('erp_receber', `pedido_id=eq.${ped}&deleted_at=is.null`, { deleted_at: new Date().toISOString() })
        await dbDelete('erp_estoque_movimentacoes', `ref_id=eq.${ped}`)
        await dbDelete('erp_pedidos_itens', `pedido_id=eq.${ped}`)
        await dbDelete('erp_pedidos', `id=eq.${ped}`)
      }
      for (const p of criados.produtos) await dbDelete('erp_produtos', `id=eq.${p}`)
      await setModo('avisar') // volta ao padrão para não deixar a DEMO em outro modo
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  test('bloquear: a RPC falha com erro claro e NÃO grava baixa nenhuma', { tag: '@pos-migration' }, async () => {
    const { produto, pedido } = await criarCenario('bl')
    expect((await setModo('bloquear')).corpo).toMatchObject({ sucesso: true })
    const r = await rpcComoRobo('fn_faturar', { p_pedido_id: pedido })
    expect(r.status, `bloquear deve falhar (resp: ${r.texto})`).toBeGreaterThanOrEqual(400)
    expect(r.texto).toContain('Estoque insuficiente')
    // nenhuma baixa: estoque intacto, pedido não faturado, sem movimentação
    expect(await estoqueDe(produto)).toBe(2)
    expect(await statusDe(pedido)).toBe('aberto')
    const movs = await dbSelect('erp_estoque_movimentacoes', `ref_id=eq.${pedido}&select=id`)
    expect(movs.length).toBe(0)
  })

  test('avisar (padrão): fatura e devolve o item que ficou negativo', { tag: '@pos-migration' }, async () => {
    const { produto, pedido } = await criarCenario('av')
    expect((await setModo('avisar')).corpo).toMatchObject({ sucesso: true })
    const r = await rpcComoRobo<FatOk>('fn_faturar', { p_pedido_id: pedido })
    expect(r.status, `avisar deve faturar (resp: ${r.texto})`).toBe(200)
    expect(r.corpo?.ok).toBe(true)
    expect(r.corpo?.estoque_negativo_modo).toBe('avisar')
    const avisos = r.corpo?.avisos ?? []
    expect(avisos.length, 'deve listar o item negativo').toBe(1)
    expect(Number(avisos[0]?.saldo_depois)).toBe(-3)
    expect(await estoqueDe(produto)).toBe(-3)
    expect(await statusDe(pedido)).toBe('faturado')
  })

  test('liberar: fatura em silêncio (sem avisos)', { tag: '@pos-migration' }, async () => {
    const { produto, pedido } = await criarCenario('li')
    expect((await setModo('liberar')).corpo).toMatchObject({ sucesso: true })
    const r = await rpcComoRobo<FatOk>('fn_faturar', { p_pedido_id: pedido })
    expect(r.status, `liberar deve faturar (resp: ${r.texto})`).toBe(200)
    expect(r.corpo?.ok).toBe(true)
    expect(r.corpo?.estoque_negativo_modo).toBe('liberar')
    expect((r.corpo?.avisos ?? []).length, 'liberar não devolve avisos').toBe(0)
    expect(await estoqueDe(produto)).toBe(-3)
    expect(await statusDe(pedido)).toBe('faturado')
  })
})
