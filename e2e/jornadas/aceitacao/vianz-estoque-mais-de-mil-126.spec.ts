// #126 (Vianz Performance Diesel) · "Importei uma planilha com 1485 itens, porém na tela de Estoque & Curva ABC só
// aparecem 1000." Causa: a tela pedia .limit(5000), mas o PostgREST do Supabase devolve no máximo 1000 linhas por
// requisição — o resto sumia sem aviso (saldo, KPIs e contagem da aba). Agora busca em páginas (selecionarTodas).
// Só front — roda no preview da PR. Demonstração Comércio (GE): cria 1001 produtos de teste e apaga no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsertMany, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const PREFIXO = `T126-${RUN}`
const EXTRA = 1001

test.describe('Estoque — mais de 1000 produtos aparecem todos (#126)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-estoque-mais-de-mil-126', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    await dbDelete('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=like.${encodeURIComponent(PREFIXO)}*`)
  })

  test('com 1000+ produtos ativos, a aba Produtos e o Saldo mostram TODOS', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a jornada só roda na empresa de demonstração').toBe(true)

    const linhas = Array.from({ length: EXTRA }, (_, i) => ({
      company_id: DEMO_COMERCIO, codigo: `${PREFIXO}-${String(i).padStart(4, '0')}`,
      nome: `Produto teste 126 ${String(i).padStart(4, '0')}`, ativo: true, estoque_atual: 1, preco_custo: 1,
    }))
    for (let i = 0; i < linhas.length; i += 500) await dbInsertMany('erp_produtos', linhas.slice(i, i + 500))

    // Verdade no banco: quantos ativos a demo tem agora (os 1001 + os da demo).
    let total = 0
    for (let de = 0; ; de += 1000) {
      const lote = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&ativo=eq.true&select=id&order=id&offset=${de}&limit=1000`)
      total += lote.length
      if (lote.length < 1000) break
    }
    expect(total, 'a demo ficou com mais de 1000 ativos').toBeGreaterThan(1000)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/commerce/estoque')
    await aguardarConteudo(page)

    await expect(page.getByTestId('estoque-tab-produtos-count')).toHaveText(String(total), { timeout: 30000 })
    await expect(page.getByTestId('estoque-tab-saldo-count')).toHaveText(String(total), { timeout: 30000 })
  })
})
