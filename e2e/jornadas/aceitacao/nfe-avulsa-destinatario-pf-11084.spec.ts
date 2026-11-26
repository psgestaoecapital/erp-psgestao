// Chamado #11084 — Emitir NF-e avulsa: a busca do destinatário acha pessoa física (razão social vazia, nome só em
// nome_fantasia), cliente e fornecedor, pela função canônica no servidor. Migration 20261126110030 (fn_fornecedor_buscar,
// @pos-migration). Prova na Demonstração Comércio (GE) com 1 cliente PF e 1 fornecedor PF de teste, sem razão social.
// Os cadastros de teste ficam inativos no fim (RD-30: nada é apagado). NUNCA roda em empresa real.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const NOME_CLI = `Zzpf Cliente ${RUN}`
const NOME_FORN = `Zzpf Fornecedor ${RUN}`
const ids: { cli?: string; forn?: string } = {}
let token = ''

type Busca = { ok: boolean; resultados: Array<{ cliente_id?: string; fornecedor_id?: string; nome: string }> }
async function buscar(fn: string, termo: string): Promise<Busca> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO, p_termo: termo, p_limit: 20 }),
  })
  if (!resp.ok) throw new Error(`${fn}: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as Busca
}

test.describe('NF-e avulsa · busca de destinatário (pessoa física)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    // pessoa física como na 163: razão social NULL, nome em nome_fantasia, documento só em cnpj_cpf
    const c = await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO, nome_fantasia: NOME_CLI, razao_social: null, cnpj_cpf: '52998224725', ativo: true })
    const f = await dbInsert<{ id: string }>('erp_fornecedores', { company_id: DEMO, nome_fantasia: NOME_FORN, razao_social: null, cpf_cnpj: '11144477735', ativo: true })
    ids.cli = c.id; ids.forn = f.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfe-avulsa-destinatario-pf', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (ids.cli) await dbPatch('erp_clientes', `id=eq.${ids.cli}`, { ativo: false }).catch(() => {})
    if (ids.forn) await dbPatch('erp_fornecedores', `id=eq.${ids.forn}`, { ativo: false }).catch(() => {})
  })

  test('função canônica acha PF por nome e por CPF (cliente e fornecedor)', { tag: '@pos-migration' }, async () => {
    const porNome = await buscar('fn_cliente_buscar', NOME_CLI)
    expect(porNome.resultados.map((r) => r.cliente_id)).toContain(ids.cli)
    const porCpf = await buscar('fn_cliente_buscar', '529.982.247-25')
    expect(porCpf.resultados.map((r) => r.cliente_id)).toContain(ids.cli)
    const fNome = await buscar('fn_fornecedor_buscar', NOME_FORN)
    expect(fNome.resultados.map((r) => r.fornecedor_id)).toContain(ids.forn)
    const fCpf = await buscar('fn_fornecedor_buscar', '111.444.777-35')
    expect(fCpf.resultados.map((r) => r.fornecedor_id), 'documento só em cpf_cnpj também é achado').toContain(ids.forn)
  })

  test('tela Emitir NF-e avulsa: digitar o nome da pessoa física mostra o cadastro', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/fiscal/nfe/remessa')
    await aguardarConteudo(page)
    const campo = page.getByTestId('nfe-avulsa-destinatario')
    await campo.click()
    await campo.fill(NOME_CLI)
    const opcao = page.getByTestId('nfe-avulsa-destinatario-opcao').filter({ hasText: NOME_CLI })
    await expect(opcao).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Nenhum cadastro encontrado.')).toHaveCount(0)
  })
})
