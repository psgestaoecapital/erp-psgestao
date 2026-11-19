// PDCA GE · /dashboard/financeiro/conciliacao/inbox (auditor_pdca_2 · RD-38) — NÚCLEO financeiro.
// Gap de dinheiro: a sugestão rotulava "perfeito"/"exato" (e a auto-conciliação baixava) mesmo quando o VALOR do
// movimento divergia materialmente do título — bastava data+documento+forma somarem score alto. Ex. real provado pelo
// auditor: movimento R$ 750 × título R$ 1.000 (mesmo CNPJ, PIX, mesma data) saía "perfeito/exato".
// A migration do gate de valor passou a EXIGIR que o valor case (pontos_de_valor > 0) para o selo "perfeito"/"exato".
// Aqui, na Demonstração Comércio (GE), com a RPC chamada COMO O ROBÔ (RLS do usuário):
//   1) valor divergente com score >= 90 NÃO é "perfeito" nem "exato" (vira "quase"/"revisar", match_valor_ok=false);
//   2) NÃO regride o caso são: valor igual continua "perfeito"/"exato" (match_valor_ok=true).
// O service_role só prepara e limpa os dados de teste.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = () => new Date().toISOString().slice(0, 10)
// CNPJ sintético de 14 dígitos (igual no movimento e no fornecedor → pontua documento +45 e leva o score a >= 90)
const CNPJ_DIV = '19283746500012'
const CNPJ_OK = '19283746500029'

type Sug = { lancamento_tabela: string; lancamento_id: string; match_score: number; match_categoria: string; motivo: string; match_valor_ok: boolean }
type Inbox = { movimento_id: string; sugestao_lancamento_id: string | null; sugestao_score: number | null; sugestao_categoria: string | null; sugestao_qualidade: string | null }

test.describe('Conciliação · selo "perfeito/exato" exige valor casando (PDCA GE)', () => {
  let token = ''
  let lote = ''
  let movDiv = '', titDiv = '', fornDiv = ''
  let movOk = '', titOk = '', fornOk = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-conciliacao-match-valor', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token

    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação match valor ${RUN}`,
    })).id

    // Caso DIVERGENTE: título R$ 1.000, movimento R$ 750 — mesmo CNPJ (doc+45), PIX (+25), mesma data (+30) → score >= 90
    fornDiv = (await dbInsert<{ id: string }>('erp_fornecedores', {
      company_id: DEMO_COMERCIO, nome_fantasia: `MATCHVAL DIV ${RUN}`, cnpj_cpf: CNPJ_DIV,
    })).id
    titDiv = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_id: fornDiv, fornecedor_nome: `MATCHVAL DIV ${RUN}`,
      descricao: `MATCHVAL DIV ${RUN}`, valor: 1000, data_emissao: hoje(), data_vencimento: hoje(), status: 'aberto', forma_pagamento: 'pix',
    })).id
    movDiv = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: hoje(), valor: 750,
      descricao: `PIX ENVIADO MATCHVAL DIV ${CNPJ_DIV} ${RUN}`, natureza: 'debito', status: 'pendente',
    })).id

    // Caso SÃO (não-regressão): título e movimento com MESMO valor — continua "perfeito/exato"
    fornOk = (await dbInsert<{ id: string }>('erp_fornecedores', {
      company_id: DEMO_COMERCIO, nome_fantasia: `MATCHVAL OK ${RUN}`, cnpj_cpf: CNPJ_OK,
    })).id
    titOk = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_id: fornOk, fornecedor_nome: `MATCHVAL OK ${RUN}`,
      descricao: `MATCHVAL OK ${RUN}`, valor: 1234.57, data_emissao: hoje(), data_vencimento: hoje(), status: 'aberto', forma_pagamento: 'pix',
    })).id
    movOk = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: hoje(), valor: 1234.57,
      descricao: `PIX ENVIADO MATCHVAL OK ${CNPJ_OK} ${RUN}`, natureza: 'debito', status: 'pendente',
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    await dbPatch('erp_pagar', `company_id=eq.${DEMO_COMERCIO}&descricao=like.MATCHVAL%20*${RUN}*&deleted_at=is.null`, { deleted_at: new Date().toISOString() })
    await dbDelete('erp_fornecedores', `company_id=eq.${DEMO_COMERCIO}&nome_fantasia=like.MATCHVAL%20*${RUN}*`)
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

  test('valor divergente com score alto NÃO é "perfeito" nem "exato"', { tag: '@pos-migration' }, async () => {
    const sug = await rpcRobo<Sug[]>('fn_conciliacao_sugerir_match', { p_movimento_id: movDiv, p_max_sugestoes: 5 })
    const s = sug.find((x) => x.lancamento_id === titDiv)
    expect(s, 'o título divergente é sugerido (score alto por doc+data+forma)').toBeTruthy()
    expect(Number(s!.match_score), 'score >= 90 mesmo com valor errado').toBeGreaterThanOrEqual(90)
    // o cerne da correção: valor divergente derruba o selo e marca match_valor_ok=false
    expect(s!.match_valor_ok, 'valor divergente → match_valor_ok=false').toBe(false)
    expect(s!.match_categoria, 'não rotula "perfeito" com valor errado').not.toBe('perfeito')

    const inbox = await rpcRobo<Inbox[]>('fn_conciliacao_inbox', { p_lote_id: lote, p_company_id: DEMO_COMERCIO, p_status: 'pendente', p_limite: 50 })
    const li = inbox.find((x) => x.movimento_id === movDiv)
    expect(li?.sugestao_lancamento_id, 'a sugestão continua apontando o título').toBe(titDiv)
    expect(li?.sugestao_qualidade, 'qualidade NÃO é "exato" (não auto-concilia dinheiro errado)').not.toBe('exato')
    expect(li?.sugestao_qualidade, 'cai para revisão humana').toBe('revisar')
  })

  test('não-regressão: valor igual continua "perfeito/exato"', { tag: '@pos-migration' }, async () => {
    const sug = await rpcRobo<Sug[]>('fn_conciliacao_sugerir_match', { p_movimento_id: movOk, p_max_sugestoes: 5 })
    const s = sug.find((x) => x.lancamento_id === titOk)
    expect(s, 'o título de mesmo valor é sugerido').toBeTruthy()
    expect(s!.match_valor_ok, 'valor casando → match_valor_ok=true').toBe(true)
    expect(s!.match_categoria, 'valor igual + doc + forma + data → "perfeito"').toBe('perfeito')

    const inbox = await rpcRobo<Inbox[]>('fn_conciliacao_inbox', { p_lote_id: lote, p_company_id: DEMO_COMERCIO, p_status: 'pendente', p_limite: 50 })
    const li = inbox.find((x) => x.movimento_id === movOk)
    expect(li?.sugestao_qualidade, 'qualidade permanece "exato" no caso são').toBe('exato')
  })
})
