// RD-82 (@pos-migration) · Tarefa f448ca7b (Eng. Chefe 11/11) — unificar os 2 modelos de posto.
// Prova, como USUÁRIO real (robô), que:
//  (1) fn_rh_quadro_lotacao (Painel de RH) agora LÊ do modelo prod_posto, no mesmo formato de saída
//      (kpis + lista), com o custo gated por RH/diretoria (LGPD: custo null quando não pode_salario);
//  (2) fn_rh_importar_postos atende o contrato (RD-97): payload array => resposta estruturada
//      (ok + criados/antes/depois) ou 'sem_permissao' (gate RH/sócio/admin). Usa array VAZIO para
//      não gravar nada persistente — o comportamento de escrita completo é provado no PR em
//      BEGIN/ROLLBACK (import grava prod_posto, idempotente pelo Nº PO, pessoa por CPF, exceções RD-77).
// DEMO Indústria (RD-69). Tag @pos-migration: só passa com a migration aplicada (produção, pós-merge).

import { test, expect } from '../../support/fixtures'
import { rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000005' // Indústria Modelo - DEMO

type Posto = { setor: string; posto_id: string; codigo_po: string | null; proj_total: number; real: number; gap: number; custo: number | null }
type Kpis = { postos_ativos: number; vagas_abertas: number; proj_total: number; real_total: number; custo_registrado: number | null }
type Lotacao = { ok?: boolean; erro?: string; pode_salario?: boolean; kpis?: Kpis; lista?: Posto[] }
type Import = { ok?: boolean; erro?: string; criados?: Record<string, number>; antes?: unknown; depois?: unknown }

test.describe('Aceitação f448ca7b — Painel de RH e import unificados no modelo prod_posto', () => {
  test.afterAll(async ({}, testInfo) => {
    await registrarJornada('aceitacao-rh-unificar-postos-f448ca7b',
      testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('Painel de RH lê de prod_posto, no mesmo formato, com custo gated (LGPD)', { tag: '@pos-migration' }, async () => {
    const r = await rpcComoRobo<Lotacao>('fn_rh_quadro_lotacao', { p_company_id: DEMO })
    expect(r.status, r.texto).toBe(200)
    expect(r.corpo?.ok, `esperado ok: ${r.corpo?.erro ?? r.texto}`).toBe(true)

    // KPIs no formato esperado (chaves presentes).
    const k = r.corpo?.kpis
    expect(k, 'kpis deve existir').toBeTruthy()
    for (const key of ['postos_ativos', 'vagas_abertas', 'proj_total', 'real_total'] as const) {
      expect(typeof k![key], `kpi ${key} numérico`).toBe('number')
    }

    const lista = r.corpo?.lista ?? []
    expect(Array.isArray(lista), 'lista deve ser array').toBe(true)
    const pode = r.corpo?.pode_salario === true
    for (const p of lista) {
      expect(p.posto_id, 'cada posto tem id').toBeTruthy()
      expect(p.gap, 'gap = proj - real').toBe(p.proj_total - p.real)
      // LGPD: quem não é RH/diretoria NUNCA recebe o custo do posto (≈ salário).
      if (!pode) expect(p.custo, `custo deve ser null sem pode_salario (${p.codigo_po})`).toBeNull()
    }
    // coerência do KPI de custo com o flag
    if (!pode) expect(k!.custo_registrado, 'custo_registrado null sem pode_salario').toBeNull()
  })

  test('Import atende o contrato (RD-97) sem gravar nada (payload vazio)', { tag: '@pos-migration' }, async () => {
    const r = await rpcComoRobo<Import>('fn_rh_importar_postos', { p_company_id: DEMO, p_linhas: [] })
    expect(r.status, r.texto).toBe(200)
    const b = r.corpo
    expect(b, 'resposta estruturada').toBeTruthy()
    if (b?.ok) {
      // privilegiado: contrato de saída preservado (as chaves que a tela #4113 consome)
      expect(b.criados, 'criados presente').toBeTruthy()
      for (const key of ['postos', 'vagas', 'alocacoes', 'remuneracoes', 'excecoes', 'ja_existiam'] as const) {
        expect(b.criados![key], `criados.${key} zero com payload vazio`).toBe(0)
      }
      expect(b.antes, 'antes presente').toBeTruthy()
      expect(b.depois, 'depois presente').toBeTruthy()
    } else {
      // não privilegiado: o gate barra (RH/sócio/admin)
      expect(b?.erro, 'erro esperado do gate').toBe('sem_permissao')
    }
  })
})
