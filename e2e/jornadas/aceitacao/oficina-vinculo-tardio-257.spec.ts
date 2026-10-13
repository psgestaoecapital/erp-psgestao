// #257 (Gean/Jordana, CEO 28/09 — urgente p/ fechar o mês): peça digitada ("texto livre") de OS JÁ FATURADA pode ser
// ligada a um produto do estoque pela ficha da OS ("🔍 estoque"). Liga só o produto: quantidade, preço, total da OS
// e título a receber NÃO mudam; a saída de estoque da peça é registrada UMA vez. Migration 20260928234000.
// Caminho oficial: ficha da OS na Demonstração Oficina. Cada teste cria a SUA OS e o SEU produto; tudo removido no fim.
// A OS faturada é montada como fn_os_faturar (avulsa) deixa: título em erp_receber + titulos_gerados/lancamento_id.

import type { Page } from '@playwright/test'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = Date.now().toString(36)
const criadas: { os: string[]; produtos: string[]; receber: string[] } = { os: [], produtos: [], receber: [] }

async function criarProduto(sufixo: string, estoque: number): Promise<{ id: string; nome: string }> {
  const nome = `Peca teste 257 ${RUN}${sufixo}`
  const p = await dbInsert<{ id: string }>('erp_produtos', {
    company_id: DEMO_OFICINA, codigo: `T257-${RUN}${sufixo}`, nome, estoque_atual: estoque, preco_custo_medio: 20, ativo: true,
  })
  criadas.produtos.push(p.id)
  return { id: p.id, nome }
}

// OS com mão de obra 100 + peça DIGITADA 50 (total 150). faturar=true → título de 150 + OS marcada faturada.
async function criarOS(sufixo: string, faturar: boolean): Promise<{ id: string; numero: string; pecaId: string; receberId?: string }> {
  const numero = `T257-${RUN}${sufixo}`
  const id = (await dbInsert<{ id: string }>('erp_os', {
    company_id: DEMO_OFICINA, numero, descricao_servico: 'Teste vínculo tardio (#257)', status: faturar ? 'entregue' : 'pronta',
    cliente_nome: 'Cliente teste #257', placa: 'TST2E57', marca: 'Teste', modelo: 'Vinculo',
  })).id
  criadas.os.push(id)
  await dbInsert('erp_os_diagnostico_item', {
    company_id: DEMO_OFICINA, os_id: id, descricao: `Mão de obra ${RUN}`, tipo: 'servico', quantidade: 1, preco: 100, aprovado: true,
  })
  const peca = await dbInsert<{ id: string }>('erp_os_diagnostico_item', {
    company_id: DEMO_OFICINA, os_id: id, descricao: `kit bucha digitado ${RUN}`, tipo: 'peca', quantidade: 1, preco: 50, aprovado: true,
  })
  if (!faturar) return { id, numero, pecaId: peca.id }
  const [os] = await dbSelect<{ total: number }>('erp_os', `id=eq.${id}&select=total`)
  const rec = await dbInsert<{ id: string }>('erp_receber', {
    company_id: DEMO_OFICINA, cliente_nome: 'Cliente teste #257', descricao: `${numero} — teste #257`, valor: os.total,
    data_vencimento: new Date().toISOString().slice(0, 10), numero_documento: numero,
    ref_externa_id: id, ref_externa_sistema: 'oficina_os',
  })
  criadas.receber.push(rec.id)
  await dbPatch('erp_os', `id=eq.${id}`, { titulos_gerados: true, lancamento_id: rec.id })
  return { id, numero, pecaId: peca.id, receberId: rec.id }
}

async function ligarPelaFicha(page: Page, numero: string, produtoNome: string) {
  await page.addInitScript((cid) => { try { window.localStorage.setItem('ps_empresa_sel', cid) } catch { /* noop */ } }, DEMO_OFICINA)
  await page.goto('/dashboard/os')
  await aguardarConteudo(page)
  const linha = page.getByTestId('os-row').filter({ hasText: numero })
  await expect(linha).toBeVisible({ timeout: 20000 })
  await linha.getByTestId('os-editar').click()
  await expect(page.getByText('Ficha de OS')).toBeVisible({ timeout: 20000 })
  const botao = page.locator('[data-testid^="os-item-substituir-"]')
  await expect(botao, 'peça digitada mostra o "🔍 estoque"').toHaveCount(1, { timeout: 20000 })
  await botao.click()
  await page.getByPlaceholder(/Buscar peça no estoque/).fill(produtoNome)
  await page.getByRole('button', { name: new RegExp(produtoNome) }).click()
  await expect(page.getByText(/Peça (ligada|vinculada) ao estoque ✓/)).toBeVisible({ timeout: 20000 })
}

