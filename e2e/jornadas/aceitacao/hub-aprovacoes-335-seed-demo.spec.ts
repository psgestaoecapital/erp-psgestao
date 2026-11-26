// Hub · tela 335 "Minhas aprovações" — prova que o SEED SÓ-DEMO da cadeia de aprovação
// de medição (migration 20261127180045) chegou à produção e deixa a tela auditável.
//
// Contexto (auditoria auditor_pdca_1 26/11): a jornada aprovar/devolver não podia ser provada
// porque projetos_obra_medicao_etapa tinha 0 linhas em TODA empresa — a tela só mostrava o
// estado vazio. O seed garante, na DEMO Construtora (006), 3 medições com a cadeia INICIADA e
// a etapa atual PENDENTE em etapas distintas (engenharia, gestão de pessoas, diretoria), que é
// exatamente o que fn_obra_medicao_etapa_minhas_pendentes (fonte da tela) devolve: linhas com
// decisao IS NULL da empresa.
//
// Depende da migration → @pos-migration (no preview roda informativo; veredito na main pós-deploy).
// Não cria nem apaga nada: só LÊ o dado semeado (idempotente e permanente na DEMO).

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_006 = 'b0700000-0000-4000-a000-000000000006' // DEMO Construtora

const MED_IDS = [
  'd5e00335-0000-4000-a000-000000000001',
  'd5e00335-0000-4000-a000-000000000002',
  'd5e00335-0000-4000-a000-000000000003',
]
const ETAPA_PENDENTE_IDS = [
  'd5e00335-0e00-4000-a000-000000000013', // engenharia
  'd5e00335-0e00-4000-a000-000000000024', // gestao_pessoas
  'd5e00335-0e00-4000-a000-000000000035', // diretoria
]

type Etapa = { id: string; etapa: string; decisao: string | null; company_id: string; medicao_id: string }
type Medicao = { id: string; numero: number; status: string; excluido_em: string | null }
type Receber = { id: string }

test.describe('Hub · tela 335 — seed DEMO da cadeia de aprovação de medição', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada(
      'aceitacao-hub-aprovacoes-335-seed-demo',
      testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho',
      testInfo.title,
    )
  })

  test('as 3 medições e as etapas pendentes distintas existem na DEMO 006', { tag: '@pos-migration' }, async () => {
    // Medições semeadas (status rascunho, não excluídas).
    const meds = await dbSelect<Medicao>(
      'projetos_obra_medicao',
      `id=in.(${MED_IDS.join(',')})&select=id,numero,status,excluido_em`,
    )
    expect(meds.length, 'as 3 medições DEMO do seed existem').toBe(3)
    for (const m of meds) {
      expect(m.status, `medição ${m.numero} fica em rascunho (não gera receber)`).toBe('rascunho')
      expect(m.excluido_em, `medição ${m.numero} não está excluída`).toBeNull()
    }

    // Etapas atuais PENDENTES (decisao IS NULL) — o que a tela 335 exibe como cartão.
    const etapas = await dbSelect<Etapa>(
      'projetos_obra_medicao_etapa',
      `id=in.(${ETAPA_PENDENTE_IDS.join(',')})&select=id,etapa,decisao,company_id,medicao_id`,
    )
    expect(etapas.length, 'as 3 etapas pendentes do seed existem').toBe(3)
    for (const e of etapas) {
      expect(e.decisao, `etapa ${e.etapa} está pendente (decisao NULL)`).toBeNull()
      expect(e.company_id, 'etapa pertence à DEMO 006').toBe(DEMO_006)
    }
    const etapasDistintas = [...new Set(etapas.map((e) => e.etapa))].sort()
    expect(etapasDistintas, 'etapas pendentes em 3 etapas distintas da cadeia').toEqual(
      ['diretoria', 'engenharia', 'gestao_pessoas'],
    )

    // RD-38: nenhuma destas medições gerou título a receber (status rascunho não dispara o trigger).
    const receber = await dbSelect<Receber>(
      'erp_receber',
      `ref_externa_sistema=eq.obra_medicao&ref_externa_id=in.(${MED_IDS.join(',')})&status=neq.cancelado&select=id`,
    )
    expect(receber.length, 'seed não cria título em erp_receber').toBe(0)
  })

  test('a empresa DEMO 006 tem ao menos 3 etapas pendentes para a tela listar', { tag: '@pos-migration' }, async () => {
    const pendentes = await dbSelect<Etapa>(
      'projetos_obra_medicao_etapa',
      `company_id=eq.${DEMO_006}&decisao=is.null&select=id,etapa`,
    )
    expect(
      pendentes.length,
      'tela 335 passa a ter cartões reais (decisao IS NULL) na DEMO 006',
    ).toBeGreaterThanOrEqual(3)
  })
})
