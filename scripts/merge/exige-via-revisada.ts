#!/usr/bin/env tsx
// Via revisada OBRIGATÓRIA por conteúdo (CEO 12/10; furo provado na #2592: migration + tela de financeiro publicou pela via rápida).
// Antes a etiqueta `revisao-eng-chefe` só era LIDA pela esteira; ninguém a colocava. Agora o sinal vem do CONTEÚDO da PR:
// tela, cálculo, migration/SQL (RLS/GRANT/view/função) ou área crítica (financeiro, fiscal, RLS, guarda, NR-36, LGPD, Wealth).
// Usa o mesmo sinal de área crítica do escopo-aceitacao.ts (QUARENTENA_CRITICOS). Decisão PURA, testada pelo gate
// scripts/gates/check-etiqueta-automatica.ts. CLI: lê os nomes de arquivo (um por linha) em stdin e imprime
// {"revisada":true|false,"motivo":"..."}; falha de leitura = sem sinal (quem chama decide), nunca derruba a PR.
import { QUARENTENA_CRITICOS } from '../../e2e/quarentena'

export const ETIQUETA_REVISADA = 'revisao-eng-chefe'

export type ViaRevisada = { revisada: boolean; motivo: string }

const SO_DOC_TESTE_CI = /^(docs\/|\.github\/|e2e\/|.*\.md$)/
const TELA = /^src\/(app|components)\/.+\.(tsx|css)$/
const CALCULO = /^src\/(lib|libs|server|utils)\/.*(calc|motor|imposto|tribut|rateio|markup|folha|dre)/

export function exigeViaRevisada(arquivos: string[]): ViaRevisada {
  for (const f0 of arquivos) {
    const f = f0.toLowerCase()
    if (f.startsWith('supabase/migrations/')) return { revisada: true, motivo: `migration (${f0})` }
    if (f.endsWith('.sql')) return { revisada: true, motivo: `SQL — RLS/GRANT/view/função (${f0})` }
    if (SO_DOC_TESTE_CI.test(f)) continue
    if (QUARENTENA_CRITICOS.some((c) => f.includes(c))) return { revisada: true, motivo: `área crítica (${f0})` }
    if (TELA.test(f)) return { revisada: true, motivo: `tela (${f0})` }
    if (CALCULO.test(f)) return { revisada: true, motivo: `cálculo (${f0})` }
    if (f.startsWith('supabase/functions/')) return { revisada: true, motivo: `edge function (${f0})` }
  }
  return { revisada: false, motivo: 'sem tela, cálculo, migration/SQL nem área crítica — via rápida' }
}

async function main(): Promise<void> {
  let txt = ''
  for await (const c of process.stdin) txt += c
  const arquivos = txt.split('\n').map((s) => s.trim()).filter(Boolean)
  process.stdout.write(JSON.stringify(exigeViaRevisada(arquivos)))
}

if (process.argv[1] && /\/exige-via-revisada\.ts$/.test(process.argv[1])) void main()
