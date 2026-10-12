// CEO 07/10 (Pdois/ProPlay): título EXCLUÍDO aparecia como pendente em /dashboard/contas, aging e projeção.
// Migration 20261007200000 · @pos-migration. Asserção no banco (service_role), só leitura.
import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

type Id = { id: string }
const PAGINA = 'select=id&limit=200'

test.describe('Financeiro — excluído fora das views', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-financeiro-excluidos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('título excluído não aparece em contas (v_lancamentos_consolidado) nem no aging @pos-migration', async () => {
    const pag = await dbSelect<Id>('erp_pagar', `deleted_at=not.is.null&${PAGINA}&order=deleted_at.desc`)
    const rec = await dbSelect<Id>('erp_receber', `deleted_at=not.is.null&${PAGINA}&order=deleted_at.desc`)
    expect(pag.length + rec.length, 'há títulos excluídos para provar').toBeGreaterThan(0)
    for (const [ids, view] of [[pag, 'v_lancamentos_consolidado'], [pag, 'v_contas_pagar_aging'], [rec, 'v_lancamentos_consolidado'], [rec, 'v_contas_receber_aging']] as const) {
      if (!ids.length) continue
      const vistos = await dbSelect<Id>(view, `id=in.(${ids.map(i => i.id).join(',')})&select=id`)
      expect(vistos, `${view} não pode listar título excluído`).toHaveLength(0)
    }
  })

  test('título de conta com incluir_no_fluxo=false não entra na projeção de fluxo @pos-migration', async () => {
    const contas = await dbSelect<{ company_id: string; nome: string }>('erp_banco_contas', 'incluir_no_fluxo=eq.false&select=company_id,nome&limit=20')
    test.skip(!contas.length, 'nenhuma conta com incluir_no_fluxo=false neste ambiente')
    const hoje = new Date().toISOString().slice(0, 10)
    for (const c of contas) {
      const tit = await dbSelect<{ valor: number }>('erp_pagar',
        `company_id=eq.${c.company_id}&conta_bancaria=eq.${encodeURIComponent(c.nome)}&deleted_at=is.null&data_vencimento=gte.${hoje}&status=not.in.(pago,cancelado)&select=valor&limit=1`)
      if (!tit.length) continue
      const todos = await dbSelect<{ valor: number }>('erp_pagar',
        `company_id=eq.${c.company_id}&deleted_at=is.null&data_vencimento=gte.${hoje}&status=not.in.(pago,cancelado)&select=valor&limit=1000`)
      const proj = await dbSelect<{ saidas: number }>('v_psgc_fluxo_projecao', `company_id=eq.${c.company_id}&tipo=eq.projetado&select=saidas`)
      const somaProj = proj.reduce((s, r) => s + Number(r.saidas), 0)
      const somaTodos = todos.reduce((s, r) => s + Number(r.valor), 0)
      expect(somaProj, 'projeção exclui os títulos da conta fora do fluxo').toBeLessThan(somaTodos)
      return
    }
    test.skip(true, 'sem título aberto em conta fora do fluxo')
  })
})
