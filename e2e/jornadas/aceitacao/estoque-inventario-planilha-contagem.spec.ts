// Planilha de contagem do inventário (CEO 01/10 · Estoque › aba Inventário, que já existe — RD-26).
// Prova na Demonstração Comércio (GE), como o robô, com 2 produtos de teste só desta execução (grupo próprio, para o
// filtro isolar os dois): baixa a planilha com contagem cega (padrão) — o saldo do sistema não vai no arquivo —, preenche
// como o estoquista (uma falta e uma sobra), sobe a planilha e confere a PRÉVIA das diferenças; antes de confirmar nada é
// gravado, e depois de confirmar o inventário nasce aberto com as contagens e o estoque continua igual (o ajuste é só no
// "Fechar inventário"). No fim: produtos inativos e inventário de teste cancelado (RD-30: nada é apagado). Só na demo.

import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const GRUPO = `E2E-INV-${RUN}`
const produtos: { id: string; codigo: string; nome: string; saldo: number }[] = []
const inventarios: string[] = []

test.describe('Inventário: planilha de contagem (ida e volta com prévia)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    for (const [suf, nome, saldo] of [['A', `E2E Argamassa AC-III ${RUN}`, 40], ['B', `E2E Rejunte epóxi ${RUN}`, 12.5]] as const) {
      const codigo = `${GRUPO}-${suf}`
      const p = await dbInsert<{ id: string }>('erp_produtos', {
        company_id: DEMO, codigo, nome, tipo: 'produto', ativo: true, unidade: 'UN', categoria: GRUPO,
        estoque_atual: saldo, preco_custo_medio: 10,
      })
      produtos.push({ id: p.id, codigo, nome, saldo })
    }
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-estoque-inventario-planilha', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of inventarios) await dbPatch('erp_inventarios', `id=eq.${id}`, { status: 'cancelado', observacoes: `E2E ${RUN} — teste de aceitação, cancelado` }).catch(() => {})
    for (const p of produtos) await dbPatch('erp_produtos', `id=eq.${p.id}`, { ativo: false }).catch(() => {})
  })

  test('baixar (cega) → preencher → subir → prévia → criar inventário sem mexer no estoque', async ({ page }, testInfo) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/commerce/estoque?tab=inventario')
    await aguardarConteudo(page)

    // ── ida
    await expect(page.getByTestId('inventario-baixar-planilha')).toBeEnabled({ timeout: 30000 })
    await page.getByTestId('inventario-baixar-planilha').click()
    await expect(page.getByTestId('contagem-so-saldo'), 'só itens com saldo: padrão sim').toHaveValue('sim')
    await expect(page.getByTestId('contagem-cega'), 'contagem cega: padrão sim').toHaveValue('sim')
    await expect(page.getByTestId('contagem-grupo').locator(`option[value="${GRUPO}"]`)).toHaveCount(1, { timeout: 30000 })
    await page.getByTestId('contagem-grupo').selectOption(GRUPO)
    await expect(page.getByTestId('contagem-resumo')).toContainText('2 item(ns)')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('contagem-baixar').click()])
    expect(download.suggestedFilename()).toMatch(/^contagem_inventario_.+_\d{8}_\d{4}\.xlsx$/)
    const bytes = readFileSync((await download.path())!)
    await testInfo.attach('contagem.xlsx', { body: bytes, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const ws = wb.getWorksheet('Contagem')!
    const chaves: string[] = []
    ws.getRow(8).eachCell((c) => chaves.push(String(c.value)))
    expect(chaves, 'contagem cega: sem saldo do sistema nem diferença').not.toContain('saldo_sistema')
    expect(chaves).not.toContain('diferenca')
    const col = (k: string) => chaves.indexOf(k) + 1
    const linhas = [9, 10].map((r) => ws.getRow(r))
    expect(linhas.map((l) => String(l.getCell(col('descricao')).value)).sort()).toEqual(produtos.map((p) => p.nome).sort())
    expect(linhas.every((l) => l.getCell(col('quantidade_contada')).value == null), 'quantidade contada em branco').toBe(true)

    // estoquista preenche: A com 2 a menos, B com 1 a mais
    for (const l of linhas) {
      const p = produtos.find((x) => x.nome === String(l.getCell(col('descricao')).value))!
      l.getCell(col('quantidade_contada')).value = p.codigo.endsWith('-A') ? p.saldo - 2 : p.saldo + 1
    }
    const preenchida = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)

    // ── volta
    await page.getByTestId('inventario-subir-planilha').click()
    await expect(page.getByTestId('contagem-arquivo')).toBeEnabled({ timeout: 30000 })
    await page.getByTestId('contagem-arquivo').setInputFiles({ name: 'contagem_preenchida.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: preenchida })
    const previa = page.getByTestId('contagem-previa')
    await expect(previa.getByTestId('contagem-previa-linha')).toHaveCount(2, { timeout: 30000 })
    await expect(previa.getByTestId('contagem-previa-linha').filter({ hasText: produtos[0].nome })).toContainText('-2')
    await expect(previa.getByTestId('contagem-previa-linha').filter({ hasText: produtos[1].nome })).toContainText('+1')
    await expect(page.getByTestId('contagem-previa-resumo')).toContainText('Sobras')

    // antes de confirmar: nada gravado
    const antes = await dbSelect<{ id: string }>('erp_inventario_itens', `produto_id=in.(${produtos.map((p) => p.id).join(',')})&select=id`)
    expect(antes, 'prévia não grava nada').toHaveLength(0)

    await page.getByTestId('contagem-criar').click()
    await expect(page.getByText('Inventário CRIADO com as contagens da planilha')).toBeVisible({ timeout: 60000 })

    const itens = await dbSelect<{ inventario_id: string; produto_id: string; quantidade_sistema: number; quantidade_contada: number; diferenca: number }>(
      'erp_inventario_itens', `produto_id=in.(${produtos.map((p) => p.id).join(',')})&select=inventario_id,produto_id,quantidade_sistema,quantidade_contada,diferenca`)
    expect(itens).toHaveLength(2)
    inventarios.push(itens[0].inventario_id)
    const porProd = (i: number) => itens.find((x) => x.produto_id === produtos[i].id)!
    expect(Number(porProd(0).diferenca)).toBe(-2)
    expect(Number(porProd(1).diferenca)).toBe(1)
    const [inv] = await dbSelect<{ status: string; total_contados: number; total_divergencias: number }>('erp_inventarios', `id=eq.${itens[0].inventario_id}&select=status,total_contados,total_divergencias`)
    expect(inv).toMatchObject({ status: 'em_andamento', total_contados: 2, total_divergencias: 2 })

    // o estoque não mudou: o ajuste só acontece no "Fechar inventário"
    const saldos = await dbSelect<{ id: string; estoque_atual: number }>('erp_produtos', `id=in.(${produtos.map((p) => p.id).join(',')})&select=id,estoque_atual`)
    for (const p of produtos) expect(Number(saldos.find((s) => s.id === p.id)?.estoque_atual)).toBe(p.saldo)
    await expect(page.getByTestId('inv-fechar'), 'o drawer abre com o Fechar inventário (ajuste com confirmação)').toBeVisible()
  })
})
