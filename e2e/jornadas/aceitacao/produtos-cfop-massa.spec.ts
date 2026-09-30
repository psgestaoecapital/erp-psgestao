// CFOP de venda na edição fiscal em massa — PARTE A, sem trava na emissão (CEO 01/10: separar a #1937 → CFOP sem trava →
// preencher → #1936 → trava do CFOP). Migration 20261001130000 (@pos-migration): coluna cfop_venda_interestadual; a
// edição em massa preenche CFOP dentro (5xxx) e fora (6xxx) do estado, com o filtro "CSOSN/CST do ICMS igual a"
// (ex.: 500 → 5405/6404). Prova na Demonstração Comércio (GE, Simples), como o robô, com 2 produtos de teste num NCM só
// deles. Produtos de teste ficam inativos no fim (RD-30). NUNCA roda em empresa real.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const NCM = `98${RUN.replace(/\D/g, '').padEnd(6, '3').slice(0, 6)}`
const MARCA = `E2E CFOP ${RUN} — provisório, confirmar com o contador`
const produtos: string[] = []
let token = ''

type Resp = { ok: boolean; erro?: string; aplicado?: boolean; produtos_no_filtro?: number; produtos_mudam?: number;
  por_campo?: Record<string, { preenche: number; substitui: number }> }

async function massa(filtro: Record<string, unknown>, valores: Record<string, string>, aplicar: boolean): Promise<Resp> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_produtos_fiscal_massa`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO, p_filtro: filtro, p_valores: valores, p_sobrescrever: false, p_aplicar: aplicar, p_observacao: aplicar ? MARCA : null }),
  })
  if (!resp.ok) throw new Error(`fn_produtos_fiscal_massa: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as Resp
}

test.describe('CFOP na edição fiscal em massa (sem trava)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const st = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-CF-${RUN}-ST`, nome: `E2E CFOP com ST ${RUN}`, ncm: NCM, tipo: 'produto', ativo: true, cst_icms: '500' })
    const nor = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-CF-${RUN}-N`, nome: `E2E CFOP sem ST ${RUN}`, ncm: NCM, tipo: 'produto', ativo: true, cst_icms: '102' })
    produtos.push(st.id, nor.id)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-produtos-cfop-massa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of produtos) await dbPatch('erp_produtos', `id=eq.${id}`, { ativo: false }).catch(() => {})
  })

  test('CSOSN 500 → 5405/6404 e o resto → 5102/6102, só preenchendo o vazio', { tag: '@pos-migration' }, async () => {
    const pSt = await massa({ ncm: NCM, icms_igual: '500' }, { cfop_venda: '5405', cfop_venda_interestadual: '6404' }, false)
    expect(pSt.ok, JSON.stringify(pSt)).toBe(true)
    expect(pSt.produtos_no_filtro, 'filtro "CSOSN igual a 500" pega só o produto com ST').toBe(1)
    const [antes] = await dbSelect<{ cfop_venda: string | null }>('erp_produtos', `id=eq.${produtos[0]}&select=cfop_venda`)
    expect(antes.cfop_venda, 'prévia não grava').toBeNull()

    expect((await massa({ ncm: NCM, icms_igual: '500' }, { cfop_venda: '5405', cfop_venda_interestadual: '6404' }, true)).aplicado).toBe(true)
    const pN = await massa({ ncm: NCM, sem_campo: 'cfop_venda' }, { cfop_venda: '5102', cfop_venda_interestadual: '6102' }, false)
    expect(pN.produtos_mudam, 'depois do passo 1, só o produto sem ST continua sem CFOP').toBe(1)
    expect((await massa({ ncm: NCM, sem_campo: 'cfop_venda' }, { cfop_venda: '5102', cfop_venda_interestadual: '6102' }, true)).aplicado).toBe(true)

    const linhas = await dbSelect<{ id: string; cfop_venda: string; cfop_venda_interestadual: string; fiscal_observacao: string | null }>('erp_produtos',
      `id=in.(${produtos.join(',')})&select=id,cfop_venda,cfop_venda_interestadual,fiscal_observacao`)
    expect(linhas.find((l) => l.id === produtos[0])).toMatchObject({ cfop_venda: '5405', cfop_venda_interestadual: '6404', fiscal_observacao: MARCA })
    expect(linhas.find((l) => l.id === produtos[1])).toMatchObject({ cfop_venda: '5102', cfop_venda_interestadual: '6102', fiscal_observacao: MARCA })
    expect((await massa({ ncm: NCM }, { cfop_venda: '5102', cfop_venda_interestadual: '6102' }, false)).produtos_mudam, 'repetir não muda nada').toBe(0)
  })

  test('CFOP no grupo errado é recusado (dentro = 5xxx, fora = 6xxx)', { tag: '@pos-migration' }, async () => {
    expect((await massa({ ncm: NCM }, { cfop_venda: '6102' }, false)).erro).toBe('valor_invalido')
    expect((await massa({ ncm: NCM }, { cfop_venda_interestadual: '5102' }, false)).erro).toBe('valor_invalido')
  })
})
