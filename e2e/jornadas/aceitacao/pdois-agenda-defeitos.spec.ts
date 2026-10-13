// Pdois · Agenda comercial (01/10): 3 defeitos achados no mapeamento do #119. Sem migration: roda no preview.
// Prova na Agência (P&M) - DEMO, pela sessão do robô e pelos MESMOS caminhos da tela:
//  1) salvar um evento existente atualiza o próprio evento (antes criava uma cópia);
//  2) evento excluído não volta na consulta da agenda;
//  3) evento criado leva o nome do responsável.
// Evento de teste fica excluído no fim (fn_agendamento_excluir — soft delete, RD-30).

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const DIA = '2026-10-20'
let token = ''

async function chamar(metodo: 'GET' | 'PATCH' | 'POST', caminho: string, corpo?: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
}
const agendaDoDia = () => chamar('GET', `erp_agendamento?company_id=eq.${DEMO_AG}&origem_modulo=eq.comercial&excluido_em=is.null&data=eq.${DIA}&titulo=like.*${RUN}*&select=id,titulo,responsavel_nome`)

test.describe('Pdois · agenda comercial: editar não duplica, excluído some, responsável com nome', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-agenda-defeitos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('criar, editar (mesmo evento) e excluir (some da agenda)', async () => {
    const criar = await chamar('POST', 'rpc/fn_agendamento_criar', {
      p_company_id: DEMO_AG, p_origem: 'comercial', p_titulo: `E2E reunião ${RUN}`, p_cliente_id: null, p_cliente_nome: null,
      p_responsavel_id: null, p_responsavel_nome: 'Robô E2E', p_data: DIA, p_hora_inicio: '09:00', p_hora_fim: '10:00',
      p_dados: {}, p_observacao: null,
    })
    expect(criar.status, JSON.stringify(criar.corpo)).toBe(200)
    let lista = (await agendaDoDia()).corpo as { id: string; titulo: string; responsavel_nome: string | null }[]
    expect(lista).toHaveLength(1)
    expect(lista[0].responsavel_nome, 'evento com nome do responsável').toBe('Robô E2E')
    const id = lista[0].id

    // o MESMO caminho da tela ao salvar um evento existente
    const ed = await chamar('PATCH', `erp_agendamento?id=eq.${id}&company_id=eq.${DEMO_AG}`, { titulo: `E2E reunião ${RUN} remarcada`, hora_inicio: '14:00', hora_fim: '15:00' })
    expect(ed.status, JSON.stringify(ed.corpo)).toBe(200)
    lista = (await agendaDoDia()).corpo as { id: string; titulo: string; responsavel_nome: string | null }[]
    expect(lista, 'editar não cria outro evento').toHaveLength(1)
    expect(lista[0].id).toBe(id)
    expect(lista[0].titulo).toContain('remarcada')

    const ex = await chamar('POST', 'rpc/fn_agendamento_excluir', { p_id: id, p_motivo: `E2E ${RUN}` })
    expect(ex.status, JSON.stringify(ex.corpo)).toBe(200)
    expect(((await agendaDoDia()).corpo as unknown[]), 'excluído some da agenda').toHaveLength(0)
  })
})
