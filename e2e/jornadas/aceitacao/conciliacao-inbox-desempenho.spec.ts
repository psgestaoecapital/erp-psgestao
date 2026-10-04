// Jordana (BPO · Gean, 02/10): o inbox da conciliação deu 500 por statement timeout — calculava a sugestão uma consulta
// por movimento e, dentro dela, uma consulta por título. Migration 20261003100000 (@pos-migration): sugestões e
// contagens do lote inteiro numa consulta só, com a MESMA pontuação. Aqui, na Demonstração Comércio (GE), um extrato
// de teste com respostas conhecidas: o inbox (RPC chamada COMO O ROBÔ, com a RLS dele) acha o título certo de cada
// movimento, conta 1 candidato exato, usa o saldo do título pago em parte, e a sugestão de um movimento é a mesma
// sozinho ou dentro do lote. O service_role só prepara e limpa os dados de teste.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbInsertMany, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Inbox = { movimento_id: string; sugestao_lancamento_id: string | null; sugestao_score: number | null; sugestao_qtd_candidatos: number | null }
type Sug = { lancamento_tabela: string; lancamento_id: string; match_score: number; match_categoria: string; motivo: string }
type SugLote = Sug & { movimento_id: string }

// valores com centavos "estranhos" para não colidir com títulos que a demo já tem
const CERTOS = [
  { nome: 'ACEITE CONC ALFA', valor: 1234.57, dia: -2 },
  { nome: 'ACEITE CONC BRAVO', valor: 2345.68, dia: -4 },
  { nome: 'ACEITE CONC CHARLIE', valor: 3456.79, dia: -6 },
]

test.describe('Conciliação · inbox em lote (Jordana/Gean)', () => {
  let token = ''
  let lote = ''
  const esperado = new Map<string, string>() // movimento → título certo
  let movParcial = ''
  let tituloParcial = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-conciliacao-inbox-desempenho', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação inbox em lote ${RUN}`,
    })).id

    for (const c of CERTOS) {
      const t = await dbInsert<{ id: string }>('erp_pagar', {
        company_id: DEMO_COMERCIO, fornecedor_nome: c.nome, descricao: `${c.nome} ${RUN}`, valor: c.valor,
        data_emissao: dia(c.dia - 10), data_vencimento: dia(c.dia), status: 'aberto', forma_pagamento: 'pix',
      })
      const m = await dbInsert<{ id: string }>('conciliacao_movimento', {
        lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(c.dia), valor: c.valor,
        descricao: `PIX ENVIADO ${c.nome} ${RUN}`, natureza: 'debito', status: 'pendente',
      })
      esperado.set(m.id, t.id)
    }
    // pago em parte: título de R$ 1.000,13 com R$ 400 pagos → o movimento de R$ 600,13 casa pelo SALDO
    tituloParcial = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_nome: 'ACEITE CONC DELTA', descricao: `ACEITE CONC DELTA ${RUN}`, valor: 1000.13,
      valor_pago: 400, data_emissao: dia(-20), data_vencimento: dia(-3), status: 'parcial', forma_pagamento: 'pix',
    })).id
    movParcial = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(-3), valor: 600.13,
      descricao: `PIX ENVIADO ACEITE CONC DELTA ${RUN}`, natureza: 'debito', status: 'pendente',
    })).id

    // ruído: títulos e movimentos que não casam com nada em particular (o inbox tem de aguentar o volume)
    await dbInsertMany('erp_pagar', Array.from({ length: 60 }, (_, i) => ({
      company_id: DEMO_COMERCIO, fornecedor_nome: `ACEITE CONC RUIDO ${i}`, descricao: `ACEITE CONC RUIDO ${i} ${RUN}`,
      valor: 100 + i * 37.11, data_emissao: dia(-30), data_vencimento: dia(-15 + (i % 20)), status: 'aberto', forma_pagamento: 'boleto',
    })))
    await dbInsertMany('conciliacao_movimento', Array.from({ length: 30 }, (_, i) => ({
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(-10 + (i % 10)), valor: 90 + i * 53.07,
      descricao: `TARIFA OU DIVERSOS ${i} ${RUN}`, natureza: 'debito', status: 'pendente',
    })))
  })

  test.afterAll(async () => {
    if (lote) {
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    await dbPatch('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=like.*${RUN}*&deleted_at=is.null`, { deleted_at: new Date().toISOString() })
  })

  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }

  test('inbox do lote inteiro numa chamada: título certo, 1 candidato exato, saldo do pago em parte', { tag: '@pos-migration' }, async () => {
    const t0 = Date.now()
    const linhas = await rpcRobo<Inbox[]>('fn_conciliacao_inbox', { p_lote_id: lote, p_company_id: DEMO_COMERCIO, p_status: 'pendente', p_limite: 200 })
    const ms = Date.now() - t0
    expect(linhas.length, 'todos os movimentos pendentes do lote voltam').toBe(CERTOS.length + 1 + 30)
    for (const [mov, titulo] of esperado) {
      const l = linhas.find((x) => x.movimento_id === mov)
      expect(l?.sugestao_lancamento_id, 'a sugestão é o título com mesmo valor, mesma data e mesmo favorecido').toBe(titulo)
      expect(Number(l?.sugestao_score), 'valor + data + forma + texto').toBeGreaterThanOrEqual(90)
      expect(l?.sugestao_qtd_candidatos, 'exatamente 1 candidato exato').toBe(1)
    }
    const p = linhas.find((x) => x.movimento_id === movParcial)
    expect(p?.sugestao_lancamento_id, 'o pago em parte casa pelo saldo (R$ 600,13 de R$ 1.000,13)').toBe(tituloParcial)
    // RPC + rede do CI até o banco; a medida do banco (maior empresa, 301 movimentos) está na PR: 675 ms
    expect(ms, `inbox respondeu em ${ms} ms`).toBeLessThan(5000)
  })

  test('a sugestão de um movimento é a mesma sozinho ou dentro do lote', { tag: '@pos-migration' }, async () => {
    const movs = [...esperado.keys(), movParcial]
    const lote5 = await rpcRobo<SugLote[]>('fn_conciliacao_sugerir_match_lote', { p_movimento_ids: movs, p_max_sugestoes: 5 })
    for (const m of movs) {
      const sozinho = await rpcRobo<Sug[]>('fn_conciliacao_sugerir_match', { p_movimento_id: m, p_max_sugestoes: 5 })
      const doLote = lote5.filter((s) => s.movimento_id === m)
      expect(doLote.map((s) => `${s.lancamento_id}:${s.match_score}`).sort(), 'mesmas sugestões e notas')
        .toEqual(sozinho.map((s) => `${s.lancamento_id}:${s.match_score}`).sort())
      expect(sozinho.length, 'no máximo 5').toBeLessThanOrEqual(5)
    }
    const parcial = await rpcRobo<Sug[]>('fn_conciliacao_sugerir_match', { p_movimento_id: movParcial, p_max_sugestoes: 5 })
    expect(parcial[0]?.lancamento_id).toBe(tituloParcial)
    expect(parcial[0]?.motivo, 'o motivo mostra que casou pelo saldo').toContain('(saldo/baixa)')
  })
})
