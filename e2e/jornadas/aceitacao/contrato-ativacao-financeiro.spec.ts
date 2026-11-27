// CEO 27/11 — Pedido de contrato tem de passar pelo financeiro. @pos-migration: a coluna
// erp_contratos_config.ativacao_pelo_financeiro e a fn_contratos_fila_financeiro só existem após o deploy.
//
// A ENFORCEMENT da segregação (solicitante/comercial não ativa; financeiro ativa; opção OFF = igual a hoje) é provada
// de forma determinística no corpo da PR (BEGIN…ROLLBACK em produção simulando cada usuário) — o e2e aqui não tem como
// trocar o auth.uid() entre sócio e financeiro (um usuário por sessão). Este e2e cobre o que o deploy expõe na DEMO:
//  1) a coluna de config existe e é legível;
//  2) a fila do financeiro (read RPC) responde e lista o pedido 'solicitado', com valor e "parado há N dias".
// DEMO (RD-69), self-cleaning.
import { test, expect } from '../../support/fixtures'
import { rpcComoRobo, dbSelect, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

type Solic = { ok?: boolean; contrato_id?: string }
type Fila = { ok?: boolean; aguardando?: Array<{ id: string; valor: number | null; dias_parado: number | null; solicitante_nome: string | null }>; sem_financeiro?: unknown[] }

test.describe('Contratos · ativação pelo financeiro @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-contrato-ativacao-financeiro', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('config nova legível + fila do financeiro lista o pedido solicitado', async () => {
    const tag = Date.now()
    let cid = ''
    try {
      // 1) a coluna nova é legível (se não existisse, o PostgREST devolveria 400 e o dbSelect lançaria)
      await dbSelect('erp_contratos_config', `company_id=eq.${DEMO_REVENDA}&select=ativacao_pelo_financeiro&limit=1`)

      // cria um pedido 'solicitado' pela função real (PS_ADMIN; não liga a opção em ninguém)
      const sol = await rpcComoRobo<Solic>('fn_contrato_solicitar', {
        p_company_id: DEMO_REVENDA,
        p_dados: {
          titulo: `Pedido fin ${tag}`, cliente_nome: `Cliente ${tag}`, valor_mensal: '1234.56',
          data_inicio: new Date().toISOString().slice(0, 10),
          data_fim: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
          numero_parcelas: '1', dia_vencimento: '10',
          data_primeiro_vencimento: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
        },
      })
      expect(sol.status, sol.texto).toBe(200)
      cid = sol.corpo?.contrato_id ?? ''
      expect(cid).toBeTruthy()

      // 2) a fila do financeiro responde e lista o pedido 'solicitado', com valor e dias_parado
      const fila = await rpcComoRobo<Fila>('fn_contratos_fila_financeiro', { p_company_id: DEMO_REVENDA })
      expect(fila.status, fila.texto).toBe(200)
      expect(fila.corpo?.ok).toBe(true)
      const linha = (fila.corpo?.aguardando ?? []).find((a) => a.id === cid)
      expect(linha, 'o pedido solicitado aparece em "aguardando o financeiro"').toBeTruthy()
      expect(Number(linha!.valor)).toBeCloseTo(1234.56, 2)
      expect(Number(linha!.dias_parado)).toBe(0)
      expect(Array.isArray(fila.corpo?.sem_financeiro)).toBe(true)
    } finally {
      if (cid) { await dbDelete('erp_contratos_eventos', `contrato_id=eq.${cid}`); await dbDelete('erp_contratos', `id=eq.${cid}`) }
    }
  })
})
