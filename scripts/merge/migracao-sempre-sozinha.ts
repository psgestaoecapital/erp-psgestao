#!/usr/bin/env tsx
// SEMPRE-SOZINHA (CEO 01/11) — dentro do LOTE de migrations CRÍTICAS (a fila publica até LOTE_MIG_CRIT_MAX críticas numa
// rodada, com UM @pos-migration para o lote), as áreas de MAIOR risco publicam SOZINHAS: nunca batelam com outras
// críticas, para o veredito único do @pos do lote nunca misturar o risco delas com o de uma migration comum.
//
// FORA DO LOTE (publica sozinha), onde quer que apareça:
//   NR-36 · fiscal (NF-e/NFS-e/imposto/tributo) · financeiro de cliente · RLS/permissão/acesso · LGPD · Wealth/CVM.
// (o rótulo `conserto-main` — correção da própria quebra da main — também publica sozinho; isso é decidido na fila pela
//  label, não aqui, porque é um sinal de PROCESSO, não de conteúdo.)
//
// Fonte única das ÁREAS: QUARENTENA_CRITICOS (e2e/quarentena) — a mesma lista que o `exige-via-revisada` usa e que a
// quarentena do @pos nunca engaveta. Além do token no NOME do arquivo ou no SQL, reconhece ESTRUTURALMENTE, no SQL, os
// dois sinais do mesmo risco que nem sempre aparecem como palavra: mexer em RLS de tabela existente e mexer em DADO de
// tabela crítica (cliente/financeiro/fiscal) — via o classificador puro `migracaoCritica`.
//
// Decisão PURA e testada (scripts/gates/check-fila-lote-criticas.ts). Viés de SEGURANÇA: na presença de qualquer sinal
// → sozinha (menos batelamento, nunca mistura risco máximo num @pos de lote). Arquivos só de doc/teste/CI são ignorados.
import { readFileSync } from 'node:fs'
import { QUARENTENA_CRITICOS } from '../../e2e/quarentena'
import { migracaoCritica } from './exige-via-revisada'

export type SempreSozinha = { sozinha: boolean; motivo: string }

const SO_DOC_TESTE_CI = /^(docs\/|\.github\/|e2e\/|.*\.md$)/

// RLS/permissão em tabela que JÁ EXISTE (ligar/desligar RLS ou create/alter/drop policy sobre tabela não criada nesta
// migration). RLS numa tabela NOVA é aditivo (a própria migration a cria) e não entra aqui. Mesmo "novo" do migracaoCritica.
function tocaRlsExistente(sqlLower: string): boolean {
  const topo = sqlLower.replace(/--[^\n]*/g, ' ').replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/g, ' corpo_de_funcao ')
  const criadas = new Set<string>()
  for (const m of topo.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) criadas.add(m[1])
  for (const m of topo.matchAll(/(?:create|alter|drop)\s+policy[^;]*?\son\s+(?:public\.)?"?([a-z0-9_]+)"?/g)) if (!criadas.has(m[1])) return true
  for (const m of topo.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?[^;]*row\s+level\s+security/g)) if (!criadas.has(m[1])) return true
  return false
}

export function migracaoSempreSozinha(arquivos: string[], sql?: string): SempreSozinha {
  for (const a of arquivos) {
    const f = a.toLowerCase()
    if (SO_DOC_TESTE_CI.test(f)) continue
    const t = QUARENTENA_CRITICOS.find((k) => f.includes(k))
    if (t) return { sozinha: true, motivo: `área de risco máximo no arquivo (${t} · ${a})` }
  }
  if (sql && sql.trim()) {
    const s = sql.toLowerCase()
    const t = QUARENTENA_CRITICOS.find((k) => s.includes(k))
    if (t) return { sozinha: true, motivo: `área de risco máximo no SQL (${t})` }
    if (tocaRlsExistente(s)) return { sozinha: true, motivo: 'RLS/permissão em tabela existente' }
    const m = migracaoCritica('migration.sql', sql)
    if (m && /dado crítico/i.test(m)) return { sozinha: true, motivo: m }
  }
  return { sozinha: false, motivo: 'crítica comum — pode batelar no lote de críticas (até o teto)' }
}

async function main(): Promise<void> {
  // argv[2] = caminho do SQL da migration (opcional); stdin = um nome de arquivo do diff por linha
  const sqlPath = process.argv[2]
  let sql: string | undefined
  try { if (sqlPath) sql = readFileSync(sqlPath, 'utf8') } catch { /* sem SQL para avaliar */ }
  let txt = ''
  for await (const c of process.stdin) txt += c
  const arquivos = txt.split('\n').map((l) => l.trim()).filter(Boolean)
  process.stdout.write(JSON.stringify(migracaoSempreSozinha(arquivos, sql)))
}
if (process.argv[1] && /\/migracao-sempre-sozinha\.ts$/.test(process.argv[1])) void main()
