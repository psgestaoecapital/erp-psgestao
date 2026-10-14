// Canal PS 4762a526/60675777 (OK do CEO 13/10) · Dados da Empresa com endereço em campos (CEP, logradouro, número,
// complemento, bairro, cidade, UF fiscal, IBGE). Migration *_companies_endereco_campos · @pos-migration.
// Roda na demonstração Comércio (GE) e devolve o endereço vazio no fim (estado da semente).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbPatch, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
type Emp = { is_demo: boolean; uf_fiscal: string | null; cidade: string | null; codigo_ibge_municipio: string | null; numero: string | null; endereco: string | null; cidade_estado: string | null }
const COLS = 'is_demo,uf_fiscal,cidade,codigo_ibge_municipio,numero,endereco,cidade_estado'

test.describe('Dados da Empresa — endereço em campos para a NF-e', () => {
  let antes: Emp | null = null

  test.beforeAll(async () => {
    ;[antes] = await dbSelect<Emp>('companies', `id=eq.${DEMO_COMERCIO}&select=${COLS}`)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-empresa-endereco-campos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (!antes) return
    await dbPatch('companies', `id=eq.${DEMO_COMERCIO}`, {
      cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, codigo_ibge_municipio: null,
      uf_fiscal: antes.uf_fiscal, endereco: antes.endereco, cidade_estado: antes.cidade_estado,
    }).catch(() => {})
  })

  test('o banco recusa endereço incompleto e UF diferente da do município', { tag: '@pos-migration' }, async () => {
    expect(antes?.is_demo, 'só na demonstração').toBe(true)
    const semNumero = await rpcComoRobo<{ sucesso: boolean; erro?: string; faltando?: string[] }>('fn_empresa_salvar_endereco', {
      p_company_id: DEMO_COMERCIO, p_cep: '89899-000', p_logradouro: 'Rua Bertila Friedrich', p_numero: '', p_complemento: '',
      p_bairro: 'Centro', p_cidade: 'Iporã do Oeste', p_uf: 'SC', p_codigo_ibge: '',
    })
    expect(semNumero.status, semNumero.texto).toBe(200)
    expect(semNumero.corpo?.sucesso).toBe(false)
    expect(semNumero.corpo?.erro).toBe('endereco_incompleto')
    expect(semNumero.corpo?.faltando?.join(' ')).toContain('número')

    const ufTrocada = await rpcComoRobo<{ sucesso: boolean; erro?: string }>('fn_empresa_salvar_endereco', {
      p_company_id: DEMO_COMERCIO, p_cep: '89899000', p_logradouro: 'Rua Bertila Friedrich', p_numero: '47', p_complemento: '',
      p_bairro: 'Centro', p_cidade: 'Iporã do Oeste', p_uf: 'PR', p_codigo_ibge: '4207650',
    })
    expect(ufTrocada.corpo?.erro).toBe('uf_divergente')

    // nada foi gravado pelas tentativas recusadas
    const [depois] = await dbSelect<Emp>('companies', `id=eq.${DEMO_COMERCIO}&select=${COLS}`)
    expect(depois.numero).toBe(antes?.numero ?? null)
  })

  test('na tela: sem número não salva; completo grava UF fiscal, IBGE e o texto do cabeçalho', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/configuracoes/empresa')
    await aguardarConteudo(page)
    const bloco = page.getByTestId('empresa-endereco')
    await expect(bloco).toBeVisible({ timeout: 20000 })

    // CEP primeiro (a busca automática do CEP roda ao sair do campo); depois o resto, à mão
    await bloco.getByTestId('end-cep').fill('89899000')
    await bloco.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect(bloco.getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled({ timeout: 15000 })
    await bloco.getByTestId('end-logradouro').fill('Rua Bertila Friedrich')
    await bloco.getByTestId('end-bairro').fill('Centro')
    await bloco.getByTestId('end-cidade').fill('Ipora do Oeste')
    await bloco.getByTestId('end-uf').fill('SC')
    await bloco.getByTestId('end-numero').fill('')
    // sem o IBGE do CEP (serviço de CEP fora), a busca por cidade/UF resolve pela regra única do município
    const porCidade = bloco.getByRole('button', { name: /Buscar IBGE por cidade\/UF/ })
    if (await porCidade.isVisible()) await porCidade.click()
    await expect(bloco.getByTestId('end-ibge')).toHaveText('4207650', { timeout: 15000 })

    await expect(page.getByTestId('empresa-endereco-falta')).toContainText('número')
    await page.getByTestId('empresa-salvar').click()
    await expect(page.getByText(/exigem o endereço completo/)).toBeVisible()

    await bloco.getByTestId('end-numero').fill('47')
    await bloco.getByTestId('end-complemento').fill('Galpão')
    await expect(page.getByTestId('empresa-endereco-falta')).toHaveCount(0)
    await page.getByTestId('empresa-salvar').click()
    await expect(page.getByText('✅ Dados da empresa salvos.')).toBeVisible({ timeout: 20000 })

    const [d] = await dbSelect<Emp>('companies', `id=eq.${DEMO_COMERCIO}&select=${COLS}`)
    expect(d.uf_fiscal).toBe('SC')
    expect(d.codigo_ibge_municipio).toBe('4207650')
    expect(d.cidade).toBe('Iporã do Oeste')
    expect(d.numero).toBe('47')
    expect(d.cidade_estado).toBe('Iporã do Oeste/SC')
    expect(d.endereco).toBe('Rua Bertila Friedrich, 47 - Galpão, Centro, CEP 89899-000')
  })
})
