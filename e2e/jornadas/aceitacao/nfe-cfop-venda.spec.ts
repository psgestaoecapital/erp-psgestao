// CFOP de venda do cadastro (CEO 30/09): sem "5102 automático". Produto sem CFOP de venda DENTRO do estado não emite
// para cliente da mesma UF; sem CFOP FORA do estado não emite para outra UF — a mensagem diz o produto e o campo.
// A edição em massa dos CFOPs já tem aceitação própria (produtos-cfop-massa.spec.ts, parte A).
// Só na Demonstração Comércio (GE, SC). A demo NÃO tem emissor fiscal (conferido) — nada chega à Focus (RD-92).
// Produto de teste fica inativo no fim (RD-30).

import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36).toUpperCase()
const CODIGO = `E2E-CFOP-${RUN}`
const NCM = `98${RUN.replace(/\D/g, '').padEnd(6, '3').slice(0, 6)}`
const CLIENTE_DOC = '10000000000145'
let produtoId = ''
let token = ''

const emitir = (request: APIRequestContext, uf: string) => request.post('/api/fiscal/nfe/emitir', {
  headers: { Authorization: `Bearer ${token}` },
  data: {
    companyId: DEMO,
    manual: {
      destinatario: {
        razaoSocial: 'Cliente Demo Aceitação', cnpj: CLIENTE_DOC,
        endereco: { logradouro: 'Rua Demo', numero: '1', bairro: 'Centro', cidade: uf === 'SC' ? 'Chapecó' : 'Curitiba', uf, cep: uf === 'SC' ? '89800000' : '80000000' },
      },
      itens: [{ produtoId, quantidade: 1 }],
    },
  },
})

test.describe('NF-e: CFOP de venda vem do cadastro (dentro e fora do estado)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean; uf_fiscal: string | null }>('companies', `id=eq.${DEMO}&select=is_demo,uf_fiscal`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    expect(emp?.uf_fiscal, 'a demo é de SC (PR = fora do estado)').toBe('SC')
    const cfg = await dbSelect('erp_fiscal_provider_config', `company_id=eq.${DEMO}&select=id`)
    expect(cfg, 'a demo não pode ter emissor fiscal').toHaveLength(0)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const p = await dbInsert<{ id: string }>('erp_produtos', {
      company_id: DEMO, codigo: CODIGO, nome: `E2E CFOP ${RUN}`, ncm: NCM, unidade: 'UN', preco_venda: 10, tipo: 'produto', ativo: true,
      cst_icms: '102', cst_pis: '49', cst_cofins: '49',
    })
    produtoId = p.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfe-cfop-venda', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (produtoId) await dbPatch('erp_produtos', `id=eq.${produtoId}`, { ativo: false }).catch(() => {})
  })

  test('sem CFOP de venda: cliente de SC → trava com "sem CFOP de venda dentro do estado" (nada de 5102 automático)', async ({ request }) => {
    const resp = await emitir(request, 'SC')
    const corpo = await resp.json() as { code?: string; mensagem?: string }
    expect(resp.status(), JSON.stringify(corpo)).toBe(502)
    expect(corpo.code).toBe('PAYLOAD_INVALIDO')
    expect(corpo.mensagem).toContain(`(cód. ${CODIGO}) está sem CFOP de venda dentro do estado`)
  })

  test('com 5102 mas sem CFOP fora do estado: cliente do PR → trava com "sem CFOP de venda fora do estado"', async ({ request }) => {
    await dbPatch('erp_produtos', `id=eq.${produtoId}`, { cfop_venda: '5102' })
    const dentro = await (await emitir(request, 'SC')).json() as { mensagem?: string }
    expect(dentro.mensagem ?? '', 'dentro do estado já não trava por CFOP').not.toContain('sem CFOP')
    const resp = await emitir(request, 'PR')
    const corpo = await resp.json() as { mensagem?: string }
    expect(corpo.mensagem).toContain(`(cód. ${CODIGO}) está sem CFOP de venda fora do estado`)
  })

  test('com o CFOP fora do estado no cadastro (6102), o cliente do PR já não trava por CFOP', async ({ request }) => {
    await dbPatch('erp_produtos', `id=eq.${produtoId}`, { cfop_venda_interestadual: '6102' })
    const corpo = await (await emitir(request, 'PR')).json() as { mensagem?: string }
    expect(corpo.mensagem ?? '', 'fora do estado já não trava por CFOP').not.toContain('sem CFOP')
  })
})