test.describe('#257 · peça digitada → produto do estoque, também com a OS faturada', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-os-vinculo-tardio-257', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const limpar = async (f: () => Promise<void>) => { await f().catch(() => {}) }
    for (const pid of criadas.produtos) await limpar(() => dbDelete('erp_estoque_movimentacoes', `produto_id=eq.${pid}`))
    for (const rid of criadas.receber) await limpar(() => dbDelete('erp_receber', `id=eq.${rid}`))
    for (const osId of criadas.os) {
      await limpar(() => dbDelete('erp_os_diagnostico_item', `os_id=eq.${osId}`))
      await limpar(() => dbDelete('erp_os', `id=eq.${osId}`))
      const resta = await dbSelect<{ id: string }>('erp_os', `id=eq.${osId}&select=id`).catch(() => [])
      if (resta.length) await limpar(() => dbPatch('erp_os', `id=eq.${osId}`, { excluida: true }))
    }
    for (const pid of criadas.produtos) {
      await limpar(() => dbDelete('erp_produtos', `id=eq.${pid}`))
      const resta = await dbSelect<{ id: string }>('erp_produtos', `id=eq.${pid}&select=id`).catch(() => [])
      if (resta.length) await limpar(() => dbPatch('erp_produtos', `id=eq.${pid}`, { ativo: false }))
    }
  })

  test('caminho principal: OS ainda não faturada liga a peça ao produto (nome vira o do produto, sem saída de estoque)', async ({ page }) => {
    const prod = await criarProduto('a', 3)
    const os = await criarOS('a', false)
    await ligarPelaFicha(page, os.numero, prod.nome)

    const [peca] = await dbSelect<{ produto_id: string | null; descricao: string }>('erp_os_diagnostico_item', `id=eq.${os.pecaId}&select=produto_id,descricao`)
    expect(peca.produto_id, 'peça ligada ao produto').toBe(prod.id)
    expect(peca.descricao, 'antes de faturar, o nome vira o do produto').toBe(prod.nome)
    const movs = await dbSelect('erp_estoque_movimentacoes', `produto_id=eq.${prod.id}&select=id`)
    expect(movs.length, 'antes de faturar não há saída (a baixa é no faturamento)').toBe(0)
  })

  test('OS FATURADA: liga a peça, valor da OS e título iguais, saída de estoque registrada uma única vez', { tag: '@pos-migration' }, async ({ page }) => {
    const prod = await criarProduto('b', 3)
    const os = await criarOS('b', true)
    const [osAntes] = await dbSelect<{ total: number }>('erp_os', `id=eq.${os.id}&select=total`)
    const [recAntes] = await dbSelect<{ valor: number }>('erp_receber', `id=eq.${os.receberId}&select=valor`)
    expect(Number(osAntes.total), 'OS de teste: 100 + 50').toBe(150)

    await ligarPelaFicha(page, os.numero, prod.nome)

    const [peca] = await dbSelect<{ produto_id: string | null; descricao: string; quantidade: number; preco: number; estoque_saida_mov_id: string | null }>(
      'erp_os_diagnostico_item', `id=eq.${os.pecaId}&select=produto_id,descricao,quantidade,preco,estoque_saida_mov_id`)
    expect(peca.produto_id, 'peça ligada ao produto').toBe(prod.id)
    expect(peca.descricao, 'descrição faturada não muda').toBe(`kit bucha digitado ${RUN}`)
    expect(Number(peca.quantidade), 'quantidade travada').toBe(1)
    expect(Number(peca.preco), 'preço travado').toBe(50)
    expect(peca.estoque_saida_mov_id, 'marca da saída registrada').toBeTruthy()

    const [osDepois] = await dbSelect<{ total: number }>('erp_os', `id=eq.${os.id}&select=total`)
    const [recDepois] = await dbSelect<{ valor: number }>('erp_receber', `id=eq.${os.receberId}&select=valor`)
    expect(Number(osDepois.total), 'valor da OS igual antes e depois').toBe(Number(osAntes.total))
    expect(Number(recDepois.valor), 'título a receber igual antes e depois').toBe(Number(recAntes.valor))

    const movs = await dbSelect<{ tipo: string; quantidade: number; ref_id: string }>('erp_estoque_movimentacoes', `produto_id=eq.${prod.id}&select=tipo,quantidade,ref_id`)
    expect(movs.length, 'saída de estoque registrada UMA vez').toBe(1)
    expect(movs[0].tipo).toBe('saida')
    expect(Number(movs[0].quantidade)).toBe(1)
    expect(movs[0].ref_id, 'saída amarrada à OS').toBe(os.id)
    const [p] = await dbSelect<{ estoque_atual: number }>('erp_produtos', `id=eq.${prod.id}&select=estoque_atual`)
    expect(Number(p.estoque_atual), 'estoque 3 → 2').toBe(2)

    // a peça agora é "estoque": o botão some — não há como registrar a saída duas vezes pela tela
    await page.reload()
    await aguardarConteudo(page)
    const linha = page.getByTestId('os-row').filter({ hasText: os.numero })
    await linha.getByTestId('os-editar').click()
    await expect(page.getByText('Ficha de OS')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-testid^="os-item-substituir-"]')).toHaveCount(0)
    const movs2 = await dbSelect('erp_estoque_movimentacoes', `produto_id=eq.${prod.id}&select=id`)
    expect(movs2.length, 'continua uma única saída').toBe(1)
  })
})
