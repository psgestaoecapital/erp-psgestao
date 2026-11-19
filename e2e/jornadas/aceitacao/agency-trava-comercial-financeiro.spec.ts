// P&M (CEO 18/11, Parte B): o contrato só vai ao financeiro quando os obrigatórios estão completos — cliente COM
// documento, ao menos 1 serviço e valor+forma (recorrente: fee+dia; projeto: valor+parcelas). fn_agency_contrato_
// solicitar_financeiro devolve `faltando: [...]` e BLOQUEIA; completo → gera erp_contratos 'solicitado'. Cobre projeto.
// @pos-migration: coluna numero_parcelas e a trava só existem após o deploy. DEMO (RD-69), self-cleaning.
import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbSelect, dbPatch, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

type Sol = { ok: boolean; erro?: string; faltando?: string[]; tipo?: string }

test.describe('P&M · trava comercial→financeiro @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agency-trava-comercial-financeiro', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('só envia ao financeiro com cliente+documento, serviço e valor/forma (recorrente e projeto)', async () => {
    const tag = Date.now()
    // Documento ÚNICO por execução (só preparação): o CNPJ fixo colidia (23505) com um órfão deixado por um run
    // que caiu antes do finally — a trava comercial→financeiro só exige o cliente TER documento, não um valor fixo.
    // erp_clientes exige unicidade do documento, não valida DV (mesmo padrão de cliente-cnpj-duplicado-guarda).
    const docCli = `9${Date.now().toString().slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`
    let ctrR = '', ctrP = '', cliSem = '', cliOk = '', erpR = '', erpP = ''
    try {
      cliSem = (await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO_REVENDA, nome_fantasia: `Sem Doc ${tag}`, razao_social: `Sem Doc ${tag}`, ativo: true })).id
      cliOk = (await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO_REVENDA, nome_fantasia: `Com Doc ${tag}`, razao_social: `Com Doc ${tag}`, cnpj_cpf: docCli, ativo: true })).id

      // RECORRENTE incompleto: cliente sem documento, sem serviço, sem fee, sem dia → BLOQUEIA
      ctrR = (await dbInsert<{ id: string }>('agency_contratos', { company_id: DEMO_REVENDA, tipo: 'recorrente', erp_cliente_id: cliSem })).id
      let r = await rpc<Sol>('fn_agency_contrato_solicitar_financeiro', { p_agency_contrato_id: ctrR })
      expect(r.ok).toBe(false)
      expect(r.faltando).toEqual(expect.arrayContaining(['cnpj_cliente', 'servico', 'fee_mensal', 'dia_vencimento']))

      // completa: cliente com documento + 1 serviço + fee + dia → PASSA e gera erp_contratos 'solicitado'
      await dbPatch('agency_contratos', `id=eq.${ctrR}`, { erp_cliente_id: cliOk, fee_mensal: 1500, dia_vencimento: 10 })
      await dbInsert('agency_contrato_itens', { company_id: DEMO_REVENDA, contrato_id: ctrR, tipo_servico: 'Gestão de redes', quantidade_contratada: 1 })
      r = await rpc<Sol>('fn_agency_contrato_solicitar_financeiro', { p_agency_contrato_id: ctrR })
      expect(r.ok).toBe(true)
      erpR = (await dbSelect<{ erp_contrato_id: string }>('agency_contratos', `id=eq.${ctrR}`))[0].erp_contrato_id
      expect(erpR).toBeTruthy()
      expect((await dbSelect<{ status: string }>('erp_contratos', `id=eq.${erpR}`))[0].status).toBe('solicitado')

      // PROJETO incompleto: sem valor_projeto e sem parcelas → BLOQUEIA (o elo passou a cobrir projeto)
      ctrP = (await dbInsert<{ id: string }>('agency_contratos', { company_id: DEMO_REVENDA, tipo: 'projeto', erp_cliente_id: cliOk })).id
      await dbInsert('agency_contrato_itens', { company_id: DEMO_REVENDA, contrato_id: ctrP, tipo_servico: 'Campanha', quantidade_contratada: 1 })
      let p = await rpc<Sol>('fn_agency_contrato_solicitar_financeiro', { p_agency_contrato_id: ctrP })
      expect(p.ok).toBe(false)
      expect(p.faltando).toEqual(expect.arrayContaining(['valor_projeto', 'parcelas']))

      // completa o projeto: valor + parcelas → PASSA e leva as parcelas ao contrato da GE
      await dbPatch('agency_contratos', `id=eq.${ctrP}`, { valor_projeto: 12000, numero_parcelas: 3 })
      p = await rpc<Sol>('fn_agency_contrato_solicitar_financeiro', { p_agency_contrato_id: ctrP })
      expect(p.ok).toBe(true)
      expect(p.tipo).toBe('projeto')
      erpP = (await dbSelect<{ erp_contrato_id: string }>('agency_contratos', `id=eq.${ctrP}`))[0].erp_contrato_id
      const ecP = (await dbSelect<{ status: string; numero_parcelas: number }>('erp_contratos', `id=eq.${erpP}`))[0]
      expect(ecP.status).toBe('solicitado')
      expect(Number(ecP.numero_parcelas)).toBe(3)
    } finally {
      for (const id of [erpR, erpP]) if (id) await dbDelete('erp_contratos', `id=eq.${id}`)
      for (const id of [ctrR, ctrP]) if (id) { await dbDelete('agency_contrato_itens', `contrato_id=eq.${id}`); await dbDelete('agency_contratos', `id=eq.${id}`) }
      for (const id of [cliSem, cliOk]) if (id) await dbDelete('erp_clientes', `id=eq.${id}`)
    }
  })
})
