// Edição fiscal EM MASSA de produtos (CEO 29/09 · FCR com 436 produtos sem os 4 campos). Migration 20260930100000
// (@pos-migration). Prova na Demonstração Comércio (GE, Simples), como o robô, com 2 produtos de teste num NCM só
// deles: a prévia conta sem gravar; aplicar só PREENCHE o vazio (o CSOSN 500 que já existia fica), registra quem
// alterou e o antes/depois; repetir não muda nada; CST de regime normal numa empresa do Simples é recusado; sem filtro
// é recusado. E a tela: o botão abre o modal e a prévia mostra quantos mudam. Produtos de teste ficam inativos no fim
// (RD-30: nada é apagado). NUNCA roda em empresa real (conferido no beforeAll).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
// NCM de teste, exclusivo desta execução (8 dígitos que não existem na TIPI), para o filtro pegar só os 2 produtos
const NCM = `99${RUN.replace(/\D/g, '').padEnd(6, '7').slice(0, 6)}`
const VALORES = { tipo_item_sped: '00', cst_icms: '102', cst_pis: '49', cst_cofins: '49' }
const produtos: string[] = []
let token = ''

type Resp = { ok: boolean; erro?: string; aplicado?: boolean; lote_id?: string; produtos_no_filtro?: number; produtos_mudam?: number;
  campos_mudam?: number; por_campo?: Record<string, { preenche: number; substitui: number }> }

async function massa(filtro: Record<string, unknown>, valores: Record<string, string>, aplicar: boolean): Promise<Resp> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_produtos_fiscal_massa`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO, p_filtro: filtro, p_valores: valores, p_sobrescrever: false, p_aplicar: aplicar }),
  })
  if (!resp.ok) throw new Error(`fn_produtos_fiscal_massa: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as Resp
}

test.describe('Edição fiscal em massa de produtos', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean; regime_tributario: string | null }>('companies', `id=eq.${DEMO}&select=is_demo,regime_tributario`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    expect((emp?.regime_tributario ?? '').toLowerCase(), 'a demo Comércio é do Simples (CSOSN)').toContain('simples')
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const a = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-FM-${RUN}-A`, nome: `E2E fiscal massa A ${RUN}`, ncm: NCM, tipo: 'produto', ativo: true, cst_icms: '500' })
    const b = await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO, codigo: `E2E-FM-${RUN}-B`, nome: `E2E fiscal massa B ${RUN}`, ncm: NCM, tipo: 'produto', ativo: true })
    produtos.push(a.id, b.id)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-produtos-fiscal-massa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of produtos) await dbPatch('erp_produtos', `id=eq.${id}`, { ativo: false }).catch(() => {})
  })

  test('prévia conta sem gravar; aplicar só preenche o vazio, registra quem alterou; repetir não muda nada', { tag: '@pos-migration' }, async () => {
    const previa = await massa({ ncm: NCM }, VALORES, false)
    expect(previa.ok).toBe(true)
    expect(previa.produtos_no_filtro, 'os 2 produtos de teste').toBe(2)
    expect(previa.produtos_mudam).toBe(2)
    expect(previa.por_campo?.cst_icms, 'o 500 que já existe não é substituído').toEqual({ preenche: 1, substitui: 0 })
    const [antes] = await dbSelect<{ cst_pis: string | null }>('erp_produtos', `id=eq.${produtos[1]}&select=cst_pis`)
    expect(antes.cst_pis, 'a prévia não grava nada').toBeNull()

    const ap = await massa({ ncm: NCM }, VALORES, true)
    expect(ap.aplicado).toBe(true)
    expect(ap.campos_mudam, 'A: 3 campos (ICMS fica) · B: 4 campos').toBe(7)
    const linhas = await dbSelect<{ id: string; tipo_item_sped: string; cst_icms: string; cst_pis: string; cst_cofins: string }>('erp_produtos',
      `id=in.(${produtos.join(',')})&select=id,tipo_item_sped,cst_icms,cst_pis,cst_cofins`)
    const A = linhas.find((l) => l.id === produtos[0])!
    const B = linhas.find((l) => l.id === produtos[1])!
    expect(A.cst_icms, 'CSOSN já preenchido fica').toBe('500')
    expect(B).toMatchObject({ tipo_item_sped: '00', cst_icms: '102', cst_pis: '49', cst_cofins: '49' })

    const [lote] = await dbSelect<{ usuario_id: string | null; usuario_email: string | null; produtos_alterados: number }>('erp_produto_fiscal_lote',
      `id=eq.${ap.lote_id}&select=usuario_id,usuario_email,produtos_alterados`)
    expect(lote.usuario_id, 'registra quem alterou').toBeTruthy()
    expect(lote.usuario_email).toBeTruthy()
    expect(lote.produtos_alterados).toBe(2)
    const alt = await dbSelect<{ campo: string; valor_antes: string | null; valor_depois: string }>('erp_produto_fiscal_alteracao',
      `lote_id=eq.${ap.lote_id}&produto_id=eq.${produtos[1]}&select=campo,valor_antes,valor_depois`)
    expect(alt, 'antes/depois de cada campo do produto B').toHaveLength(4)
    expect(alt.every((x) => x.valor_antes === null)).toBe(true)

    const de_novo = await massa({ ncm: NCM }, VALORES, false)
    expect(de_novo.produtos_mudam, 'repetir não muda nada').toBe(0)
  })

  test('regras: CST de regime normal no Simples é recusado; sem filtro é recusado', { tag: '@pos-migration' }, async () => {
    const cst = await massa({ ncm: NCM }, { cst_icms: '00' }, false)
    expect(cst.ok).toBe(false)
    expect(cst.erro).toBe('valor_invalido')
    const semFiltro = await massa({}, { cst_pis: '49' }, false)
    expect(semFiltro.erro).toBe('sem_filtro')
  })

  test('tela Produtos: "Edição fiscal em massa" abre, e a prévia mostra quantos mudam', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/cadastros/produtos')
    await aguardarConteudo(page)
    await page.getByTestId('fiscal-massa-abrir').click()
    const modal = page.getByTestId('fiscal-massa-modal')
    await expect(modal).toBeVisible()
    await modal.getByTestId('fm-filtro-prefixo').fill(NCM)
    await modal.getByTestId('fm-filtro-sem').selectOption('')
    await modal.getByTestId('fm-valor-cst_icms').selectOption('900')
    await modal.getByTestId('fm-sobrescrever').check()
    await modal.getByTestId('fm-previa').click()
    // com "substituir", os 2 produtos de teste mudam para 900 (só prévia — o teste NÃO aplica)
    await expect(modal.getByTestId('fm-previa-mudam')).toHaveText('2', { timeout: 20000 })
    await expect(modal.getByTestId('fm-aplicar')).toContainText('Aplicar em 2 produto(s)')
  })
})
