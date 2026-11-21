// P1 produção (Eng. Chefe 20/11): /dashboard/projetos/obras/[id]/medicoes quebrou para TODAS as empresas.
// fn_obra_medicao_listar falhava com 42883 "operator does not exist: record ->> unknown" — o ORDER BY da
// agregação usava (m->>'numero')::int sobre o REGISTRO da subconsulta, não sobre jsonb (veio na #5262).
// Correção (20261122100335): ORDER BY m.numero DESC. A falha é de PLANO, acontece em qualquer obra.
// Este teste prova na Demonstração Comércio (GE) que a função lista sem erro e em ordem DESC, e repete o
// caso EXATO do chamado (obra da Construtora Modelo - DEMO). Depende da migration → @pos-migration.
// Nada é apagado: as medições de teste são soft-deletadas e a obra é cancelada no fim (RD-30).

import { test, expect } from '../../support/fixtures'
import { dbInsert, dbPatch, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const OBRA_006 = '0e995085-560d-4f30-be11-99a4cfdb9608' // Construtora Modelo - DEMO (caso do chamado)
const RUN = Date.now().toString(36).toUpperCase()

let obraTeste = ''
const medicoes: string[] = []

type Resp = { ok?: boolean; erro?: string; medicoes?: { numero: number }[] }

test.describe('Hub · medições listam sem erro de SQL (P1 record ->> unknown)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-medicao-listar-order', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of medicoes) await dbPatch('projetos_obra_medicao', `id=eq.${id}`, { excluido_em: new Date().toISOString() }).catch(() => {})
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('fn_obra_medicao_listar não dá erro de SQL e ordena por número DESC', { tag: '@pos-migration' }, async () => {
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-MED-${RUN}`, nome: `E2E medição ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id
    for (const n of [1, 2]) {
      const m = await dbInsert<{ id: string }>('projetos_obra_medicao', {
        company_id: DEMO, obra_id: o.id, numero: n, status: 'rascunho', valor_total: 100 * n,
      })
      medicoes.push(m.id)
    }

    const r = await rpcComoRobo<Resp>('fn_obra_medicao_listar', { p_obra_id: o.id })
    // Antes da correção: 400 com 42883 "operator does not exist: record ->> unknown".
    expect(r.status, `listar não pode dar erro de SQL: ${r.texto}`).toBe(200)
    expect(r.corpo?.ok, `resposta ok=true: ${r.texto}`).toBe(true)
    const nums = (r.corpo?.medicoes ?? []).map((m) => m.numero)
    expect(nums).toEqual([2, 1]) // ORDER BY numero DESC

    // Caso EXATO do chamado: a obra da Construtora Modelo - DEMO lista sem erro.
    const r006 = await rpcComoRobo<Resp>('fn_obra_medicao_listar', { p_obra_id: OBRA_006 })
    expect(r006.status, `obra do chamado não pode dar erro: ${r006.texto}`).toBe(200)
    expect(r006.corpo?.ok, `obra do chamado ok=true: ${r006.texto}`).toBe(true)
    expect(Array.isArray(r006.corpo?.medicoes), 'medições é uma lista').toBe(true)
  })
})
