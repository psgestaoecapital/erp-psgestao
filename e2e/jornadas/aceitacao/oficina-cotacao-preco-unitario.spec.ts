// Cotação da Oficina → preço da peça na OS. Ao aprovar a cotação (Compras), o gatilho trg_os_cotacao_aprovada roda
// fn_os_cotacao_aplicar_precos, que grava o preço de venda em erp_os_diagnostico_item.preco. Até 27/09 ela gravava
// o valor da LINHA (unitário × quantidade) num campo que é UNITÁRIO — a OS multiplicava de novo e a peça saía
// cobrada 2×, 3×... (corrigido na migration 20260927180000, junto do #132). Este teste trava o contrato:
// preco = unitário de venda (custo do fornecedor com o markup da empresa); linha = preco × quantidade.
// Caminho oficial (as mesmas RPCs da tela de Compras) na Demonstração Oficina, OS BOT-APROV; tudo removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpc, registrarJornada } from '../../support/api'

const DEMO_OFICINA = 'b0700000-0000-4000-a000-000000000001'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const PECA = `Pastilha cotação ${RUN}`
const FORNECEDOR = `Fornecedor cotação ${RUN}`
const QTD = 3
const CUSTO_UNIT = 50

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
// texto literal → regex tolerante a espaço/NBSP (o Intl usa NBSP entre "R$" e o número)
const padraoTexto = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s?')

