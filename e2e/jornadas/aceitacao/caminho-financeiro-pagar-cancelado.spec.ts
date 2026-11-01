// Chamado #2734 (Canal PS · Rodrigo) — a tela Financeiro → Despesas a pagar contava lançamentos CANCELADOS
// como "Vencidas"/total. A fn_ge_listagem_v2 (ramo pagar) passou a excluir status 'cancelado' (como o ramo
// receber já fazia). Este teste PROVA no robô: um pagar CANCELADO vencido NÃO aparece na listagem (os cards
// do front são recompostos a partir das linhas por `situacao`), enquanto um pagar ABERTO vencido aparece.
// @pos-migration: só passa com a migration deste PR (fn_ge_listagem_v2) aplicada → o veredito é o aceitacao-pos-migration.yml
// em PRODUÇÃO (no preview roda informativo, contra a main ainda com o defeito). Demonstração Comércio (GE Pró),
// nunca empresa real; os dois lançamentos de teste são excluídos (soft) no fim.

import { test, expect } from '../../support/fixtures'
import { dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

// vencimento bem no passado para cair SEMPRE em "vencido"
const venc = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)

type Linha = { id: string; status: string; situacao: string; descricao: string }
type Resp = { sem_plano?: boolean; kpis?: { vencidos?: { valor: number; qtd: number } }; resultados?: Linha[] }

test.describe('Contas a Pagar — CANCELADO não conta como vencido (#2734)', () => {
  let idCancelado = ''
  let idAberto = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('caminho-financeiro-pagar-cancelado', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    idCancelado = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, descricao: `#2734 cancelado ${RUN}`, fornecedor_nome: 'Fornecedor 2734',
      valor: 12345.67, data_emissao: venc, data_vencimento: venc, status: 'cancelado', forma_pagamento: 'pix',
    })).id
    idAberto = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, descricao: `#2734 aberto ${RUN}`, fornecedor_nome: 'Fornecedor 2734',
      valor: 100, data_emissao: venc, data_vencimento: venc, status: 'aberto', forma_pagamento: 'pix',
    })).id
  })

  test.afterAll(async () => {
    const limpar = async (id: string) => { if (id) await dbPatch('erp_pagar', `id=eq.${id}`, { deleted_at: new Date().toISOString() }) }
    await limpar(idCancelado)
    await limpar(idAberto)
  })

  test('pagar cancelado vencido fica fora da listagem; aberto vencido entra como vencido', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const chamar = async (): Promise<Resp> => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_ge_listagem_v2`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // período largo: "vencido" não tem período, mas garante a janela também
        body: JSON.stringify({ p_company_id: DEMO_COMERCIO, p_tipo: 'pagar', p_data_inicio: `${new Date().getFullYear() - 1}-01-01`, p_data_fim: new Date().toISOString().slice(0, 10) }),
      })
      expect(r.ok, 'a RPC respondeu').toBe(true)
      return (await r.json()) as Resp
    }

    // idempotência: duas chamadas seguidas dão o mesmo veredito
    for (let i = 0; i < 2; i++) {
      const j = await chamar()
      expect(j.sem_plano, 'demo GE Pró responde a listagem').toBeFalsy()
      const linhas = j.resultados ?? []
      const cancelada = linhas.find((l) => l.id === idCancelado)
      const aberta = linhas.find((l) => l.id === idAberto)
      expect(cancelada, `rodada ${i + 1}: o pagar CANCELADO não pode aparecer na listagem`).toBeUndefined()
      expect(aberta, `rodada ${i + 1}: o pagar ABERTO vencido tem de aparecer`).toBeTruthy()
      expect(aberta?.situacao, `rodada ${i + 1}: o aberto vencido entra como 'vencido'`).toBe('vencido')
    }
  })
})
