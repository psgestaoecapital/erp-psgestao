// #1755 (Gean) · continuação: produto que JÁ EXISTIA (ex.: peça nascida na OS) ficava sem CEST mesmo com o CEST na
// nota de compra, porque o item da nota só era LIGADO a ele (a #2123 cobre só o "Criar produto" do item).
// Migration _nfe_item_vinculo_completa_cest · @pos-migration. Na demonstração Comércio (GE): o teste cria uma NF recebida de mentira,
// cria produtos pela função canônica COMO O ROBÔ, liga os itens com a MESMA RPC do botão "Vincular" e confere o cadastro.
// Limpeza: os produtos ficam inativos e a NF de teste é apagada (só a que o próprio teste criou).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()

test.describe('NF de entrada — ligar o item a um produto sem CEST completa o CEST pela nota (#1755)', () => {
  let token = ''
  let nfeId = ''
  const produtos: string[] = []

  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }
  async function novoProduto(sufixo: string, cest: string | null): Promise<string> {
    const r = await rpcRobo<{ ok: boolean; id?: string }>('fn_erp_produto_salvar', {
      p_company_id: DEMO_COMERCIO, p_id: null,
      p_dados: { codigo: `T1755V${sufixo}${RUN}`, nome: `Peça da OS teste ${sufixo} ${RUN}`, unidade: 'PC', ncm: '84212300', origem: '0', tipo_item_sped: '00', ...(cest ? { cest } : {}) },
    })
    expect(r.ok, `criar produto ${sufixo}: ${JSON.stringify(r)}`).toBe(true)
    produtos.push(r.id!)
    return r.id!
  }
  async function novoItem(numero: number, cest: string): Promise<string> {
    return (await dbInsert<{ id: string }>('erp_nfe_recebidas_itens', {
      nfe_recebida_id: nfeId, company_id: DEMO_COMERCIO, numero_item: numero, codigo_produto: `F1755${numero}${RUN}`,
      descricao: `Item da nota ${numero} ${RUN}`, ncm: '84212300', cest, origem: '0', cfop: '5102', unidade: 'PC',
      quantidade: 1, valor_unitario: 10, valor_total: 10,
    })).id
  }
  const cestDo = async (id: string) => (await dbSelect<{ cest: string | null }>('erp_produtos', `id=eq.${id}&select=cest`))[0].cest

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    // chave fictícia de 44 dígitos, única por execução; sem CNPJ do emitente (não grava de-para de fornecedor)
    const chave = `4226${Date.now()}`.padEnd(44, '8').slice(0, 44)
    nfeId = (await dbInsert<{ id: string }>('erp_nfe_recebidas', { company_id: DEMO_COMERCIO, chave_acesso: chave })).id
  })

  test.afterAll(async () => {
    for (const id of produtos) await dbPatch('erp_produtos', `id=eq.${id}&company_id=eq.${DEMO_COMERCIO}`, { ativo: false }).catch(() => {})
    if (nfeId) {
      await dbDelete('erp_nfe_recebidas_itens', `nfe_recebida_id=eq.${nfeId}&company_id=eq.${DEMO_COMERCIO}`).catch(() => {})
      await dbDelete('erp_nfe_recebidas', `id=eq.${nfeId}&company_id=eq.${DEMO_COMERCIO}`).catch(() => {})
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nfe-vinculo-completa-cest-1755', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('produto sem CEST recebe o CEST da nota ao ligar; CEST já preenchido e CEST inválido não mudam', { tag: '@pos-migration' }, async () => {
    const semCest = await novoProduto('A', null)
    const comCest = await novoProduto('B', '0100100')
    const outro = await novoProduto('C', null)

    const i1 = await novoItem(1, '01.037.00')
    const i2 = await novoItem(2, '0105400')
    const i3 = await novoItem(3, '01037')

    for (const [item, prod] of [[i1, semCest], [i2, comCest], [i3, outro]] as const) {
      const r = await rpcRobo<{ ok: boolean; erro?: string }>('fn_nfe_item_vincular', { p_item_id: item, p_produto_id: prod, p_fixar_depara: false })
      expect(r.ok, `vincular ${item}: ${JSON.stringify(r)}`).toBe(true)
    }

    expect(await cestDo(semCest), 'produto sem CEST ganhou o CEST da nota (só dígitos)').toBe('0103700')
    expect(await cestDo(comCest), 'CEST já cadastrado nunca é trocado').toBe('0100100')
    expect(await cestDo(outro), 'CEST da nota fora do formato (7 dígitos) não entra').toBeNull()
  })
})
