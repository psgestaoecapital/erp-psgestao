// CEO 28/09: vigia de coleta parada. A Frioeste ficou 4 horas sem coleta e só se soube porque alguém estava olhando.
// Qualquer agente sem coleta há mais de 1 hora aparece no briefing (coleta_agentes) e abre UM chamado interno para a PS
// (empresa Ps Gestao LTDA — o cliente não vê). Quando a coleta volta, o alerta fecha e o chamado recebe o aviso.
// Correção: agente simulado numa DEMO (Indústria SST) parado há 2h → vigia abre alerta + chamado; coleta volta → fecha.
// Caminho principal: o briefing traz a chave e todo agente real parado tem chamado aberto.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, rpc, dbInsert, dbPatch, dbDelete, dbSelect } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const PS_INTERNA = 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'

type Status = { ok: boolean; total_agentes: number; parados: { company_id: string; empresa: string; chamado_numero: number | null }[] }
type Alerta = { id: string; sugestao_id: string | null; fechado_em: string | null }

test.describe('Vigia de coleta dos agentes', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-vigia-coleta-agentes', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('agente parado há mais de 1 hora abre chamado interno; coleta volta → alerta fecha e o chamado avisa', { tag: '@pos-migration' }, async () => {
    const duasHoras = new Date(Date.now() - 2 * 3600_000).toISOString()
    await dbDelete('erp_agente_status', `company_id=eq.${DEMO_SST}`)
    await dbInsert('erp_agente_status', { company_id: DEMO_SST, hostname: 'E2E-VIGIA', versao_agente: '0.0.0', status: 'ok', ultima_carga: duasHoras, ultimo_heartbeat: duasHoras })
    let sugestaoId: string | null = null
    try {
      await rpc('fn_agente_coleta_vigiar', {})
      const abertos = await dbSelect<Alerta>('erp_agente_alerta_coleta', `company_id=eq.${DEMO_SST}&fechado_em=is.null&select=id,sugestao_id,fechado_em`)
      expect(abertos, 'um alerta aberto para o agente parado').toHaveLength(1)
      sugestaoId = abertos[0].sugestao_id
      const [sug] = await dbSelect<{ company_id: string; status: string; titulo: string }>('sugestoes', `id=eq.${sugestaoId}&select=company_id,status,titulo`)
      expect(sug.company_id, 'chamado interno (empresa PS), o cliente não vê').toBe(PS_INTERNA)
      expect(sug.status).toBe('nova')
      expect(sug.titulo).toMatch(/Coleta parada: .* sem coleta há mais de 1 hora/)

      // rodar de novo não duplica
      await rpc('fn_agente_coleta_vigiar', {})
      expect(await dbSelect('erp_agente_alerta_coleta', `company_id=eq.${DEMO_SST}&fechado_em=is.null&select=id`)).toHaveLength(1)

      // coleta volta
      const agora = new Date().toISOString()
      await dbPatch('erp_agente_status', `company_id=eq.${DEMO_SST}`, { ultima_carga: agora, ultimo_heartbeat: agora })
      await rpc('fn_agente_coleta_vigiar', {})
      expect(await dbSelect('erp_agente_alerta_coleta', `company_id=eq.${DEMO_SST}&fechado_em=is.null&select=id`)).toHaveLength(0)
      const msgs = await dbSelect<{ texto: string }>('sugestao_mensagem', `sugestao_id=eq.${sugestaoId}&select=texto`)
      expect(msgs.map((m) => m.texto).join(' ')).toMatch(/a coleta voltou/)
    } finally {
      await dbDelete('erp_agente_alerta_coleta', `company_id=eq.${DEMO_SST}`)
      await dbDelete('erp_agente_status', `company_id=eq.${DEMO_SST}`)
      if (sugestaoId) await dbPatch('sugestoes', `id=eq.${sugestaoId}`, { status: 'arquivada' })
    }
  })

  test('caminho principal: briefing traz coleta_agentes e todo agente real parado tem chamado aberto', { tag: '@pos-migration' }, async () => {
    await rpc('fn_agente_coleta_vigiar', {})
    const st = await rpc<Status>('fn_agente_coleta_status', {})
    expect(st.total_agentes, 'agentes vigiados').toBeGreaterThanOrEqual(1)
    for (const p of st.parados) expect(p.chamado_numero, `chamado interno para ${p.empresa}`).not.toBeNull()
    const briefing = await rpc<Record<string, unknown>>('fn_briefing_sessao', {})
    expect(briefing).toHaveProperty('coleta_agentes')
    const alertas = briefing.alertas_pendentes_para_ceo as Record<string, unknown>
    if (!st.ok) expect(alertas, 'agente parado vira alerta ao CEO').toHaveProperty('coleta_parada')
  })
})
