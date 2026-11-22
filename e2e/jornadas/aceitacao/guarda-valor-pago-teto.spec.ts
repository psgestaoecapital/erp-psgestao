// Núcleo financeiro · trigger-guarda de valor_pago com TETO DE SANIDADE (RD-41, incidente DEMO GE).
// Migration 20261121200040 · @pos-migration. Code: code-desenvolvedor-3.
//
// Prova, na "Comércio (GE) - DEMO", nos DOIS guardas (receber e pagar):
//   1. caminho normal intacto: escrever valor_pago sadio gera 1 baixa 'trigger_guarda' = delta (igual a antes);
//   2. valor_pago acima do teto (R$ 100 bi) NÃO materializa baixa (antes virava baixa de trilhões e estourava
//      o fluxo de caixa).
// Usa R$ 200 bi no caso absurdo (acima do teto, longe do limite do numeric). Limpeza no fim: apaga as baixas
// dos títulos que criou (inclusive as do guarda, se o preview rodar sem a migration) e soft-deleta os títulos.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const HOJE = new Date().toISOString().slice(0, 10)
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const ABSURDO = 200000000000 // R$ 200 bi > teto de R$ 100 bi

type IdRow = { id: string }
type Baixa = { id: string; valor: number; origem: string }
type Tipo = 'receber' | 'pagar'

const criado = { receber: [] as string[], pagar: [] as string[] }
const fk = (t: Tipo) => (t === 'receber' ? 'receber_id' : 'pagar_id')

async function criarTitulo(t: Tipo, valor: number, sufixo: string): Promise<string> {
  const corpo: Record<string, unknown> = {
    company_id: DEMO_GE, descricao: `E2E guarda teto ${RUN}-${t}-${sufixo}`, valor, data_vencimento: HOJE, status: 'pendente',
  }
  if (t === 'receber') corpo.cliente_nome = `Cliente E2E ${RUN}`
  const r = await dbInsert<IdRow>(`erp_${t}`, corpo)
  criado[t].push(r.id)
  return r.id
}

const baixasVivas = (t: Tipo, id: string) =>
  dbSelect<Baixa>(`erp_${t}_baixa`, `${fk(t)}=eq.${id}&deleted_at=is.null&select=id,valor,origem`)

test.describe('Núcleo — guarda de valor_pago com teto de sanidade (RD-41)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
  })

  test.afterAll(async () => {
    const tenta = async (passo: () => Promise<unknown>) => { try { await passo() } catch (e) { console.warn('[limpeza guarda teto]', e) } }
    const agora = new Date().toISOString()
    try {
      for (const t of ['receber', 'pagar'] as Tipo[]) {
        for (const id of criado[t]) {
          // ledger de baixa não tem a trava RD-30 → DELETE físico de TODAS as baixas do título (manual e do guarda)
          await tenta(() => dbDelete(`erp_${t}_baixa`, `${fk(t)}=eq.${id}`))
          await tenta(() => dbPatch(`erp_${t}`, `id=eq.${id}&deleted_at=is.null`, { deleted_at: agora }))
        }
      }
    } finally {
      await soltarTravaDemo(donoTrava())
    }
  })

  for (const t of ['receber', 'pagar'] as Tipo[]) {
    test(`${t}: valor_pago sadio gera a baixa do delta (caminho normal intacto)`, { tag: '@pos-migration' }, async () => {
      const id = await criarTitulo(t, 1234.56, 'normal')
      await dbPatch(`erp_${t}`, `id=eq.${id}`, { valor_pago: 1234.56, data_pagamento: HOJE })
      const bx = await baixasVivas(t, id)
      expect(bx.length, 'uma baixa nasce do delta').toBe(1)
      expect(Number(bx[0].valor)).toBe(1234.56)
      expect(bx[0].origem).toBe('trigger_guarda')
    })

    test(`${t}: valor_pago acima do teto NÃO materializa baixa`, { tag: '@pos-migration' }, async () => {
      const id = await criarTitulo(t, ABSURDO, 'absurdo')
      await dbPatch(`erp_${t}`, `id=eq.${id}`, { valor_pago: ABSURDO, data_pagamento: HOJE })
      const bx = await baixasVivas(t, id)
      expect(bx.length, 'o guarda barra o valor absurdo (sem baixa de lixo)').toBe(0)
    })
  }
})
