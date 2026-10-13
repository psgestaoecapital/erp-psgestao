// NF-e sem tributação suposta (CEO 29/09 · FCR com 436 produtos sem CSOSN/CST/PIS/COFINS): o "102 automático" (e o
// PIS/COFINS 04) saiu. Produto sem esses campos no cadastro TRAVA antes do envio e a mensagem diz qual produto e qual
// campo falta. Com os campos preenchidos, essa trava não aparece (controle).
// Só na Demonstração Comércio (GE). Segurança: a demo NÃO tem emissor fiscal configurado (conferido no beforeAll) —
// mesmo que a trava falhasse, nada chegaria à Focus (RD-92). Produto de teste fica inativo no fim (RD-30).

import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const CODIGO = `E2E-TRIB-${RUN}`
const CLIENTE_DOC = '10000000000145'   // cliente da própria demo
let produtoId = ''
let token = ''

const emitir = (request: APIRequestContext) => request.post('/api/fiscal/nfe/emitir', {
  headers: { Authorization: `Bearer ${token}` },
  data: {
    companyId: DEMO,
    manual: {
      destinatario: {
        razaoSocial: 'Cliente Demo Aceitação', cnpj: CLIENTE_DOC,
        endereco: { logradouro: 'Rua Demo', numero: '1', bairro: 'Centro', cidade: 'Chapecó', uf: 'SC', cep: '89800000' },
      },
      itens: [{ produtoId, quantidade: 1 }],
    },
  },
})

test.describe('NF-e sem tributação suposta — produto sem CSOSN/PIS/COFINS trava com produto e campo', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const cfg = await dbSelect('erp_fiscal_provider_config', `company_id=eq.${DEMO}&select=id`)
    expect(cfg, 'a demo não pode ter emissor fiscal (nada chega à Focus)').toHaveLength(0)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const p = await dbInsert<{ id: string }>('erp_produtos', {
      company_id: DEMO, codigo: CODIGO, nome: `E2E tributação ${RUN}`, ncm: '32145000', unidade: 'UN', preco_venda: 10,
      // CFOP de venda preenchido: isola a trava de PIS/COFINS da trava do CFOP (CEO 30/09)
      tipo: 'produto', ativo: true, cst_icms: '102', cfop_venda: '5102',
    })
    produtoId = p.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfe-sem-tributacao-suposta', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (produtoId) await dbPatch('erp_produtos', `id=eq.${produtoId}`, { ativo: false }).catch(() => {})
  })

  test('sem CST do PIS e da COFINS → trava dizendo o produto e os 2 campos (nada de 04 automático)', async ({ request }) => {
    const resp = await emitir(request)
    const corpo = await resp.json() as { code?: string; mensagem?: string }
    expect(resp.status(), JSON.stringify(corpo)).toBe(502)
    expect(corpo.code).toBe('PAYLOAD_INVALIDO')
    expect(corpo.mensagem).toContain(`(cód. ${CODIGO}) está sem CST do PIS e CST da COFINS no cadastro`)
    expect(corpo.mensagem).toContain('Edição fiscal em massa')
  })

  test('controle: com PIS e COFINS preenchidos a trava de tributação não aparece', async ({ request }) => {
    await dbPatch('erp_produtos', `id=eq.${produtoId}`, { cst_pis: '49', cst_cofins: '49' })
    const resp = await emitir(request)
    const corpo = await resp.json() as { mensagem?: string }
    // a demo segue sem CNPJ/emissor, então ainda falha — mas NÃO por falta de tributação no produto
    expect(corpo.mensagem ?? '').not.toContain('está sem CST')
    expect(corpo.mensagem ?? '').not.toContain('está sem CSOSN')
  })
})
