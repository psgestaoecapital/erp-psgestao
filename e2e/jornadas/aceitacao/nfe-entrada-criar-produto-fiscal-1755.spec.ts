// #1755 (Gean) · "Criar produto" a partir do item da NF de entrada não levava os dados fiscais da nota.
// Em 07/10, na Gean: 149 produtos criados de item de NF; os 141 itens com CEST na nota ficaram SEM CEST no cadastro,
// 89 de origem estrangeira viraram origem 0, e nenhum ficou com CFOP/unidade de compra.
// Migration 20261007120020 · @pos-migration. Na demonstração Comércio (GE): o teste cria uma NF recebida de mentira
// com 2 itens, chama a MESMA RPC do botão "Criar produto" COMO O ROBÔ e confere o cadastro que nasceu.
// Limpeza: os produtos ficam inativos e a NF de teste é apagada (só a que o próprio teste criou).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()

type Produto = {
  id: string; codigo: string; nome: string; unidade: string; ncm: string | null; cest: string | null; origem: string | null
  cfop_compra: string | null; unidade_compra: string | null; codigo_barras: string | null; preco_custo: number | null
}

test.describe('NF de entrada — produto criado do item leva os dados fiscais da nota (#1755)', () => {
  let token = ''
  let nfeId = ''
  const produtos: string[] = []

  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }
  const produto = async (id: string) => (await dbSelect<Produto>('erp_produtos',
    `id=eq.${id}&select=id,codigo,nome,unidade,ncm,cest,origem,cfop_compra,unidade_compra,codigo_barras,preco_custo`))[0]

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    // chave fictícia de 44 dígitos, única por execução; sem CNPJ do emitente (não grava de-para de fornecedor)
    const chave = `4226${Date.now()}`.padEnd(44, '9').slice(0, 44)
    nfeId = (await dbInsert<{ id: string }>('erp_nfe_recebidas', { company_id: DEMO_COMERCIO, chave_acesso: chave })).id
  })

  test.afterAll(async () => {
    for (const id of produtos) await dbPatch('erp_produtos', `id=eq.${id}&company_id=eq.${DEMO_COMERCIO}`, { ativo: false }).catch(() => {})
    if (nfeId) {
      await dbDelete('erp_nfe_recebidas_itens', `nfe_recebida_id=eq.${nfeId}&company_id=eq.${DEMO_COMERCIO}`).catch(() => {})
      await dbDelete('erp_nfe_recebidas', `id=eq.${nfeId}&company_id=eq.${DEMO_COMERCIO}`).catch(() => {})
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfe-criar-produto-fiscal-1755', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('CEST, origem, CFOP e unidade de compra vêm da nota; origem 1 vira 2 e 6 vira 7', { tag: '@pos-migration' }, async () => {
    const casos = [
      // óleo importado comprado de distribuidor nacional: origem 1 na nota do fornecedor → 2 no nosso cadastro
      { numero_item: 1, codigo_produto: `T1755A${RUN}`, descricao: `Óleo 5W30 teste ${RUN}`, ncm: '27101932', cest: '06.006.00',
        origem: '1', cfop: '5102', cfop_entrada: '1102', unidade: 'LT', codigo_barras: '7891234567895', valor_unitario: 42.5,
        espera: { cest: '0600600', origem: '2', cfop_compra: '1102', unidade: 'LT' } },
      // peça com ST de origem 6 (importação direta sem similar) → 7 no nosso cadastro; CFOP de entrada 1403
      { numero_item: 2, codigo_produto: `T1755B${RUN}`, descricao: `Filtro de ar teste ${RUN}`, ncm: '84213100', cest: '0100100',
        origem: '6', cfop: '5405', cfop_entrada: '1403', unidade: 'PC', codigo_barras: null, valor_unitario: 18,
        espera: { cest: '0100100', origem: '7', cfop_compra: '1403', unidade: 'PC' } },
    ]
    for (const c of casos) {
      const { espera, ...item } = c
      const it = await dbInsert<{ id: string }>('erp_nfe_recebidas_itens', {
        ...item, nfe_recebida_id: nfeId, company_id: DEMO_COMERCIO, quantidade: 1, valor_total: item.valor_unitario,
      })
      const r = await rpcRobo<{ ok: boolean; erro?: string; produto_id?: string }>('fn_nfe_item_criar_produto', { p_item_id: it.id, p_dados: null })
      expect(r.ok, `criar produto do item ${c.numero_item}: ${JSON.stringify(r)}`).toBe(true)
      produtos.push(r.produto_id!)

      const p = await produto(r.produto_id!)
      expect(p.codigo).toBe(c.codigo_produto)
      expect(p.nome).toBe(c.descricao)
      expect(p.ncm).toBe(c.ncm)
      expect(p.cest, 'CEST da nota no cadastro').toBe(espera.cest)
      expect(p.origem, 'origem da mercadoria').toBe(espera.origem)
      expect(p.cfop_compra, 'CFOP de compra = CFOP de entrada do item').toBe(espera.cfop_compra)
      expect(p.unidade).toBe(espera.unidade)
      expect(p.unidade_compra).toBe(espera.unidade)
      expect(Number(p.preco_custo)).toBe(c.valor_unitario)
      if (c.codigo_barras) expect(p.codigo_barras).toBe(c.codigo_barras)

      const [vinc] = await dbSelect<{ produto_id: string }>('erp_nfe_recebidas_itens', `id=eq.${it.id}&select=produto_id`)
      expect(vinc.produto_id, 'item já vinculado ao produto novo').toBe(r.produto_id)
    }
  })
})
