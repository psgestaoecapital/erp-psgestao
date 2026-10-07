// #1692 (Gean · Jordana) · tela de recebimento de NF-e (Compras › Documentos recebidos):
//  1) nota concluída sai da tela inicial ("A concluir") e aparece só na aba "Concluídas";
//  2) a cada clique num item a tela "voltava para o meio": a recarga trocava a lista pelo "Carregando…" e desmontava a
//     nota aberta. Agora a recarga depois de uma ação é silenciosa — a nota e o item continuam os MESMOS elementos;
//  3) a nota aberta ganha fundo mais escuro;
//  4) o bloco de parcelas só aparece se algum item gera financeiro;
//  5) item resolvido fica recolhido em uma linha (e há "recolher").
// Sem migration: roda no preview. Demonstração Comércio (GE): o teste cria 2 notas de mentira (uma a concluir, uma
// concluída) e apaga só o que ele mesmo criou.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
const chave = (sufixo: string) => `4210${Date.now()}${sufixo}`.padEnd(44, '7').slice(0, 44)

test.describe('Recebimento de NF-e — abas, tela que não pula e itens resolvidos (#1692)', () => {
  const notas: string[] = []
  let notaAberta = ''
  let notaConcluida = ''
  let itemResolvido = ''
  let itemPendente = ''

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const agora = new Date().toISOString()
    const base = { company_id: DEMO_COMERCIO, status: 'completa', status_manifestacao: 'ciencia', valor_total: 150, data_emissao: agora, numero: '1692' }
    notaAberta = (await dbInsert<{ id: string }>('erp_nfe_recebidas', { ...base, chave_acesso: chave('1'), emitente_razao: `E2E 1692 A CONCLUIR ${RUN}` })).id
    notaConcluida = (await dbInsert<{ id: string }>('erp_nfe_recebidas', { ...base, chave_acesso: chave('2'), emitente_razao: `E2E 1692 CONCLUIDA ${RUN}`, concluida_em: agora })).id
    notas.push(notaAberta, notaConcluida)
    const item = { nfe_recebida_id: notaAberta, company_id: DEMO_COMERCIO, quantidade: 1, unidade: 'UN', ncm: '84213100', cfop: '5102' }
    // item 1 já resolvido (uso/consumo, não movimenta, não gera financeiro) · item 2 a decidir, gera financeiro
    itemResolvido = (await dbInsert<{ id: string }>('erp_nfe_recebidas_itens', { ...item, numero_item: 1, codigo_produto: `R${RUN}`,
      descricao: `Luva teste ${RUN}`, valor_unitario: 50, valor_total: 50, entra_estoque: false, gera_financeiro: false })).id
    itemPendente = (await dbInsert<{ id: string }>('erp_nfe_recebidas_itens', { ...item, numero_item: 2, codigo_produto: `P${RUN}`,
      descricao: `Estopa teste ${RUN}`, valor_unitario: 100, valor_total: 100, gera_financeiro: true })).id
  })

  test.afterAll(async () => {
    for (const id of notas) {
      await dbDelete('erp_nfe_recebidas_itens', `nfe_recebida_id=eq.${id}&company_id=eq.${DEMO_COMERCIO}`).catch(() => {})
      await dbDelete('erp_nfe_recebidas', `id=eq.${id}&company_id=eq.${DEMO_COMERCIO}`).catch(() => {})
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-gean-recebimento-nfe-1692', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('concluída só na aba própria; clicar no item não recarrega a nota; parcelas seguem o "gera financeiro"', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/compras/documentos-recebidos')
    await aguardarConteudo(page)

    const cardAberta = page.getByTestId(`nfe-card-${notaAberta}`)
    const cardConcluida = page.getByTestId(`nfe-card-${notaConcluida}`)

    // 1) abre em "A concluir": a nota pendente aparece, a concluída não
    await expect(page.getByTestId('nfe-aba-a_concluir')).toHaveAttribute('aria-selected', 'true')
    await expect(cardAberta, 'nota a concluir na tela inicial').toBeVisible({ timeout: 20000 })
    await expect(cardConcluida, 'concluída fora da tela inicial').toHaveCount(0)
    await page.getByTestId('nfe-aba-concluidas').click()
    await expect(cardConcluida, 'concluída na aba "Concluídas"').toBeVisible({ timeout: 20000 })
    await expect(cardAberta).toHaveCount(0)
    await page.getByTestId('nfe-aba-a_concluir').click()
    await expect(cardAberta).toBeVisible({ timeout: 20000 })

    // 3) abrir a nota: fundo destacado
    await cardAberta.getByRole('button', { name: 'Itens' }).click()
    await expect(cardAberta).toHaveClass(/bg-\[#EFE4D3\]/)

    // 5) item já resolvido abre recolhido em uma linha; o pendente aberto
    await expect(page.getByTestId(`nfe-item-recolhido-${itemResolvido}`)).toBeVisible({ timeout: 20000 })
    const pendente = page.getByTestId(`nfe-item-${itemPendente}`)
    await expect(pendente).toBeVisible()
    await expect(page.getByTestId('nfe-itens-resolvidos')).toContainText('1 de 2')

    // 4) parcelas aparecem (o item pendente gera financeiro)
    const parcelas = cardAberta.getByText('Parcelas do financeiro')
    await expect(parcelas).toBeVisible()

    // 2) marca os elementos: se a lista ou os itens forem recarregados com "Carregando…", eles são recriados e a marca some
    await cardAberta.evaluate((el) => { el.setAttribute('data-marca-1692', 'x') })
    await pendente.evaluate((el) => { el.setAttribute('data-marca-1692', 'x') })

    await pendente.getByRole('button', { name: /Não movimenta estoque/ }).click()
    await expect(page.getByTestId('nfe-itens-resolvidos'), 'o item virou resolvido').toContainText('2 de 2', { timeout: 20000 })
    const [it] = await dbSelect<{ entra_estoque: boolean | null }>('erp_nfe_recebidas_itens', `id=eq.${itemPendente}&select=entra_estoque`)
    expect(it.entra_estoque, 'gravou no banco').toBe(false)
    await expect(cardAberta, 'a nota não foi recarregada (tela não pula)').toHaveAttribute('data-marca-1692', 'x')
    await expect(pendente, 'o item não foi recarregado').toHaveAttribute('data-marca-1692', 'x')

    // 4) desmarcar "gera financeiro" do único item que gerava → parcelas somem; marcar de novo → voltam
    const gera = pendente.getByRole('checkbox', { name: 'gera financeiro' })
    await gera.click()   // controlado: só muda depois que o servidor grava
    await expect(parcelas, 'sem item que gera financeiro, sem parcelas').toHaveCount(0, { timeout: 20000 })
    await expect(cardAberta).toHaveAttribute('data-marca-1692', 'x')
    await gera.click()
    await expect(parcelas).toBeVisible({ timeout: 20000 })

    // 5) "Recolher os resolvidos" deixa os dois itens em uma linha
    await page.getByTestId('nfe-recolher-resolvidos').click()
    await expect(page.getByTestId(`nfe-item-recolhido-${itemPendente}`)).toBeVisible()
  })
})
