// RD-78 · Aceitação NF-e OS-0179 (KGF · contexto d869704f) — na Demonstração Comércio (GE), nunca em empresa real.
// (2) empresa do Simples com produto em CST (regime normal) → a emissão TRAVA antes do envio com a mensagem
//     que ensina (CSOSN, ex.: 500) e a tentativa fica gravada em erp_fiscal_tentativa (nada de falha muda);
//     com CSOSN a trava NÃO aparece (controle). O pré-voo (fn_fiscal_previo) aponta o mesmo produto.
// (1) a recusa síncrona da Focus não é alcançável na demo (sem config fiscal/token e o trigger
//     trg_bloqueia_emissao_demo barra nota em empresa não-produtiva) — está provada no PR por teste com a
//     Focus simulada (422 → nota 'rejeitada' + payload_enviado + tentativa).
//
// Segurança: a demo NÃO tem erp_fiscal_provider_config (conferido no beforeAll) → mesmo que a trava falhasse,
// createFiscalService lança CONFIG_NAO_ENCONTRADA antes de qualquer chamada à Focus. Estado da demo mexido
// aqui (regime, IE, CST do produto) é restaurado no afterAll; as tentativas gravadas ficam (RD-30: não apagar).

import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { dbSelect, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const PRODUTO = 'GE-P001'
const CLIENTE_DOC = '10000000000145'   // cliente da própria demo
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const TRAVA = /está com tributação de regime normal \(CST\)\. Para empresa do Simples use CSOSN \(ex\.: 500 para produto com ST já retido\)\./

type Empresa = { is_demo: boolean; regime_tributario: string | null; inscricao_estadual: string | null }
type Produto = { id: string; nome: string; cst_icms: string | null }
type Tentativa = { id: string; resultado: string; provider: string | null; provider_codigo: string | null; provider_mensagem: string | null; endpoint: string | null }

test.describe('Aceitação OS-0179 — Simples com CST trava antes do envio e deixa rastro', () => {
  let original: Empresa
  let prod: Produto
  let token = ''
  let inicio = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-os0179-simples-cst', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<Empresa>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo,regime_tributario,inscricao_estadual`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    const cfg = await dbSelect('erp_fiscal_provider_config', `company_id=eq.${DEMO_COMERCIO}&select=id`)
    expect(cfg, 'a demo não pode ter emissor fiscal configurado (garantia de que nada chega à Focus)').toHaveLength(0)
    original = emp
    ;[prod] = await dbSelect<Produto>('erp_produtos', `company_id=eq.${DEMO_COMERCIO}&codigo=eq.${PRODUTO}&select=id,nome,cst_icms`)
    expect(prod, `produto ${PRODUTO} da demo`).toBeTruthy()
    // a demo vira "empresa do Simples com IE" e o produto ganha CST de regime normal — o cenário da KGF
    await dbPatch('companies', `id=eq.${DEMO_COMERCIO}`, { regime_tributario: 'simples_nacional', inscricao_estadual: '255000000' })
    await dbPatch('erp_produtos', `id=eq.${prod.id}`, { cst_icms: '00' })
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    inicio = new Date(Date.now() - 5_000).toISOString()
  })

  test.afterAll(async () => {
    if (prod) await dbPatch('erp_produtos', `id=eq.${prod.id}`, { cst_icms: prod.cst_icms })
    if (original) await dbPatch('companies', `id=eq.${DEMO_COMERCIO}`, { regime_tributario: original.regime_tributario, inscricao_estadual: original.inscricao_estadual })
  })

  const emitir = (request: APIRequestContext) => request.post('/api/fiscal/nfe/emitir', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      companyId: DEMO_COMERCIO,
      manual: {
        destinatario: {
          razaoSocial: 'Cliente Demo Aceitação', cnpj: CLIENTE_DOC,
          endereco: { logradouro: 'Rua Demo', numero: '1', bairro: 'Centro', cidade: 'Chapecó', uf: 'SC', cep: '89800000' },
        },
        itens: [{ produtoId: prod.id, quantidade: 1 }],
      },
    },
  })

  test('Simples + CST 00 → trava com a mensagem que ensina, tentativa gravada, nenhuma nota', async ({ request }) => {
    const notasAntes = await dbSelect('erp_nfe_emitidas', `company_id=eq.${DEMO_COMERCIO}&select=id`)
    const resp = await emitir(request)
    const corpo = await resp.json() as { code?: string; mensagem?: string }
    expect(resp.status(), JSON.stringify(corpo)).toBe(502)
    expect(corpo.code).toBe('PAYLOAD_INVALIDO')
    expect(corpo.mensagem).toMatch(TRAVA)
    expect(corpo.mensagem).toContain(`(cód. ${PRODUTO}) está com tributação de regime normal`)

    // rastro: a tentativa bloqueada ANTES do envio (provider nulo — nada saiu para a Focus)
    await expect.poll(async () => (await dbSelect<Tentativa>('erp_fiscal_tentativa',
      `company_id=eq.${DEMO_COMERCIO}&endpoint=eq.nfe/emitir&criado_em=gte.${inicio}&select=id,resultado,provider,provider_codigo,provider_mensagem,endpoint&order=criado_em.desc&limit=1`))[0]?.provider_mensagem ?? '', { timeout: 10_000 }).toMatch(TRAVA)
    const [t] = await dbSelect<Tentativa>('erp_fiscal_tentativa',
      `company_id=eq.${DEMO_COMERCIO}&endpoint=eq.nfe/emitir&criado_em=gte.${inicio}&select=id,resultado,provider,provider_codigo,provider_mensagem,endpoint&order=criado_em.desc&limit=1`)
    expect(t.resultado).toBe('erro')
    expect(t.provider).toBeNull()
    expect(t.provider_codigo).toBe('PRE_ENVIO_PAYLOAD_INVALIDO')

    // nada foi enviado → nenhuma nota nova
    expect(await dbSelect('erp_nfe_emitidas', `company_id=eq.${DEMO_COMERCIO}&select=id`)).toHaveLength(notasAntes.length)
  })

  test('controle: com CSOSN (102) a trava do CST não aparece', async ({ request }) => {
    await dbPatch('erp_produtos', `id=eq.${prod.id}`, { cst_icms: '102' })
    try {
      const resp = await emitir(request)
      const corpo = await resp.json() as { mensagem?: string }
      // a demo segue sem CNPJ/emissor, então ainda falha — mas NÃO pela regra CST×CSOSN
      expect(corpo.mensagem ?? '').not.toMatch(TRAVA)
    } finally {
      await dbPatch('erp_produtos', `id=eq.${prod.id}`, { cst_icms: '00' })
    }
  })

  // @pos-migration: depende da migration 20260926190000/195000, que só chega ao banco no merge. No preview da PR
  // roda em modo informativo; o veredito é o job aceitacao-pos-migration, em produção, logo após o deploy.
  test('pré-voo (fn_fiscal_previo) aponta o mesmo produto com a mesma régua', { tag: '@pos-migration' }, async ({ request }) => {
    const resp = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_fiscal_previo`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { p_company_id: DEMO_COMERCIO },
    })
    expect(resp.ok(), await resp.text()).toBe(true)
    const previo = await resp.json() as { produtos: { simples_cst_regime_normal?: number; amostra: Array<{ codigo: string; motivos: string[] }> } }
    expect(previo.produtos.simples_cst_regime_normal).toBeGreaterThanOrEqual(1)
    const item = previo.produtos.amostra.find((p) => p.codigo === PRODUTO)
    expect(item?.motivos.join(' ')).toMatch(/CST 00 \(regime normal\) — Simples usa CSOSN/)
  })
})
