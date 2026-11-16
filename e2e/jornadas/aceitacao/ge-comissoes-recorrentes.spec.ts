// GE · Comissões recorrentes — rede de regressão do gatilho em erp_receber (tabela núcleo).
// Migration 20261118150040 · @pos-migration. Code: code-desenvolvedor-3.
//
// Este PR instala um gatilho AFTER em erp_receber que dispara em TODO pagamento de TODAS as empresas.
// A invariante "a baixa do cliente NUNCA cai por causa da comissão" + a idempotência precisam ficar
// presas por um spec em CI (pedido do gilberto-revisor na #5227). Prova, na "Comércio (GE) - DEMO" e como
// usuário (RPCs reais fn_comissao_recorrente_*), que:
//   1. a baixa gera 1 conta a pagar = 10% do pago (status 'aberto', nunca 'pago') e é IDEMPOTENTE (rodar 2×);
//   2. split (percentual + fixo) e complemento parcial geram só a diferença (nada em dobro);
//   3. estorno: conta NÃO paga → lançamento 'estornada' + erp_pagar 'cancelado'; conta JÁ paga → 'estornada'
//      COM pendência e a conta paga INTACTA; estornar um recebimento ainda ativo é recusado com orientação;
//   4. ISOLAMENTO: um erro dentro da sincronização (overflow numérico forçado) NÃO derruba a baixa — o
//      recebível fica baixado e sobra um evento tipo 'erro' na esteira;
//   5. CROSS-TENANT: regra_salvar/painel/livro de outra empresa são negados;
//   6. nenhuma conta a pagar do vendedor nasce 'pago'.
// Limpeza no fim: apaga só o que criou.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, rpcComoRobo, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const HOJE = new Date().toISOString().slice(0, 10)
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)

type IdRow = { id: string }
type Lanc = { id: string; status: string; valor_comissao: number; fornecedor_id: string; pagar_id: string | null; pendencia: string | null }
type Pagar = { id: string; status: string; valor: number; valor_pago: number; fornecedor_id: string }
type Resp = { ok?: boolean; erro?: string; id?: string }

const criado = { fornecedores: [] as string[], contratos: [] as string[] }

async function criarVendedor(sufixo: string): Promise<string> {
  const r = await rpcComoRobo<Resp>('fn_comissao_recorrente_vendedor_salvar', {
    p_company_id: DEMO_GE, p_dados: { nome: `E2E Vendedor ${RUN}-${sufixo}` },
  })
  expect(r.corpo?.ok, `cadastro de vendedor (resp: ${r.texto})`).toBe(true)
  const id = r.corpo!.id as string
  criado.fornecedores.push(id)
  return id
}

async function criarContrato(sufixo: string): Promise<string> {
  const c = await dbInsert<IdRow>('erp_contratos', {
    company_id: DEMO_GE, numero: `E2E-COMREC-${RUN}-${sufixo}`.slice(0, 30), nome: `Contrato comissão ${RUN}-${sufixo}`,
    valor_mensal: 1000, data_inicio: '2020-01-01', status: 'ativo', cliente_nome: `Cliente E2E ${RUN}`,
  })
  criado.contratos.push(c.id)
  return c.id
}

async function criarRecebivel(contrato: string, valor: number): Promise<string> {
  const r = await dbInsert<IdRow>('erp_receber', {
    company_id: DEMO_GE, contrato_id: contrato, descricao: `Mensalidade E2E ${RUN}`,
    valor, data_vencimento: HOJE, status: 'pendente', cliente_nome: `Cliente E2E ${RUN}`,
  })
  return r.id
}

async function salvarRegra(contrato: string, vendedor: string, extra: Record<string, unknown>): Promise<string> {
  const r = await rpcComoRobo<Resp>('fn_comissao_recorrente_regra_salvar', {
    p_company_id: DEMO_GE,
    p_dados: { contrato_id: contrato, fornecedor_id: vendedor, vigencia_inicio: '2020-01-01', ...extra },
  })
  expect(r.corpo?.ok, `regra_salvar (resp: ${r.texto})`).toBe(true)
  return r.corpo!.id as string
}

// baixa real: PATCH direto em erp_receber dispara o gatilho trg_zz_comissao_recorrente (como a tela faz via baixa).
const baixar = (recebivel: string, valorPago: number, status = 'recebido') =>
  dbPatch('erp_receber', `id=eq.${recebivel}`, { valor_pago: valorPago, status, data_pagamento: HOJE })

const lancDe = (recebivel: string) =>
  dbSelect<Lanc>('erp_comissao_recorrente_lancamento', `recebivel_id=eq.${recebivel}&select=id,status,valor_comissao,fornecedor_id,pagar_id,pendencia`)
const pagaresComissaoDe = (contrato: string) =>
  dbSelect<Pagar>('erp_pagar', `contrato_id=eq.${contrato}&categoria=eq.Comiss%C3%A3o%20recorrente&select=id,status,valor,valor_pago,fornecedor_id`)
