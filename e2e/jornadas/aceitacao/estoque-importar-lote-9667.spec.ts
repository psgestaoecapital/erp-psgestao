// Importação de estoque em LOTE server-side — chamado #9667 (liga o front ao lote; cadeia completa).
// Prova os critérios DETERMINÍSTICOS da fn_estoque_importar_lote na DEMO, sem depender do volume real:
// dry_run NÃO grava e classifica certo (novo válido vs erro de linha). A validação legal espelha
// fn_erp_produto_salvar (SPED 0200): código/nome/unidade/tipo obrigatórios; tipo 00–06 exige NCM. A gravação
// real (cadeia fn_erp_produto_salvar + descritivos + fn_estoque_ajuste_migracao) foi provada em BEGIN..ROLLBACK
// no PR (RD-38). @pos-migration: a função revisada só existe após o deploy.
import { test, expect } from '../../support/fixtures'
import { rpcComoRobo, dbSelect, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const COD_NOVO = `E2E-LOTE-9667-${Date.now()}`

test.describe('Estoque · importar em lote server-side (cadeia completa) @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-estoque-importar-lote-9667', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('dry_run não grava e classifica novo x erro de linha', async () => {
    const antes = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_GE}&select=id`)
    const rows = [
      // novo VÁLIDO (SPED completo: tipo 00 exige NCM)
      { n: 1, codigo: COD_NOVO, nome: 'Produto de prova 9667', unidade: 'UN', tipo_item_sped: '00', origem: '0', ncm: '39259090', estoque_atual: '7', preco_custo_medio: '3,50' },
      // ERRO de linha: falta unidade e tipo_item_sped
      { n: 2, codigo: `${COD_NOVO}-X`, nome: 'Sem unidade' },
    ]
    // fn_estoque_importar_lote tem guarda multi-tenant (SECURITY DEFINER: recusa com 42501 quem não é interno,
    // admin, nem membro da empresa). O service_role via PostgREST carrega claims não-vazios → NÃO é "interno" e não
    // tem company → a guarda recusa. Como um usuário real dispara a importação pela tela, a prova chama a RPC com o
    // JWT do robô (rpcComoRobo), que é membro da DEMO (get_user_company_ids). A guarda continua intacta — só a
    // invocação foi corrigida para o caminho real; nenhuma verificação (expect) mudou.
    const resp = await rpcComoRobo<{ ok: boolean; dry_run: boolean; total: number; novos: number; atualizados: number; erros: { linha: number }[]; erros_total: number }>(
      'fn_estoque_importar_lote', { p_company_id: DEMO_GE, p_rows: rows, p_dry_run: true, p_user_id: null, p_arquivo: 'e2e-9667' })
    expect(resp.status, `rpc respondeu 200 (corpo: ${resp.texto.slice(0, 200)})`).toBe(200)
    const r = resp.corpo!
    expect(r.ok, 'rpc respondeu ok').toBe(true)
    expect(r.dry_run).toBe(true)
    expect(r.total).toBe(2)
    expect(r.novos, 'código novo válido classificado como novo').toBe(1)
    expect(r.erros_total, 'linha sem unidade/tipo é erro reportado (não aborta)').toBe(1)
    expect(Array.isArray(r.erros) ? r.erros.length : -1, 'erros detalhados vêm em array').toBe(1)

    const depois = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_GE}&select=id`)
    expect(depois.length, 'dry_run NÃO grava produto').toBe(antes.length)
    const criado = await dbSelect<{ id: string }>('erp_produtos', `company_id=eq.${DEMO_GE}&codigo=eq.${COD_NOVO}&select=id`)
    expect(criado.length, 'o produto da simulação não existe').toBe(0)
  })
})
