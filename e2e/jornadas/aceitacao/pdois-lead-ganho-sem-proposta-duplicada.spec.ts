// #2078 Pdois: ganhar o lead que já tem proposta criava uma 2ª proposta zerada ("Proposta — <empresa>").
// Na Agência (P&M) - DEMO: (1) lead com proposta de R$ 1.850 → ganhar devolve ESSA proposta, ligada ao cliente, e
// não nasce outra; (2) lead sem proposta → ganhar continua gerando uma. Depende da migration 20261008180020.
// Limpeza sem apagar (RD-30): propostas e leads vão para a lixeira.

import { test, expect } from '../../support/fixtures'
import { dbInsert, dbPatch, dbSelect, registrarJornada, rpcComoRobo } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const RUN = Date.now().toString(36).toUpperCase()
const leads: string[] = []
type Prop = { id: string; cliente_id: string | null; valor_total: number }
type Ganho = { ok?: boolean; erro?: string; cliente_id?: string; proposta_id?: string }

const novoLead = async (empresa: string) => {
  const l = await dbInsert<{ id: string }>('agency_leads', { company_id: DEMO_AG, nome: 'Contato E2E', empresa, origem: 'relacionamento', etapa: 'proposta' })
  leads.push(l.id)
  return l.id
}
const propostasDoLead = (leadId: string, cliente: string) => dbSelect<Prop>('agency_propostas',
  `company_id=eq.${DEMO_AG}&deleted_at=is.null&or=(lead_id.eq.${leadId},cliente_id.eq.${cliente})&select=id,cliente_id,valor_total`)

test.describe('#2078 Pdois: ganhar o lead não duplica a proposta', { tag: '@pos-migration' }, () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-lead-ganho-proposta', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    const agora = new Date().toISOString()
    for (const id of leads) {
      await dbPatch('agency_propostas', `lead_id=eq.${id}`, { deleted_at: agora }).catch(() => {})
      await dbPatch('agency_leads', `id=eq.${id}`, { deleted_at: agora }).catch(() => {})
    }
  })

  test('lead com proposta: ganhar usa a proposta do lead e não cria outra zerada', async () => {
    const leadId = await novoLead(`E2E Ganho Com Proposta ${RUN}`)
    const prop = await dbInsert<{ id: string }>('agency_propostas', {
      company_id: DEMO_AG, lead_id: leadId, titulo: `Proposta · E2E ${RUN}`, status: 'rascunho',
      valor_total: 1850, valor_final: 1850, condicao_pagamento: 'Mensal',
      itens: [{ descricao: 'Identidade visual', quantidade: 1, valor_unitario: 1850, valor_total: 1850 }],
    })

    const r = await rpcComoRobo<Ganho>('fn_agency_lead_ganhar', { p_lead_id: leadId })
    expect(r.status, r.texto).toBe(200)
    expect(r.corpo?.ok, r.texto).toBe(true)
    expect(r.corpo?.proposta_id, 'devolve a proposta já feita no lead').toBe(prop.id)

    const lista = await propostasDoLead(leadId, r.corpo!.cliente_id!)
    expect(lista.map((p) => p.id), 'uma proposta só (nenhuma zerada a mais)').toEqual([prop.id])
    expect(lista[0].cliente_id, 'a proposta ganhou o cliente').toBe(r.corpo!.cliente_id)
    expect(Number(lista[0].valor_total)).toBe(1850)

    // ganhar de novo também não duplica
    const r2 = await rpcComoRobo<Ganho>('fn_agency_lead_ganhar', { p_lead_id: leadId })
    expect(r2.corpo?.proposta_id).toBe(prop.id)
    expect((await propostasDoLead(leadId, r.corpo!.cliente_id!)).length).toBe(1)
  })

  test('lead sem proposta: ganhar continua gerando uma', async () => {
    const leadId = await novoLead(`E2E Ganho Sem Proposta ${RUN}`)
    const r = await rpcComoRobo<Ganho>('fn_agency_lead_ganhar', { p_lead_id: leadId })
    expect(r.corpo?.ok, r.texto).toBe(true)
    const lista = await propostasDoLead(leadId, r.corpo!.cliente_id!)
    expect(lista.length, 'gerou exatamente uma').toBe(1)
    expect(lista[0].id).toBe(r.corpo!.proposta_id)
  })
})
