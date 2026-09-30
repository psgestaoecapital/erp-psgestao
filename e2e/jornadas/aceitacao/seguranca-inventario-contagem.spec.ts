// 🚨 Segurança (CEO 01/10): fn_inventario_registrar_contagem (SECURITY DEFINER) gravava a contagem em QUALQUER item de
// inventário pelo id. Migration 20261001120000: guarda de empresa antes de gravar, inventário fechado não aceita
// contagem, função fechada ao anon.
// Prova na Demonstração Comércio (GE), como o robô, com um inventário de teste só desta execução. A negação para
// OUTRA empresa é provada em Postgres local e no gate — aqui NÃO se tenta gravar em item de cliente real (se a guarda
// falhasse, a prova escreveria em dado de cliente).
//  1) empresa do usuário: a contagem grava (caminho principal, vale antes e depois da migration);
//  2) @pos-migration: inventário fechado recusa contagem (22023) e nada muda;
//  3) @pos-migration: anon não executa a função.
// No fim os inventários de teste ficam "cancelado" (RD-30: nada é apagado).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const inventarios: string[] = []

async function rpc(fn: string, args: Record<string, unknown>, comLogin = true) {
  const headers: Record<string, string> = { apikey: ANON_KEY, 'Content-Type': 'application/json' }
  if (comLogin) headers.Authorization = `Bearer ${(JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token}`
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) })
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as { code?: string; message?: string } }
}

async function itemDeTeste(status: 'em_andamento' | 'fechado'): Promise<string> {
  const [prod] = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO}&ativo=eq.true&select=id&limit=1`)
  expect(prod, 'a demo tem produto').toBeTruthy()
  const inv = await dbInsert<{ id: string }>('erp_inventarios', {
    company_id: DEMO, numero: `E2E${RUN}${status === 'fechado' ? 'F' : 'A'}`, status,  // numero é varchar(20) data_inicio: new Date().toISOString().slice(0, 10),
    observacoes: `E2E segurança ${RUN}`,
  })
  inventarios.push(inv.id)
  const it = await dbInsert<{ id: string }>('erp_inventario_itens', {
    inventario_id: inv.id, company_id: DEMO, produto_id: prod.id, quantidade_sistema: 10, custo_unitario: 5,
  })
  return it.id
}

test.describe('Segurança · contagem do inventário só na empresa do usuário', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-inventario-contagem', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of inventarios) await dbPatch('erp_inventarios', `id=eq.${id}`, { status: 'cancelado' }).catch(() => {})
  })

  test('empresa do usuário: a contagem grava e recalcula a diferença', async () => {
    const item = await itemDeTeste('em_andamento')
    const r = await rpc('fn_inventario_registrar_contagem', { p_item_id: item, p_quantidade_contada: 8, p_usuario: 'e2e' })
    expect(r.status, JSON.stringify(r.corpo)).toBeLessThan(300)
    const [row] = await dbSelect<{ quantidade_contada: number; diferenca: number }>('erp_inventario_itens', `id=eq.${item}&select=quantidade_contada,diferenca`)
    expect(Number(row.quantidade_contada)).toBe(8)
    expect(Number(row.diferenca)).toBe(-2)
  })

  test('inventário fechado recusa contagem e nada muda', { tag: '@pos-migration' }, async () => {
    const item = await itemDeTeste('fechado')
    const r = await rpc('fn_inventario_registrar_contagem', { p_item_id: item, p_quantidade_contada: 3, p_usuario: 'e2e' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.corpo.code, 'recusado como parâmetro inválido').toBe('22023')
    const [row] = await dbSelect<{ quantidade_contada: number | null }>('erp_inventario_itens', `id=eq.${item}&select=quantidade_contada`)
    expect(row.quantidade_contada, 'nada gravado').toBeNull()
  })

  test('anon não executa a função', { tag: '@pos-migration' }, async () => {
    const r = await rpc('fn_inventario_registrar_contagem', { p_item_id: '00000000-0000-4000-a000-0000000c0001', p_quantidade_contada: 1 }, false)
    expect(r.status, 'sem login: negado').toBeGreaterThanOrEqual(400)
    expect(r.corpo.code, 'sem permissão de execução').toBe('42501')
  })
})
