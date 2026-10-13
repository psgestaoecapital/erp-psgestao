// #43 (Estância Umuarama) · "Quando cadastro o fornecedor direto na aba de lançamentos não fica salvo para um
// novo lançamento futuro." A tela Nova despesa dizia que cadastrava o fornecedor digitado, mas só gravava o nome
// no título. Agora, ao salvar, o fornecedor digitado vira cadastro (ou reusa o que já existe com o mesmo nome) e a
// despesa nasce vinculada a ele. Migration 20260927140000 · @pos-migration: veredito no aceitacao-pos-migration.yml.
// Demonstração Comércio (GE), nunca empresa real. Despesa e fornecedor de teste desativados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const FORNECEDOR = `Fornecedor 43 ${RUN}`
const DESCRICAO = `Despesa 43 ${RUN}`

test.describe('Nova despesa — fornecedor digitado fica cadastrado (#43)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fornecedor-inline-43', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    await dbPatch('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}`, { deleted_at: new Date().toISOString() })
    await dbPatch('erp_fornecedores', `company_id=eq.${DEMO_COMERCIO}&nome_fantasia=eq.${encodeURIComponent(FORNECEDOR)}`, { ativo: false })
  })

  test('digitar um fornecedor novo, salvar e ele aparece na lista do próximo lançamento @pos-migration', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/financeiro/nova-despesa')
    await aguardarConteudo(page)

    await page.getByTestId('despesa-fornecedor-select').selectOption('')
    await page.getByTestId('despesa-fornecedor-nome').fill(FORNECEDOR)
    await page.getByTestId('despesa-valor').fill('123.45')
    await page.getByPlaceholder('ex: "Aluguel sala maio" · vazio = geramos automático').fill(DESCRICAO)
    await page.getByRole('button', { name: 'Salvar despesa' }).click()

    // Banco: o fornecedor existe no cadastro e a despesa está vinculada a ele (não só o nome).
    await expect.poll(async () => (await dbSelect('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}&select=id`)).length,
      { timeout: 20000 }).toBe(1)
    const [forn] = await dbSelect<{ id: string; ativo: boolean }>('erp_fornecedores', `company_id=eq.${DEMO_COMERCIO}&nome_fantasia=eq.${encodeURIComponent(FORNECEDOR)}&select=id,ativo`)
    expect(forn, 'o fornecedor digitado ficou no cadastro').toBeTruthy()
    expect(forn.ativo).toBe(true)
    const [desp] = await dbSelect<{ fornecedor_id: string | null; fornecedor_nome: string | null; valor: number }>('erp_pagar',
      `company_id=eq.${DEMO_COMERCIO}&descricao=eq.${encodeURIComponent(DESCRICAO)}&select=fornecedor_id,fornecedor_nome,valor`)
    expect(desp.fornecedor_id, 'a despesa nasce vinculada ao cadastro').toBe(forn.id)
    expect(desp.fornecedor_nome).toBe(FORNECEDOR)
    expect(Number(desp.valor)).toBe(123.45)

    // Próximo lançamento: o fornecedor aparece na lista para escolher.
    await page.goto('/dashboard/financeiro/nova-despesa')
    await aguardarConteudo(page)
    await expect(page.getByTestId('despesa-fornecedor-select').locator('option', { hasText: FORNECEDOR })).toHaveCount(1, { timeout: 20000 })

    // Digitar o MESMO nome de novo (outra caixa/acento) reusa o cadastro — não duplica.
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
    const r = await fetch(`${url}/rest/v1/rpc/fn_fornecedor_criar_inline`, { method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO_COMERCIO, p_nome: `  ${FORNECEDOR.toUpperCase()} `, p_cpf_cnpj: null }) })
    expect(r.ok).toBe(true)
    expect(await r.json(), 'mesmo nome → mesmo cadastro').toBe(forn.id)
    expect((await dbSelect('erp_fornecedores', `company_id=eq.${DEMO_COMERCIO}&nome_fantasia=ilike.${encodeURIComponent(FORNECEDOR)}&select=id`)).length).toBe(1)
  })
})
