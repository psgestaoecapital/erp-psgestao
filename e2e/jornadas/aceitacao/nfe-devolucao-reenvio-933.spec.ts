// #933 (Gean) · tela de NF-es emitidas. A NF-e de devolução de compra não tem título/pedido/OS, então cada
// "Corrigir e reenviar" virava uma linha nova (caso real: ref ...225833 = 2 recusas + NF 646 em 3 linhas).
// Agora as tentativas sem vínculo agrupam pela chave referenciada até a 1ª nota não recusada; a tela mostra a
// coluna "NF ref." e a timeline do grupo traz as recusas. Depende da migration 20261016220220 → @pos-migration.
// SÓ LEITURA (RD-87) sobre o caso real da Gean: o banco recusa inserir nota em empresa demo
// (trg_bloqueia_emissao_demo), então não há como semear notas de teste. No banco de testes (sem dado de cliente)
// o caso não existe → o teste é pulado; o veredito é o @pos-migration em produção.

import { test, expect } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

const GEAN = 'a462e13f-0f51-4c54-abe8-4474b591633b'
// posições 26–34 da chave = nº da NF referenciada (001225833 → 1225833)
const CHAVE_REF = '42260985216422000151550010012258331985649144'

interface Doc { grupo_chave: string; status_principal: string; numero: string | null; tentativas_recusadas: number; qtd_registros: number; nf_referencia: string | null }

test.describe('NF-es emitidas — devolução: reenvio não cria linha nova (#933)', { tag: '@pos-migration' }, () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfe-devolucao-reenvio-933', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('2 recusas + nota autorizada da mesma devolução = 1 linha com NF ref.', async () => {
    const notas = await dbSelect<{ id: string }>('erp_nfe_emitidas', `company_id=eq.${GEAN}&finalidade=eq.devolucao&chave_referenciada=eq.${CHAVE_REF}&select=id`)
    test.skip(notas.length === 0, 'caso real da Gean ausente (banco de testes sem dado de cliente)')
    expect(notas, 'caso real: 3 tentativas da mesma devolução').toHaveLength(3)

    const r = await rpc<{ ok: boolean; documentos: Doc[] }>('fn_fiscal_documentos', { p_company_id: GEAN, p_tipo: 'nfe', p_limit: 500 })
    expect(r.ok).toBe(true)
    const grupo = r.documentos.filter((d) => d.grupo_chave.startsWith(`dev:${CHAVE_REF}:`))
    expect(grupo, 'as 3 tentativas viram 1 linha').toHaveLength(1)
    expect(grupo[0]).toMatchObject({ status_principal: 'autorizada', numero: '646', tentativas_recusadas: 2, qtd_registros: 3, nf_referencia: '1225833' })

    const tl = await rpc<{ ok: boolean; eventos: { categoria: string }[] }>('fn_fiscal_documento_timeline',
      { p_company_id: GEAN, p_tipo: 'nfe', p_grupo_chave: grupo[0].grupo_chave })
    expect(tl.ok).toBe(true)
    // a timeline também traz as tentativas (erp_fiscal_tentativa); aqui só o desfecho de cada nota
    expect(tl.eventos.map((e) => e.categoria).filter((c) => c !== 'tentativa')).toEqual(['recusa', 'recusa', 'autorizacao'])
  })
})
