// #587 (Frioeste · CEO 04/10): dia com menos pausas do que a jornada pedia vira pendente (pausas_faltantes), nunca conforme.
// Migration 20261005000000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO. Só leitura, sem CPF.
// Invariante válida antes e depois da reapuração: toda linha com motivo pausas_faltantes tem realizado < devido e está
// pendente_confirmacao; nenhuma linha ganhou motivo novo fora do parâmetro de almoço.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

type Linha = { status: string; devido_min: number; realizado_min: number; detalhe: { sem_dado_motivo?: string | null } }

test.describe('NR-36: pausas faltantes não saem conforme (#587)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nr36-almoco-587', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('pausas_faltantes é sempre pendente com realizado < devido @pos-migration', async () => {
    const linhas = await dbSelect<Linha>('nr36_pausa_apurada', `detalhe->>sem_dado_motivo=eq.pausas_faltantes&select=status,devido_min,realizado_min,detalhe&limit=500`)
    for (const l of linhas) {
      expect(l.status).toBe('pendente_confirmacao')
      expect(l.realizado_min).toBeLessThan(l.devido_min)
    }
  })

  test('nenhum dia pendente por pausas_faltantes aparece como conforme @pos-migration', async () => {
    const conformes = await dbSelect<Linha>('nr36_pausa_apurada', `status=eq.conforme&detalhe->>sem_dado_motivo=eq.pausas_faltantes&select=status&limit=1`)
    expect(conformes.length).toBe(0)
  })
})
