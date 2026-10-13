// NFS-e AVULSA (FC Pisos · nota de teste RD-92exc1) · o caminho manual da rota /api/fiscal/nfse/emitir montava o
// prestador sem o município (IBGE) e com série '1' — travava em "falta o código do município da empresa emitente"
// antes de qualquer outra conferência (nenhuma avulsa saiu pela Focus desde 23/09). Agora lê série, CNAE e município
// da Configuração Fiscal, igual ao Recebível (src/lib/fiscal/emissorConfig.ts).
// Prova na Demonstração Revenda, com uma config fiscal de HOMOLOGAÇÃO criada e removida no teste. Nenhuma nota sai:
// sem alíquota de ISS cadastrada, a rota para na trava do ISS por município — que só é alcançada DEPOIS da guarda do
// município do prestador, e cita o IBGE que veio da config.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, obterSessionPayload, registrarJornada, DEMO_REVENDA } from '../../support/api'

let cfgId = ''

test.describe('NFS-e avulsa · emissor (série e município) vem da Configuração Fiscal', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean; cnpj: string | null }>('companies', `id=eq.${DEMO_REVENDA}&select=is_demo,cnpj`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    expect(String(emp?.cnpj ?? '').replace(/\D/g, '').length, 'a demo tem CNPJ de 14 dígitos').toBe(14)
    const ja = await dbSelect<{ id: string }>('erp_fiscal_provider_config', `company_id=eq.${DEMO_REVENDA}&select=id`)
    expect(ja.length, 'a demo não tem config fiscal própria (o teste cria e remove a sua)').toBe(0)
    cfgId = (await dbInsert<{ id: string }>('erp_fiscal_provider_config', {
      company_id: DEMO_REVENDA, provider: 'focusnfe', ambiente: 'homologacao', ativo: true,
      serie_nfse_padrao: '15000', gov_nfse_municipio_codigo: '4207650', opcao_simples_nacional: 1, regime_tributario: 'regime_normal',
    })).id
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfse-avulsa-emissor-config', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (cfgId) await dbDelete('erp_fiscal_provider_config', `id=eq.${cfgId}`).catch(() => {})
  })

  test('avulsa passa da guarda do município e chega à trava do ISS com o IBGE da config', async ({ request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const r = await request.post('/api/fiscal/nfse/emitir', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        companyId: DEMO_REVENDA,
        manual: {
          descricaoServico: 'E2E avulsa emissor da config', valorServicos: 10, retemIss: false, codigoServico: '010101',
          tomador: { razaoSocial: 'Tomador de teste', cnpj: '11444777000161' },
        },
      },
    })
    const j = (await r.json()) as { ok?: boolean; mensagem?: string; iss_municipio_pendente?: boolean }
    expect(r.status(), j.mensagem).toBe(400)
    expect(j.mensagem ?? '', 'não trava mais pela falta do município do emitente').not.toContain('empresa emitente')
    expect(j.iss_municipio_pendente, j.mensagem).toBe(true)
    expect(j.mensagem, 'o município do prestador veio da Configuração Fiscal').toContain('IBGE 4207650')
    const notas = await dbSelect<{ id: string }>('erp_nfse_emitidas', `company_id=eq.${DEMO_REVENDA}&tomador_cnpj=eq.11444777000161&select=id`)
    expect(notas.length, 'nenhuma nota foi registrada').toBe(0)
  })
})