test.describe('Cotação aprovada grava o preço UNITÁRIO na OS', () => {
  test.describe.configure({ mode: 'serial' })
  let osId = ''
  let statusOriginal = ''
  let fornecedorId = ''
  let diagId = ''
  let cotacaoId = ''
  let vendaUnit = 0

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_OFICINA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string; status: string }>('erp_os', `company_id=eq.${DEMO_OFICINA}&numero=eq.BOT-APROV&select=id,status`)
    expect(os, 'a demo tem a OS BOT-APROV').toBeTruthy()
    osId = os.id
    statusOriginal = os.status

    fornecedorId = (await dbInsert<{ id: string }>('erp_fornecedores', { company_id: DEMO_OFICINA, nome_fantasia: FORNECEDOR })).id
    diagId = (await dbInsert<{ id: string }>('erp_os_diagnostico_item', {
      company_id: DEMO_OFICINA, os_id: osId, descricao: PECA, tipo: 'peca', quantidade: QTD, aprovado: true, severidade: 'media',
    })).id
    cotacaoId = (await dbInsert<{ id: string }>('erp_cotacoes', {
      company_id: DEMO_OFICINA, numero: `COT-E2E-${RUN}`, os_id: osId, status: 'rascunho', descricao: 'Cotação de teste (aceitação)', solicitante: 'Oficina',
    })).id
    const item = await dbInsert<{ id: string }>('erp_cotacoes_itens', {
      company_id: DEMO_OFICINA, cotacao_id: cotacaoId, ordem: 1, produto_nome: PECA, quantidade: QTD, unidade: 'UN', origem_diag_item_id: diagId,
    })
    const cf = await dbInsert<{ id: string }>('erp_cotacoes_fornecedores', {
      company_id: DEMO_OFICINA, cotacao_id: cotacaoId, fornecedor_id: fornecedorId, fornecedor_nome: FORNECEDOR, status: 'convidado',
    })
    // o fornecedor responde R$ 50,00 por unidade (3 un = R$ 150,00) e a cotação é aprovada — igual à tela de Compras
    const prop = await rpc<{ ok: boolean; subtotal: number }>('fn_cotacao_proposta_salvar', {
      p_cotacao_fornecedor_id: cf.id, p_cotacao_item_id: item.id, p_preco_unitario: CUSTO_UNIT, p_desconto_percentual: 0,
    })
    expect(prop.ok && Number(prop.subtotal), 'proposta salva: 3 × R$ 50,00').toBe(QTD * CUSTO_UNIT)
    await rpc('fn_aprovar_proposta_cotacao', { p_cotacao_id: cotacaoId, p_fornecedor_vencedor_id: fornecedorId })
    vendaUnit = Math.round(Number(await rpc<number>('fn_oficina_markup_aplicar', { p_custo_unit: CUSTO_UNIT, p_company_id: DEMO_OFICINA })) * 100) / 100
    expect(vendaUnit, 'a empresa tem markup sobre o custo').toBeGreaterThan(CUSTO_UNIT)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-cotacao-preco-unitario', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const limpar = async (f: () => Promise<void>) => { await f().catch(() => {}) }
    if (cotacaoId) {
      const compras = await dbSelect<{ id: string }>('erp_compras', `cotacao_origem_id=eq.${cotacaoId}&select=id`).catch(() => [])
      for (const c of compras) {
        await limpar(() => dbDelete('erp_compras_itens', `compra_id=eq.${c.id}`))
        await limpar(() => dbDelete('erp_compras', `id=eq.${c.id}`))
      }
      const itens = await dbSelect<{ id: string }>('erp_cotacoes_itens', `cotacao_id=eq.${cotacaoId}&select=id`).catch(() => [])
      if (itens.length) await limpar(() => dbDelete('erp_cotacoes_propostas', `cotacao_item_id=in.(${itens.map((i) => i.id).join(',')})`))
      await limpar(() => dbDelete('erp_cotacoes_fornecedores', `cotacao_id=eq.${cotacaoId}`))
      await limpar(() => dbDelete('erp_cotacoes_itens', `cotacao_id=eq.${cotacaoId}`))
      await limpar(() => dbDelete('erp_cotacoes', `id=eq.${cotacaoId}`))
    }
    if (diagId) await limpar(() => dbDelete('erp_os_diagnostico_item', `id=eq.${diagId}`))
    if (fornecedorId) await limpar(() => dbDelete('erp_fornecedores', `id=eq.${fornecedorId}`))
    // a aprovação da cotação passa a OS para "aguardando aprovação"; devolve a demo como estava
    if (osId && statusOriginal) await limpar(() => dbPatch('erp_os', `id=eq.${osId}`, { status: statusOriginal }))
  })

  test('3 un cotadas a R$ 50,00 → a OS grava o unitário de venda, e a linha é unitário × 3 (não 3 × 3)', async () => {
    const [di] = await dbSelect<{ preco: number; quantidade: number }>('erp_os_diagnostico_item', `id=eq.${diagId}&select=preco,quantidade`)
    expect(Number(di.preco), 'preco = unitário de venda (custo R$ 50,00 + markup), nunca o total da linha').toBe(vendaUnit)
    expect(Number(di.preco)).not.toBe(Math.round(vendaUnit * QTD * 100) / 100)

    const itens = await dbSelect<{ preco: number | null; quantidade: number | null; aprovado: boolean | null }>('erp_os_diagnostico_item',
      `os_id=eq.${osId}&select=preco,quantidade,aprovado`)
    const esperado = Math.round(itens.filter((i) => i.aprovado && Number(i.preco) > 0)
      .reduce((s, i) => s + Number(i.preco) * (Number(i.quantidade) > 0 ? Number(i.quantidade) : 1), 0) * 100) / 100
    const [os] = await dbSelect<{ total: number }>('erp_os', `id=eq.${osId}&select=total`)
    expect(Number(os.total), 'total da OS = Σ unitário × quantidade').toBe(esperado)
  })

  test('na Aprovação do Cliente a peça aparece 3 × unitário = linha', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_OFICINA)
    await page.goto('/dashboard/oficina/aprovacao')
    await aguardarConteudo(page)
    await page.getByText('BOT-APROV').first().click()
    await expect(page.getByText(PECA)).toBeVisible({ timeout: 20000 })
    const linha = `${QTD} × ${brl(vendaUnit)} = ${brl(Math.round(vendaUnit * QTD * 100) / 100)}`
    await expect(page.getByTestId('aprov-item-linha').filter({ hasText: new RegExp(padraoTexto(linha)) })).toBeVisible()
  })
})
