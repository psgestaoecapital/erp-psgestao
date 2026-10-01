// Chamado #573 (KGF · Gean/Jordana, 30/09): na conferência da nota recebida já existe o fator de conversão, mas faltava
// escolher a unidade (litro, metro, pacote…) — e o campo do fator sempre voltava para 1, mesmo com o fator aprendido.
// Sem migration: roda no preview. Prova pela sessão do robô, nos MESMOS caminhos que a tela usa, na Demonstração
// Comércio (GE), com um produto de teste (fica inativo no fim — RD-30):
//  1) o fator aprendido deste fornecedor volta para a tela (leitura de erp_produto_depara_fornecedor);
//  2) escolher a unidade grava no cadastro do produto (erp_produtos.unidade) — só da própria empresa.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, obterSessionPayload, registrarJornada } from '../../support/api'
import { UNIDADES_ESTOQUE } from '../../../src/lib/produtos/unidades'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const CNPJ = '11222333000181'
let token = ''
let produtoId = ''

async function rest(metodo: 'GET' | 'PATCH', caminho: string, corpo?: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
}

test.describe('Recebimento fiscal: unidade de estoque ao lado do fator (#573)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const p = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO_GE, codigo: `E2E-UN-${RUN}`, nome: `E2E óleo granel ${RUN}`, unidade: 'UN', tipo: 'produto', ativo: true, preco_venda: 1 })
    produtoId = p.id
    await dbInsert('erp_produto_depara_fornecedor', { company_id: DEMO_GE, fornecedor_cnpj: CNPJ, codigo_fornecedor: `E2E-F-${RUN}`, produto_id: produtoId, unidade_fornecedor: 'CX', fator_conversao: 12 })
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-kgf-nfe-unidade-573', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (produtoId) await dbPatch('erp_produtos', `id=eq.${produtoId}`, { ativo: false }).catch(() => {})
  })

  test('o fator aprendido volta e a unidade (litro) grava no produto', async () => {
    expect(UNIDADES_ESTOQUE.map((u) => u.v), 'litro, metro e pacote na lista').toEqual(expect.arrayContaining(['LT', 'M', 'PCT']))

    const f = await rest('GET', `erp_produto_depara_fornecedor?company_id=eq.${DEMO_GE}&produto_id=eq.${produtoId}&select=produto_id,fator_conversao,fornecedor_cnpj`)
    expect(f.status).toBe(200)
    const linhas = f.corpo as { fator_conversao: number; fornecedor_cnpj: string }[]
    expect(linhas.find((l) => l.fornecedor_cnpj.replace(/\D/g, '') === CNPJ)?.fator_conversao, 'fator aprendido aparece (não volta para 1)').toBe(12)

    const u = await rest('PATCH', `erp_produtos?id=eq.${produtoId}&company_id=eq.${DEMO_GE}`, { unidade: 'LT' })
    expect(u.status, JSON.stringify(u.corpo)).toBe(200)
    const [p] = await dbSelect<{ unidade: string }>('erp_produtos', `id=eq.${produtoId}&select=unidade`)
    expect(p.unidade).toBe('LT')
  })
})
