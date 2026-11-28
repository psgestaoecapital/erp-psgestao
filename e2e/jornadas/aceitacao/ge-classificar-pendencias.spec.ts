// GE · Classificar pendências em lote (GO-LIVE piloto, CEO 25/11, item 2). Migration 20261127120040.
// Code: code-desenvolvedor-3. @pos-migration (as portas só existem depois da migration aplicada).
//
// Prova, na "Comércio (GE) - DEMO" e pelas RPCs reais (fn_pagar_pendencias_classificar,
// fn_pagar_classificar_em_lote, fn_plano_contas_sem_dre, fn_plano_contas_definir_grupo):
//   1. o leitor lista a despesa pendente e SUGERE a conta pelo histórico do mesmo fornecedor (0,90);
//   2. o escritor classifica EM LOTE, é IDEMPOTENTE (2ª vez não reclassifica) e grava trilha;
//   3. nunca sobrescreve classificação já válida; conta inexistente é recusada por item;
//   4. conta sem grupo DRE é listada e recebe o grupo (com trilha); grupo inválido é recusado;
//   5. CROSS-TENANT: empresa sem acesso → leitor vazio e escritor 'sem_acesso'.
// Limpeza no fim: apaga só o que criou (erp_pagar por soft-delete/RD-30; plano/audit por delete físico).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, rpcComoRobo, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const OUTRA = '00000000-0000-4000-a000-0000000000ff' // empresa fora do acesso do robô
const HOJE = new Date().toISOString().slice(0, 10)
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)

type IdRow = { id: string }
type Pendente = {
  id: string; fornecedor_nome: string | null; descricao: string | null; valor: number
  categoria_atual: string | null; sugerido_codigo: string | null; sugestao_origem: string | null; sugestao_confianca: number | null
}
type Pagar = { id: string; categoria: string | null; status: string | null }
type Resp = { ok?: boolean; erro?: string; aplicados?: number; ignorados?: number; erros?: unknown[]; grupo?: string; mensagem?: string }
type ContaSemDre = { id: string; codigo: string; grupo?: string }

const CODIGO = `E2E.CLS.${RUN}`.slice(0, 20)
const criado = { fornecedores: [] as string[], contas: [] as string[], pagares: [] as string[] }

async function criarFornecedor(): Promise<string> {
  const f = await dbInsert<IdRow>('erp_fornecedores', { company_id: DEMO_GE, nome_fantasia: `E2E Forn ${RUN}` })
  criado.fornecedores.push(f.id)
  return f.id
}
async function criarConta(codigo: string, grupo: string): Promise<string> {
  const c = await dbInsert<IdRow>('erp_plano_contas', {
    company_id: DEMO_GE, codigo, descricao: `Conta E2E ${RUN}`, tipo: 'despesa', grupo, nivel: 2, ativo: true,
  })
  criado.contas.push(c.id)
  return c.id
}
let seq = 0
async function criarPagar(fornecedorId: string | null, fornecedorNome: string, categoria: string | null): Promise<string> {
  const p = await dbInsert<IdRow>('erp_pagar', {
    company_id: DEMO_GE, fornecedor_id: fornecedorId, fornecedor_nome: fornecedorNome,
    descricao: `Despesa E2E ${RUN}-${++seq}`, valor: 100 + seq, data_vencimento: HOJE, status: 'aberto', categoria,
  })
  criado.pagares.push(p.id)
  return p.id
}
const pagarDe = (id: string) => dbSelect<Pagar>('erp_pagar', `id=eq.${id}&select=id,categoria,status`)
const auditDe = (id: string) =>
  dbSelect<IdRow>('audit_log_global', `registro_id=eq.${id}&acao=eq.pagar_classificar&select=id`)

