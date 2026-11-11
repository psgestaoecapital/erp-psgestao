// RD-82 (@pos-migration) · Tarefa 029fd118 (decisão 2 · exibição do custo com LGPD, CEO 06/11).
// fn_rh_quadro_custo agrega o custo de MO do QUADRO (prod_posto/prod_posto_custo) por
// setor|centro|supervisor com k-anonimato: para quem NÃO é RH/diretoria, grupo com <3 pessoas
// é somado em "Apoio (menos de 3 pessoas)" e o custo médio (≈ salário) só sai com >=3 pessoas.
// Fail-closed: empresa sem acesso => sem_acesso; agrupar inválido => agrupar_invalido.
// Chamado como USUÁRIO real (JWT do robô), nunca service_role. DEMO Indústria (RD-69).
// Tag @pos-migration: só passa com a migration aplicada (produção, pós-merge) — informativo no preview.

import { test, expect } from '../../support/fixtures'
import { rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000005' // Indústria Modelo - DEMO
const SEM_ACESSO = '00000000-0000-4000-a000-0000000000ff' // empresa fictícia (robô não tem)

type Grupo = { grupo: string; pessoas: number; custo_total: number; custo_medio: number | null }
type Resp = { ok?: boolean; erro?: string; agrupar?: string; pode_detalhe?: boolean; grupos?: Grupo[] }

test.describe('Aceitação 029fd118 dec.2 — custo do quadro por setor/centro/supervisor com LGPD', () => {
  test.afterAll(async ({}, testInfo) => {
    await registrarJornada('aceitacao-rh-quadro-custo-029fd118',
      testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('agrega por setor e respeita o k-anonimato (k>=3)', { tag: '@pos-migration' }, async () => {
    const r = await rpcComoRobo<Resp>('fn_rh_quadro_custo', { p_company_id: DEMO, p_agrupar: 'setor' })
    expect(r.status, r.texto).toBe(200)
    expect(r.corpo?.ok, `esperado ok: ${r.corpo?.erro ?? r.texto}`).toBe(true)
    expect(r.corpo?.agrupar).toBe('setor')
    const grupos = r.corpo?.grupos ?? []
    expect(grupos.length, 'o quadro da DEMO Indústria deve ter ao menos um setor com custo').toBeGreaterThan(0)

    const pode = r.corpo?.pode_detalhe === true
    for (const g of grupos) {
      expect(g.pessoas, `grupo ${g.grupo} deve ter contagem de pessoas`).toBeGreaterThanOrEqual(0)
      // INVARIANTE LGPD: sem detalhe, nenhum grupo exposto pode ter <3 pessoas e custo médio só com >=3
      if (!pode) {
        expect(g.pessoas, `LGPD: sem detalhe nenhum grupo pode ter <3 pessoas (${g.grupo})`).toBeGreaterThanOrEqual(3)
        if (g.custo_medio !== null) {
          expect(g.pessoas, `LGPD: custo médio só com >=3 pessoas (${g.grupo})`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  test('agrupar inválido e empresa sem acesso são barrados (fail-closed)', { tag: '@pos-migration' }, async () => {
    const inv = await rpcComoRobo<Resp>('fn_rh_quadro_custo', { p_company_id: DEMO, p_agrupar: 'xpto' })
    expect(inv.corpo?.ok, 'agrupar inválido deve falhar').toBe(false)
    expect(inv.corpo?.erro).toBe('agrupar_invalido')

    const neg = await rpcComoRobo<Resp>('fn_rh_quadro_custo', { p_company_id: SEM_ACESSO, p_agrupar: 'setor' })
    expect(neg.corpo?.ok, 'empresa sem acesso deve falhar').toBe(false)
    expect(neg.corpo?.erro).toBe('sem_acesso')
  })
})
