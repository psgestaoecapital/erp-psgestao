// Chamado #11065 — Edição fiscal em massa / Padrão fiscal por NCM em LOTES (migration 20261125160030, @pos-migration).
// Prova na Demonstração Comércio (GE, Simples) com 3 produtos de teste num NCM só deles: o pedido em lotes cria a fila e o
// lote de auditoria; cada passo processa um lote e commita; o resultado e o antes/depois ficam gravados; reexecutar não
// altera nada (nem cria lote); o filtro do Padrão por NCM respeita o padrão mais específico. Produtos de teste ficam
// inativos no fim (RD-30). NUNCA roda em empresa real (conferido no beforeAll).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const SUF = (Date.now() % 100_000).toString().padStart(5, '0')
const NCM_A = `98${SUF}1`   // 2 produtos (um com ICMS já preenchido)
const NCM_B = `98${SUF}2`   // 1 produto, tem padrão próprio mais específico
const PREFIXO = `98${SUF}`
const VALORES = { tipo_item_sped: '00', cst_icms: '102', cst_pis: '49', cst_cofins: '49', cfop_venda: '5102', cfop_venda_interestadual: '6102' }
const produtos: string[] = []
const padroes: string[] = []
let token = ''

type Job = { id: string; lote_id: string; status: string; total_alvo: number; processados: number; produtos_alterados: number; campos_alterados: number; percentual: number }

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`${fn}: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as T
}

test.describe('Edição fiscal em massa em lotes', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const a = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-LT-${RUN}-A`, nome: `E2E lotes A ${RUN}`, ncm: NCM_A, tipo: 'produto', ativo: true, cst_icms: '500' })
    const b = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-LT-${RUN}-B`, nome: `E2E lotes B ${RUN}`, ncm: NCM_A, tipo: 'produto', ativo: true })
    const c = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-LT-${RUN}-C`, nome: `E2E lotes C ${RUN}`, ncm: NCM_B, tipo: 'produto', ativo: true })
    produtos.push(a.id, b.id, c.id)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-produtos-fiscal-massa-lotes', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of produtos) await dbPatch('erp_produtos', `id=eq.${id}`, { ativo: false }).catch(() => {})
    // os 2 padrões de teste (linhas de configuração criadas aqui, NCM exclusivo desta execução)
    for (const id of padroes) await dbDelete('erp_padrao_fiscal_ncm', `id=eq.${id}`).catch(() => {})
  })

  test('em lotes: cria a fila, processa lote a lote, grava antes/depois; reexecutar não altera nada', { tag: '@pos-migration' }, async () => {
    // o filtro por prefixo pega os 3 produtos; escolho só o NCM_A (2 produtos) para o teste
    const criado = await rpc<{ ok: boolean; job_id?: string; lote_id?: string; total_alvo?: number; total_mudam?: number }>('fn_produtos_fiscal_job_criar',
      { p_company_id: DEMO, p_filtro: { ncm: NCM_A }, p_valores: VALORES, p_sobrescrever: false, p_observacao: `E2E lotes ${RUN}` })
    expect(criado.ok).toBe(true)
    expect(criado.total_alvo, 'os 2 produtos do NCM de teste').toBe(2)
    expect(criado.total_mudam).toBe(2)

    // enquanto há uma aplicação em andamento, outra para a mesma empresa é recusada (uma por vez)
    const outra = await rpc<{ ok: boolean; erro?: string }>('fn_produtos_fiscal_job_criar',
      { p_company_id: DEMO, p_filtro: { ncm: NCM_B }, p_valores: VALORES, p_sobrescrever: false, p_observacao: null })
    expect(outra.ok).toBe(false)
    expect(outra.erro).toBe('lote_em_andamento')

    let job: Job | null = null
    for (let i = 0; i < 20; i++) {
      const r = await rpc<{ ok: boolean; job: Job }>('fn_produtos_fiscal_job_processar', { p_job_id: criado.job_id, p_retentar: false })
      job = r.job
      if (job.status !== 'pendente' && job.status !== 'processando') break
    }
    expect(job?.status).toBe('concluido')
    expect(job?.processados).toBe(2)
    expect(job?.produtos_alterados).toBe(2)
    expect(job?.campos_alterados, 'A: 5 campos (o ICMS 500 fica) · B: 6 campos').toBe(11)
    expect(job?.percentual).toBe(100)

    const linhas = await dbSelect<{ id: string; cst_icms: string; cfop_venda: string; cfop_venda_interestadual: string; cst_pis: string }>('erp_produtos',
      `id=in.(${produtos.slice(0, 2).join(',')})&select=id,cst_icms,cfop_venda,cfop_venda_interestadual,cst_pis`)
    expect(linhas.find((l) => l.id === produtos[0])?.cst_icms, 'CSOSN já preenchido fica').toBe('500')
    expect(linhas.find((l) => l.id === produtos[1])).toMatchObject({ cst_icms: '102', cfop_venda: '5102', cfop_venda_interestadual: '6102', cst_pis: '49' })

    const alt = await dbSelect<{ campo: string; valor_antes: string | null; valor_depois: string }>('erp_produto_fiscal_alteracao',
      `lote_id=eq.${criado.lote_id}&select=campo,valor_antes,valor_depois`)
    expect(alt, 'antes/depois de cada campo gravado').toHaveLength(11)
    const [lote] = await dbSelect<{ produtos_alterados: number; campos_alterados: number }>('erp_produto_fiscal_lote', `id=eq.${criado.lote_id}&select=produtos_alterados,campos_alterados`)
    expect(lote).toEqual({ produtos_alterados: 2, campos_alterados: 11 })

    // reexecutar: nada a alterar, sem lote novo
    const de_novo = await rpc<{ ok: boolean; produtos_mudam?: number; job_id?: string }>('fn_produtos_fiscal_job_criar',
      { p_company_id: DEMO, p_filtro: { ncm: NCM_A }, p_valores: VALORES, p_sobrescrever: false, p_observacao: null })
    expect(de_novo.ok).toBe(true)
    expect(de_novo.produtos_mudam).toBe(0)
    expect(de_novo.job_id).toBeUndefined()
  })

  test('prévia só conta; Padrão fiscal por NCM pega só os produtos sem padrão mais específico', { tag: '@pos-migration' }, async () => {
    const pai = await dbInsert<{ id: string }>('erp_padrao_fiscal_ncm', { company_id: DEMO, ncm: PREFIXO, cfop_venda: '5102' })
    const filho = await dbInsert<{ id: string }>('erp_padrao_fiscal_ncm', { company_id: DEMO, ncm: NCM_B, cfop_venda: '5405' })
    padroes.push(pai.id, filho.id)
    const prev = await rpc<{ ok: boolean; aplicado: boolean; produtos_no_filtro: number; amostra: unknown[] }>('fn_produtos_fiscal_massa',
      { p_company_id: DEMO, p_filtro: { padrao_ncm: PREFIXO }, p_valores: { cfop_venda: '5102' }, p_sobrescrever: true, p_aplicar: false, p_observacao: null })
    expect(prev.ok).toBe(true)
    expect(prev.aplicado, 'prévia não grava').toBe(false)
    expect(prev.produtos_no_filtro, 'só o NCM_A (2 produtos): o NCM_B tem padrão mais específico').toBe(2)
  })
})