test.describe('GE — Classificar pendências em lote (piloto item 2)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
  })

  test.afterAll(async () => {
    const tenta = async (passo: () => Promise<unknown>) => { try { await passo() } catch (e) { console.warn('[limpeza classificar]', e) } }
    const agora = new Date().toISOString()
    try {
      // erp_pagar: RD-30 bloqueia DELETE físico → soft-delete; antes, apaga a trilha que o run gerou.
      for (const id of criado.pagares) {
        await tenta(() => dbDelete('audit_log_global', `registro_id=eq.${id}&tabela=eq.erp_pagar`))
        await tenta(() => dbPatch('erp_pagar', `id=eq.${id}`, { status: 'cancelado', deleted_at: agora }))
      }
      for (const id of criado.contas) {
        await tenta(() => dbDelete('audit_log_global', `registro_id=eq.${id}&tabela=eq.erp_plano_contas`))
        await tenta(() => dbDelete('erp_plano_contas', `id=eq.${id}`))
      }
      for (const id of criado.fornecedores) await tenta(() => dbPatch('erp_fornecedores', `id=eq.${id}`, { excluido_em: agora, ativo: false }))
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  test('leitor lista pendente e sugere a conta pelo histórico do fornecedor (0,90)', { tag: '@pos-migration' }, async () => {
    const forn = await criarFornecedor()
    await criarConta(CODIGO, 'DESP_FIXA')
    // histórico: 1 despesa JÁ classificada nesse fornecedor → vira base da sugestão.
    await criarPagar(forn, `E2E Forn ${RUN}`, CODIGO)
    // pendente: mesma origem, sem conta.
    const pend1 = await criarPagar(forn, `E2E Forn ${RUN}`, null)

    const r = await rpcComoRobo<Pendente[]>('fn_pagar_pendencias_classificar', { p_company_id: DEMO_GE, p_termo: RUN, p_limite: 100 })
    const linhas = (r.corpo ?? []).filter((l) => l.id === pend1)
    expect(linhas.length, `a despesa pendente do run deve aparecer (resp: ${r.texto})`).toBe(1)
    const l = linhas[0]
    expect(l.categoria_atual, 'pendente não tem conta').toBeNull()
    expect(l.sugerido_codigo, 'sugere a conta usada no mesmo fornecedor').toBe(CODIGO)
    expect(l.sugestao_origem).toBe('fornecedor')
    expect(Number(l.sugestao_confianca)).toBe(0.9)
  })

  test('escritor classifica em lote, é idempotente e grava trilha; nunca sobrescreve válido', { tag: '@pos-migration' }, async () => {
    const forn = await criarFornecedor()
    await criarConta(`${CODIGO}.B`.slice(0, 20), 'DESP_VARIAVEL')
    const codB = `${CODIGO}.B`.slice(0, 20)
    const a = await criarPagar(forn, `E2E Forn ${RUN}`, null)
    const b = await criarPagar(forn, `E2E Forn ${RUN}`, null)
    const jaValida = await criarPagar(forn, `E2E Forn ${RUN}`, codB) // já classificada na mesma conta

    // 1ª passada: classifica a e b; jaValida não está pendente → ignorada se enviada.
    const r1 = await rpcComoRobo<Resp>('fn_pagar_classificar_em_lote', {
      p_company_id: DEMO_GE,
      p_itens: [{ id: a, codigo: codB }, { id: b, codigo: codB }, { id: jaValida, codigo: CODIGO }],
    })
    expect(r1.corpo?.ok, `lote 1 (resp: ${r1.texto})`).toBe(true)
    expect(r1.corpo?.aplicados, 'classifica só as 2 pendentes').toBe(2)
    expect(r1.corpo?.ignorados, 'a já-classificada é ignorada (não sobrescreve)').toBe(1)
    expect((await pagarDe(a))[0].categoria).toBe(codB)
    expect((await pagarDe(b))[0].categoria).toBe(codB)
    expect((await pagarDe(jaValida))[0].categoria, 'classificação válida preservada').toBe(codB)
    expect((await auditDe(a)).length, 'trilha de auditoria por linha').toBeGreaterThanOrEqual(1)
    // status/baixa nunca mexidos pela classificação
    expect((await pagarDe(a))[0].status).toBe('aberto')

    // 2ª passada idêntica: idempotente — nada reclassificado.
    const r2 = await rpcComoRobo<Resp>('fn_pagar_classificar_em_lote', {
      p_company_id: DEMO_GE, p_itens: [{ id: a, codigo: codB }, { id: b, codigo: codB }],
    })
    expect(r2.corpo?.aplicados, '2ª vez não reclassifica').toBe(0)
    expect(r2.corpo?.ignorados).toBe(2)
  })

  test('conta inexistente é recusada por item (erros)', { tag: '@pos-migration' }, async () => {
    const forn = await criarFornecedor()
    const p = await criarPagar(forn, `E2E Forn ${RUN}`, null)
    const r = await rpcComoRobo<Resp>('fn_pagar_classificar_em_lote', {
      p_company_id: DEMO_GE, p_itens: [{ id: p, codigo: `NAO.EXISTE.${RUN}`.slice(0, 20) }],
    })
    expect(r.corpo?.ok).toBe(true)
    expect(r.corpo?.aplicados).toBe(0)
    expect((r.corpo?.erros ?? []).length, 'conta inexistente vira erro, não classifica').toBeGreaterThanOrEqual(1)
    expect((await pagarDe(p))[0].categoria, 'nada é gravado').toBeNull()
  })

  test('conta sem grupo DRE: listada, recebe o grupo (trilha) e grupo inválido é recusado', { tag: '@pos-migration' }, async () => {
    const semGrupoCodigo = `${CODIGO}.SG`.slice(0, 20)
    const contaId = await criarConta(semGrupoCodigo, '') // grupo vazio = sem DRE

    const lista = await rpcComoRobo<ContaSemDre[]>('fn_plano_contas_sem_dre', { p_company_id: DEMO_GE })
    expect((lista.corpo ?? []).some((c) => c.id === contaId), 'a conta sem grupo aparece na lista').toBe(true)

    // grupo inválido → recusa
    const inval = await rpcComoRobo<Resp>('fn_plano_contas_definir_grupo', { p_company_id: DEMO_GE, p_id: contaId, p_grupo: 'XPTO' })
    expect(inval.corpo?.ok).toBe(false)
    expect(inval.corpo?.erro).toBe('grupo_invalido')

    // grupo válido → grava + trilha
    const ok = await rpcComoRobo<Resp>('fn_plano_contas_definir_grupo', { p_company_id: DEMO_GE, p_id: contaId, p_grupo: 'DESP_FIXA' })
    expect(ok.corpo?.ok, `definir grupo (resp: ${ok.texto})`).toBe(true)
    const [conta] = await dbSelect<{ grupo: string }>('erp_plano_contas', `id=eq.${contaId}&select=grupo`)
    expect(conta.grupo).toBe('DESP_FIXA')
    const audit = await dbSelect<IdRow>('audit_log_global', `registro_id=eq.${contaId}&acao=eq.plano_conta_definir_grupo&select=id`)
    expect(audit.length, 'trilha do grupo gravada').toBeGreaterThanOrEqual(1)
    // já não aparece mais na lista de pendentes de DRE
    const lista2 = await rpcComoRobo<ContaSemDre[]>('fn_plano_contas_sem_dre', { p_company_id: DEMO_GE })
    expect((lista2.corpo ?? []).some((c) => c.id === contaId), 'some da lista após ligar ao DRE').toBe(false)
  })

  test('cross-tenant: empresa sem acesso → leitor vazio e escritor sem_acesso', { tag: '@pos-migration' }, async () => {
    const leitor = await rpcComoRobo<Pendente[]>('fn_pagar_pendencias_classificar', { p_company_id: OUTRA, p_limite: 50 })
    expect(Array.isArray(leitor.corpo) ? leitor.corpo!.length : -1, 'leitor de empresa sem acesso vem vazio').toBe(0)
    const escritor = await rpcComoRobo<Resp>('fn_pagar_classificar_em_lote', {
      p_company_id: OUTRA, p_itens: [{ id: '00000000-0000-4000-a000-000000000abc', codigo: 'x' }],
    })
    expect(escritor.corpo?.ok).toBe(false)
    expect(escritor.corpo?.erro).toBe('sem_acesso')
    const grupo = await rpcComoRobo<Resp>('fn_plano_contas_definir_grupo', { p_company_id: OUTRA, p_id: '00000000-0000-4000-a000-000000000abc', p_grupo: 'DESP_FIXA' })
    expect(grupo.corpo?.ok).toBe(false)
    expect(grupo.corpo?.erro).toBe('sem_acesso')
  })
})
