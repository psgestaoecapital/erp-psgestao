// #340 (R.R · Rodrigo) · a NFS-e de medição não abatia do escopo contratado da obra. Agora, com obra escolhida que
// tem itens de escopo, o modal pede quanto de cada item a nota mede; a soma (qtd × preço) tem de bater com o valor da
// nota, tolerância R$ 0,01, e a mensagem diz quanto falta ou sobra (decisão do CEO 29/09). A medição só é lançada com
// a nota autorizada; rejeitada não lança; cancelada estorna com o nº da nota na linha do tempo (provado em transação
// desfeita contra o banco — a demo não pode gravar NFS-e: trg_bloqueia_emissao_demo).
// Demonstração Comércio (GE): obra de teste criada e removida no fim. Nenhuma nota real — a emissão é interceptada.

import { createClient } from '@supabase/supabase-js'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const NUM_OBRA = `E2E-340-${RUN}`
let obraId = ''
let itemPav = ''
let itemMur = ''
let servicoId = ''

const sb = () => createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } })

test.describe('#340 · NFS-e de medição abate do escopo da obra', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO_GE, numero: NUM_OBRA, nome: `Obra teste 340 ${RUN}`, status: 'em_andamento',
      endereco: 'Rua Teste', numero_endereco: '100', bairro: 'Centro', cidade: 'São Miguel do Oeste', uf: 'SC', cep: '89900000', codigo_ibge_municipio: '4217204',
    })
    obraId = o.id
    itemPav = (await dbInsert<{ id: string }>('projetos_obra_item', { company_id: DEMO_GE, obra_id: obraId, ordem: 1, descricao: 'Pavimento', unidade: 'un', quantidade_contratada: 20, preco_unitario: 500000, quantidade_medida: 0 })).id
    itemMur = (await dbInsert<{ id: string }>('projetos_obra_item', { company_id: DEMO_GE, obra_id: obraId, ordem: 2, descricao: 'Muretas', unidade: 'm', quantidade_contratada: 100, preco_unitario: 100, quantidade_medida: 0 })).id
    servicoId = (await dbInsert<{ id: string }>('erp_servicos', {
      company_id: DEMO_GE, ativo: true, valor_unitario: 1000000, codigo_servico_municipio: '070201', codigo_lc116: '07.02', codigo: `O${RUN}`, descricao_resumida: `E2E 340 obra ${RUN}`,
    })).id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-340-nfse-medicao-escopo-obra', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of [itemPav, itemMur]) if (id) await dbDelete('projetos_obra_item', `id=eq.${id}`).catch(() => {})
    if (obraId) await dbDelete('projetos_obras', `id=eq.${obraId}`).catch(() => {})
    if (servicoId) await dbDelete('erp_servicos', `id=eq.${servicoId}`).catch(() => {})
  })

  test('caminho principal: a medição do escopo tem de fechar com a nota; fechando, vai junto na emissão', async ({ page }) => {
    await page.route(/\/rest\/v1\/erp_fiscal_provider_config\?.*ativo=eq\.true/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/vnd.pgrst.object+json', body: JSON.stringify({ provider: 'focusnfe', opcao_simples_nacional: 1 }) }))
    await page.route(/\/rest\/v1\/rpc\/fn_nfse_validar_emissao/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pode_emitir: true, bloqueios: [], exige_obra: true }) }))
    const envios: Record<string, unknown>[] = []
    await page.route('**/api/fiscal/nfse/emitir', async (route) => {
      envios.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'processando', nfseId: '00000000-0000-4000-a000-000000000340', providerReference: `e2e-340-${RUN}` }) })
    })
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/fiscal/nfse')
    await aguardarConteudo(page)
    await page.getByTestId('nfse-nova').click()
    const modal = page.getByTestId('nfse-emitir-modal')
    const sel = modal.getByTestId('nfse-servico-select')
    await expect(sel).toBeVisible({ timeout: 20000 })
    await sel.selectOption(servicoId)
    await modal.getByTestId('nfse-tomador-doc').fill('11222333000181')
    // valor da nota: 2 pavimentos = R$ 1.000.000,00
    await modal.getByTestId('nfse-valor').fill('1000000,00')
    await modal.getByPlaceholder('Buscar por número, nome, cidade ou endereço').fill(NUM_OBRA)
    await modal.getByRole('button', { name: new RegExp(NUM_OBRA) }).click({ timeout: 15000 })
    const escopo = modal.getByTestId('nfse-escopo-obra')
    await expect(escopo, 'a obra tem escopo: o modal pede o que esta nota mede').toBeVisible({ timeout: 15000 })
    await expect(escopo.getByTestId('nfse-escopo-aviso'), 'sem item marcado, avisa que não abate nada').toBeVisible()
    // 1 pavimento = R$ 500 mil numa nota de R$ 1 milhão → faltam R$ 500.000,00
    await escopo.getByTestId(`nfse-escopo-qtd-${itemPav}`).fill('1')
    await expect(escopo.getByTestId('nfse-escopo-erro')).toContainText('faltam R$ 500.000,00')
    await expect(modal.getByTestId('nfse-emitir-submit'), 'soma diferente da nota: não emite').toBeDisabled()
    // 2 pavimentos + 5 m de mureta → sobram R$ 500,00
    await escopo.getByTestId(`nfse-escopo-qtd-${itemPav}`).fill('2')
    await escopo.getByTestId(`nfse-escopo-qtd-${itemMur}`).fill('5')
    await expect(escopo.getByTestId('nfse-escopo-erro')).toContainText('sobram R$ 500,00')
    await expect(modal.getByTestId('nfse-emitir-submit')).toBeDisabled()
    // fecha: 2 pavimentos
    await escopo.getByTestId(`nfse-escopo-qtd-${itemMur}`).fill('')
    await expect(escopo.getByTestId('nfse-escopo-erro')).toHaveCount(0)
    await expect(escopo.getByTestId('nfse-escopo-soma')).toContainText('R$ 1.000.000,00')
    await modal.getByTestId('nfse-emitir-submit').click()
    await expect.poll(() => envios.length, { timeout: 15000 }).toBe(1)
    expect(envios[0].medicaoObra, 'a medição do escopo vai junto na emissão').toEqual({ obraId, itens: [{ item_id: itemPav, quantidade: 2 }] })
  })

  test('banco confere de novo antes de emitir: diz quanto falta ou sobra e não deixa medir além do contratado', { tag: '@pos-migration' }, async () => {
    const c = sb()
    const chama = async (itens: { item_id: string; quantidade: number }[], valor: number) =>
      (await c.rpc('fn_nfse_obra_medicao_validar', { p_company_id: DEMO_GE, p_obra_id: obraId, p_itens: itens, p_valor: valor })).data as { ok: boolean; erro?: string }
    expect((await chama([{ item_id: itemPav, quantidade: 2 }], 1000000)).ok, 'fecha → libera').toBe(true)
    expect((await chama([{ item_id: itemPav, quantidade: 2 }], 1000500)).erro).toContain('faltam R$ 500,00')
    expect((await chama([{ item_id: itemPav, quantidade: 2 }, { item_id: itemMur, quantidade: 5 }], 1000000)).erro).toContain('sobram R$ 500,00')
    expect((await chama([{ item_id: itemMur, quantidade: 3 }], 300.01)).ok, 'R$ 0,01 de diferença → tolerância').toBe(true)
    expect((await chama([{ item_id: itemPav, quantidade: 21 }], 10500000)).erro).toContain('passa do que falta medir')
    // a medição só nasce pela nota: nenhuma linha de medição para a obra de teste
    const linhas = await dbSelect<{ id: string }>('erp_nfse_obra_medicao', `obra_id=eq.${obraId}&select=id`)
    expect(linhas.length).toBe(0)
  })
})
