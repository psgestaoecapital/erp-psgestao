#!/usr/bin/env tsx
// Relatório de IMPACTO do item A (CEO 25/11): roda o classificador de criticidade (migracao-criticidade.ts) e o de
// SOLO (critica-solo.ts) sobre as PRs revisadas COM migration, para mostrar quantas, com o item A, passam a bater como
// ADITIVA (não esperam o @pos) × continuam CRÍTICAS BATELÁVEIS × continuam CRÍTICAS SOLO.
//
// Entrada: um arquivo JSON [{ "pr": <n>, "arquivo": "<nome da migration>", "sql": "<conteúdo>" }] (sql pode vir vazio →
// conta como ilegível → crítica, viés de segurança). Em CI (com gh) dá para montar a lista com:
//   gh pr list --label revisao-eng-chefe --state open --json number
//   gh api repos/$REPO/pulls/<n>/files  (pegar a(s) migration(s) e o patch)
// Uso: npx tsx scripts/merge/classificar-fila-criticas.ts lista.json
import { readFileSync } from 'node:fs'
import { migracaoCriticidade } from './migracao-criticidade'
import { soCatalogo } from './migracao-catalogo'
import { criticaSolo } from './critica-solo'

type Entrada = { pr: number; arquivo?: string; sql?: string }
type Faixa = 'aditiva' | 'critica-batelavel' | 'critica-solo'
type Saida = { pr: number; faixa: Faixa; motivo: string }

// Espelha a ORDEM da fila: 1) soCatalogo (ajuda/metadado) → aditiva; 2) item A (migracaoCriticidade por conteúdo);
// 3) se crítica, criticaSolo separa SOLO (fiscal/financeiro/RLS/NR-36/LGPD) de BATELÁVEL.
export function classificar(e: Entrada): Saida {
  const nome = e.arquivo ?? `migration-${e.pr}.sql`
  const sql = e.sql ?? ''
  if (soCatalogo(sql).catalogo) return { pr: e.pr, faixa: 'aditiva', motivo: 'só catálogo de ajuda/metadado (1ª trava da fila)' }
  const crit = migracaoCriticidade(sql, nome)
  if (!crit.critica) return { pr: e.pr, faixa: 'aditiva', motivo: crit.motivo }
  const solo = criticaSolo([{ nome, conteudo: sql }])
  return { pr: e.pr, faixa: solo.solo ? 'critica-solo' : 'critica-batelavel', motivo: solo.solo ? solo.motivo : crit.motivo }
}

if (process.argv[1] && /\/classificar-fila-criticas\.ts$/.test(process.argv[1])) {
  const arq = process.argv[2]
  if (!arq) { console.error('uso: classificar-fila-criticas.ts <lista.json>'); process.exit(2) }
  const entradas = JSON.parse(readFileSync(arq, 'utf8')) as Entrada[]
  const saidas = entradas.map(classificar)
  const conta = { aditiva: 0, 'critica-batelavel': 0, 'critica-solo': 0 } as Record<Faixa, number>
  for (const s of saidas) conta[s.faixa]++
  for (const s of saidas.sort((a, b) => a.pr - b.pr)) console.log(`#${s.pr}\t${s.faixa}\t${s.motivo}`)
  const tot = saidas.length
  console.log(`\n── RESUMO (${tot} PRs revisadas com migration) ──`)
  console.log(`ADITIVA (não espera o @pos, batela como aditiva): ${conta.aditiva} (${((conta.aditiva / tot) * 100).toFixed(0)}%)`)
  console.log(`CRÍTICA BATELÁVEL (lote de críticas, 1 @pos p/ o lote): ${conta['critica-batelavel']}`)
  console.log(`CRÍTICA SOLO (1 por @pos — fiscal/financeiro/RLS/NR-36/LGPD): ${conta['critica-solo']}`)
  console.log(`ANTES do item A, as ${tot} eram tratadas como CRÍTICAS (pela etiqueta).`)
}