const eventosErroDe = (recebivel: string) =>
  dbSelect<IdRow>('erp_comissao_recorrente_evento', `recebivel_id=eq.${recebivel}&tipo=eq.erro&select=id`)

test.describe('GE — comissões recorrentes: gatilho na baixa do cliente #5227', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
    const painel = await rpcComoRobo<Resp>('fn_comissao_recorrente_painel', { p_company_id: DEMO_GE })
    expect(painel.corpo?.ok, `robô precisa ter acesso à GE DEMO (resp: ${painel.texto})`).toBe(true)
  })

  test.afterAll(async () => {
    try {
      for (const c of criado.contratos) {
        await dbDelete('erp_comissao_recorrente_lancamento', `contrato_id=eq.${c}`)
        await dbDelete('erp_comissao_recorrente_evento', `contrato_id=eq.${c}`)
        await dbDelete('erp_pagar', `contrato_id=eq.${c}&categoria=eq.Comiss%C3%A3o%20recorrente`)
        await dbDelete('erp_comissao_recorrente_regra', `contrato_id=eq.${c}`)
        await dbDelete('erp_receber', `contrato_id=eq.${c}`)
        await dbDelete('erp_contratos', `id=eq.${c}`)
      }
      for (const f of criado.fornecedores) await dbDelete('erp_fornecedores', `id=eq.${f}`)
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  test('baixa gera 1 conta a pagar = 10% (nasce "aberto") e é idempotente rodando 2×', { tag: '@pos-migration' }, async () => {
    const vend = await criarVendedor('pct')
    const contrato = await criarContrato('idem')
    const rec = await criarRecebivel(contrato, 1000)
    await salvarRegra(contrato, vend, { tipo_comissao: 'percentual', percentual: 10 })

    await baixar(rec, 1000)

    let lancs = (await lancDe(rec)).filter((l) => l.status === 'gerada')
    expect(lancs.length, 'baixa deve gerar 1 lançamento').toBe(1)
    expect(Number(lancs[0].valor_comissao)).toBe(100)
    let pagares = await pagaresComissaoDe(contrato)
    expect(pagares.length, 'deve nascer 1 conta a pagar de comissão').toBe(1)
    expect(Number(pagares[0].valor)).toBe(100)
    expect(pagares[0].fornecedor_id).toBe(vend)
    expect(pagares[0].status, 'a conta do vendedor nasce PENDENTE, nunca paga').toBe('aberto')

    // idempotência: o botão/manual não pode duplicar
    for (let i = 0; i < 2; i++) {
      const r = await rpcComoRobo<Resp>('fn_comissao_recorrente_ao_receber', { p_recebivel_id: rec })
      expect(r.corpo?.ok, `ao_receber manual (resp: ${r.texto})`).toBe(true)
    }
    lancs = (await lancDe(rec)).filter((l) => l.status === 'gerada')
    expect(lancs.length, 'rodar 2× não pode duplicar o lançamento').toBe(1)
    pagares = (await pagaresComissaoDe(contrato)).filter((p) => p.status !== 'cancelado')
    expect(pagares.length, 'rodar 2× não pode duplicar a conta a pagar').toBe(1)
  })

  test('split (percentual + fixo) e complemento parcial geram só a diferença', { tag: '@pos-migration' }, async () => {
    const vPct = await criarVendedor('splitpct')
    const vFixo = await criarVendedor('splitfixo')
    const contrato = await criarContrato('split')
    const rec = await criarRecebivel(contrato, 1000)
    await salvarRegra(contrato, vPct, { tipo_comissao: 'percentual', percentual: 10 })
    await salvarRegra(contrato, vFixo, { tipo_comissao: 'fixo', valor_fixo: 50 })

    // pagamento parcial, depois total — o complemento só gera a diferença
    await baixar(rec, 300)
    await baixar(rec, 1000)

    const lancsAll = await lancDe(rec)
    const porVend = (id: string) => lancsAll.filter((l) => l.fornecedor_id === id && l.status === 'gerada')
    const pct = porVend(vPct)
    const fixo = porVend(vFixo)
    expect(pct.length, 'percentual deve ter 2 lançamentos (parcial + complemento)').toBe(2)
    expect(fixo.length, 'fixo deve ter 2 lançamentos (parcial + complemento)').toBe(2)
    const soma = (arr: Lanc[]) => Number(arr.reduce((s, l) => s + Number(l.valor_comissao), 0).toFixed(2))
    expect(soma(pct), 'total percentual = 10% de 1000').toBe(100)
    expect(soma(fixo), 'total fixo = valor fixo cheio quando o cliente paga 100%').toBe(50)
  })

  test('estorno: conta não paga cancela; conta já paga vira pendência e preserva o pago', { tag: '@pos-migration' }, async () => {
    const vend = await criarVendedor('est')
    // A) conta ainda não paga ao vendedor → estorno cancela a conta a pagar
    const contA = await criarContrato('estA')
    const recA = await criarRecebivel(contA, 1000)
    await salvarRegra(contA, vend, { tipo_comissao: 'percentual', percentual: 10 })
    await baixar(recA, 1000)
    expect((await pagaresComissaoDe(contA)).length).toBe(1)
    // cancelar o recebimento do cliente dispara o estorno automático pelo gatilho
    await dbPatch('erp_receber', `id=eq.${recA}`, { status: 'cancelado' })
    const lancA = (await lancDe(recA))[0]
    expect(lancA.status, 'lançamento vira estornada').toBe('estornada')
    const pagA = (await pagaresComissaoDe(contA))[0]
    expect(pagA.status, 'conta a pagar ainda aberta é cancelada no estorno').toBe('cancelado')

    // B) conta JÁ paga ao vendedor → estorno marca pendência e NÃO mexe no título pago
    const contB = await criarContrato('estB')
    const recB = await criarRecebivel(contB, 1000)
    await salvarRegra(contB, vend, { tipo_comissao: 'percentual', percentual: 10 })
    await baixar(recB, 1000)
    const pagB0 = (await pagaresComissaoDe(contB))[0]
    // o vendedor já foi pago (estado do título a pagar)
    await dbPatch('erp_pagar', `id=eq.${pagB0.id}`, { valor_pago: 100, status: 'pago', data_pagamento: HOJE })
    // estornar um recebimento ainda ATIVO é recusado com orientação
    const tent = await rpcComoRobo<Resp>('fn_comissao_recorrente_estornar', { p_recebivel_id: recB })
    expect(tent.corpo?.ok).toBe(false)
    expect(tent.corpo?.erro).toBe('recebimento_ativo')
    // agora cancela o recebimento do cliente → estorno com pendência, conta paga intacta
    await dbPatch('erp_receber', `id=eq.${recB}`, { status: 'cancelado' })
    const lancB = (await lancDe(recB))[0]
    expect(lancB.status, 'lançamento vira estornada').toBe('estornada')
    expect(lancB.pendencia, 'estorno de comissão já paga registra pendência explícita').not.toBeNull()
    const pagB = (await dbSelect<Pagar>('erp_pagar', `id=eq.${pagB0.id}&select=id,status,valor,valor_pago,fornecedor_id`))[0]
    expect(pagB.status, 'o título já pago ao vendedor NÃO é alterado (RD-55)').toBe('pago')
    expect(Number(pagB.valor_pago)).toBe(100)
  })

  test('isolamento: erro na sincronização não derruba a baixa e deixa evento "erro"', { tag: '@pos-migration' }, async () => {
    const vend = await criarVendedor('iso')
    const contrato = await criarContrato('iso')
    // valor no limite de numeric(15,2); 10% estoura o numeric(14,2) do valor_comissao DENTRO da sincronização
    const BASE = 9999999999999.99
    const rec = await criarRecebivel(contrato, BASE)
    await salvarRegra(contrato, vend, { tipo_comissao: 'percentual', percentual: 10 })

    await baixar(rec, BASE) // o gatilho captura o erro (EXCEPTION WHEN OTHERS) e segue

    const [r] = await dbSelect<{ valor_pago: number; status: string }>('erp_receber', `id=eq.${rec}&select=valor_pago,status`)
    expect(Number(r.valor_pago), 'a baixa do cliente NUNCA cai por causa da comissão').toBe(BASE)
    expect(r.status).toBe('recebido')
    expect((await eventosErroDe(rec)).length, 'o erro fica visível na esteira (evento tipo erro)').toBeGreaterThanOrEqual(1)
    const pagares = (await pagaresComissaoDe(contrato)).filter((p) => p.status !== 'cancelado')
    expect(pagares.length, 'nenhuma conta a pagar fica pela metade quando a geração falha').toBe(0)
  })

  test('cross-tenant: regra_salvar/painel/livro de outra empresa são negados', { tag: '@pos-migration' }, async () => {
    const OUTRA = '00000000-0000-4000-a000-0000000000ff' // empresa fora do acesso do robô
    const vend = await criarVendedor('xt')
    const contrato = await criarContrato('xt')
    const regra = await rpcComoRobo<Resp>('fn_comissao_recorrente_regra_salvar', {
      p_company_id: OUTRA, p_dados: { contrato_id: contrato, fornecedor_id: vend, tipo_comissao: 'percentual', percentual: 10 },
    })
    expect(regra.corpo?.ok).toBe(false)
    expect(regra.corpo?.erro, 'regra de empresa sem acesso é negada').toContain('Sem acesso')
    const painel = await rpcComoRobo<Resp>('fn_comissao_recorrente_painel', { p_company_id: OUTRA })
    expect(painel.corpo?.ok).toBe(false)
    expect(painel.corpo?.erro).toBe('sem_acesso')
    const livro = await rpcComoRobo<unknown[]>('fn_comissao_recorrente_lancamentos', { p_company_id: OUTRA })
    expect(Array.isArray(livro.corpo) ? livro.corpo.length : -1, 'livro de empresa sem acesso vem vazio').toBe(0)
  })
})
