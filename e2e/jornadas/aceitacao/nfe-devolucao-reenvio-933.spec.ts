// #933 (Gean) · tela de NF-es emitidas. A NF-e de devolução de compra não tem título/pedido/OS, então cada
// "Corrigir e reenviar" virava uma linha nova (caso real: ref ...225833 = 2 recusas + NF 646 em 3 linhas).
// Agora as tentativas sem vínculo agrupam pela chave referenciada até a 1ª nota não recusada; a tela mostra a
// coluna "NF ref." e a timeline do grupo traz as recusas. Depende da migration 20261007030020 → @pos-migration.
// Só na Demonstração Comércio (is_demo); notas de homologação inseridas aqui e apagadas no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsertMany, dbDelete, rpc, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
// posições 26–34 da chave = nº da NF referenciada (000012345 → 12345)
const CHAVE_REF = '4226090000000000000055001' + '000012345' + '1000000000'
const MARCA = 'e2e-933-'

interface Doc { grupo_chave: string; status_principal: string; numero: string | null; tentativas_recusadas: number; qtd_registros: number; nf_referencia: string | null }

test.describe('NF-es emitidas — devolução: reenvio não cria linha nova (#933)', { tag: '@pos-migration' }, () => {
  test.afterEach(async ({}, testInfo) => {
    await dbDelete('erp_nfe_emitidas', `company_id=eq.${DEMO_COMERCIO}&provider_reference=like.${MARCA}*`)
    await registrarJornada('aceitacao-nfe-devolucao-reenvio-933', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('2 recusas + nota autorizada da mesma devolução = 1 linha com NF ref.', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean; cnpj: string | null; razao_social: string | null }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo,cnpj,razao_social`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    await dbDelete('erp_nfe_emitidas', `company_id=eq.${DEMO_COMERCIO}&provider_reference=like.${MARCA}*`)

    const sufixo = `${Date.now()}`
    const base = {
      company_id: DEMO_COMERCIO, ambiente: 'homologacao', natureza_operacao: 'Devolução de compra (teste #933)',
      finalidade: 'devolucao', chave_referenciada: CHAVE_REF, valor_total: 10,
      emitente_cnpj: emp.cnpj ?? '00000000000000', emitente_razao_social: emp.razao_social ?? 'Demonstração',
      destinatario_razao_social: 'Fornecedor teste #933', itens: [],
    }
    const t0 = Date.now()
    await dbInsertMany('erp_nfe_emitidas', [
      { ...base, provider_reference: `${MARCA}${sufixo}-1`, status: 'rejeitada', motivo_rejeicao: 'teste 1', criado_em: new Date(t0 - 3000).toISOString(), data_emissao: new Date(t0 - 3000).toISOString() },
      { ...base, provider_reference: `${MARCA}${sufixo}-2`, status: 'rejeitada', motivo_rejeicao: 'teste 2', criado_em: new Date(t0 - 2000).toISOString(), data_emissao: new Date(t0 - 2000).toISOString() },
      { ...base, provider_reference: `${MARCA}${sufixo}-3`, status: 'autorizada', numero: '933933', criado_em: new Date(t0 - 1000).toISOString(), data_emissao: new Date(t0 - 1000).toISOString() },
    ])

    const r = await rpc<{ ok: boolean; documentos: Doc[] }>('fn_fiscal_documentos', { p_company_id: DEMO_COMERCIO, p_tipo: 'nfe', p_limit: 500 })
    expect(r.ok).toBe(true)
    const grupo = r.documentos.filter((d) => d.grupo_chave.startsWith(`dev:${CHAVE_REF}:`))
    expect(grupo, 'as 3 tentativas viram 1 linha').toHaveLength(1)
    expect(grupo[0]).toMatchObject({ status_principal: 'autorizada', numero: '933933', tentativas_recusadas: 2, qtd_registros: 3, nf_referencia: '12345' })

    const tl = await rpc<{ ok: boolean; eventos: { categoria: string }[] }>('fn_fiscal_documento_timeline',
      { p_company_id: DEMO_COMERCIO, p_tipo: 'nfe', p_grupo_chave: grupo[0].grupo_chave })
    expect(tl.ok).toBe(true)
    expect(tl.eventos.map((e) => e.categoria)).toEqual(['recusa', 'recusa', 'autorizacao'])

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
    await page.goto('/dashboard/fiscal/nfe')
    await aguardarConteudo(page)
    const linha = page.getByTestId('nfe-list-row').filter({ hasText: '933933' })
    await expect(linha).toHaveCount(1, { timeout: 20000 })
    await expect(linha.getByTestId('nfe-list-nf-ref')).toHaveText('12345')
    await expect(linha).toContainText('2 recusadas')
  })
})
