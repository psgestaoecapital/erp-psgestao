// Importação de estoque em LOTE server-side — chamado #9667 (destrava o cutover da Mecânica 163).
// Prova os critérios DETERMINÍSTICOS da fn_estoque_importar_lote na DEMO, sem depender do volume real:
// dry_run NÃO grava e classifica certo (novo vs erro de linha). A guarda multi-tenant é cópia direta da
// fn_import_produtos_fiscal (já em produção) e o caminho de gravação (INSERT novo + fn_movimentar_estoque ->
// estoque_atual) foi provado em BEGIN..ROLLBACK no PR (RD-38). @pos-migration: a função só existe após o deploy.
import { test, expect } from '../../support/fixtures'
import { rpc, dbSelect, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const COD_NOVO = `E2E-LOTE-9667-${Date.now()}`

test.describe('Estoque · importar em lote (server-side) @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-estoque-importar-lote-9667', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('dry_run não grava e classifica novo x erro de linha', async () => {
    const antes = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_GE}&select=id`)
    const rows = [
      { codigo: COD_NOVO, nome: 'Produto de prova 9667', unidade: 'UN', saldo: '7', preco_custo: '3,50' }, // novo
      { codigo: `${COD_NOVO}-X`, nome: 'Sem unidade' },                                                     // erro: falta unidade
    ]
    const r = await rpc<{ ok: boolean; dry_run: boolean; total: number; novos: number; atualizados: number; erros: number }>(
      'fn_estoque_importar_lote', { p_company_id: DEMO_GE, p_rows: rows, p_dry_run: true, p_user_id: null, p_arquivo: 'e2e-9667' })
    expect(r.ok, 'rpc respondeu ok').toBe(true)
    expect(r.dry_run).toBe(true)
    expect(r.total).toBe(2)
    expect(r.novos, 'código novo classificado como novo').toBe(1)
    expect(r.erros, 'linha sem unidade é erro reportado (não aborta)').toBe(1)

    const depois = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_GE}&select=id`)
    expect(depois.length, 'dry_run NÃO grava produto').toBe(antes.length)
    const criado = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_GE}&codigo=eq.${COD_NOVO}&select=id`)
    expect(criado.length, 'o produto da simulação não existe').toBe(0)
  })
})
