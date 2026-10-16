/**
 * Lote de migrations INDEPENDENTES por rodada da fila (CEO 16/10 12:30).
 * Conservador de propósito: qualquer dúvida => NÃO independentes => cai para 1 migration por rodada.
 *   echo '[{"n":1,"versao":"...","sql":"..."},...]' | tsx scripts/merge/lote-migrations.ts  -> {"lote":[n...]}
 * Independente = nenhuma toca (CREATE/ALTER/DROP/COMMENT/GRANT/REVOKE/POLICY/TRIGGER/INSERT/UPDATE/DELETE) um objeto
 * que a outra cita em QUALQUER ponto do texto (cobre mesmo objeto e dependência), versões estritamente crescentes.
 */
import { readFileSync } from 'node:fs'

export type Mig = { n: number; versao: string; sql: string }

const sem_comentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
const norm = (id: string) => id.replace(/"/g, '').replace(/^public\./i, '').toLowerCase()
const ID = '((?:"?[a-zA-Z_][\\w$]*"?\\.)?"?[a-zA-Z_][\\w$]*"?)'

/** Objetos que a migration cria/altera/apaga/comenta/concede/escreve. */
export function objetosTocados(sqlBruto: string): Set<string> {
  const sql = sem_comentarios(sqlBruto)
  const out = new Set<string>()
  const pad: RegExp[] = [
    new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:unique\\s+)?(?:temp(?:orary)?\\s+|materialized\\s+|recursive\\s+)*(?:table|view|function|procedure|type|index|sequence|trigger|policy|extension|schema)\\s+(?:if\\s+not\\s+exists\\s+)?${ID}`, 'gi'),
    new RegExp(`\\balter\\s+(?:table|view|function|procedure|type|index|sequence|policy|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${ID}`, 'gi'),
    new RegExp(`\\bdrop\\s+(?:table|view|function|procedure|type|index|sequence|trigger|policy|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?${ID}`, 'gi'),
    new RegExp(`\\bcomment\\s+on\\s+\\w+(?:\\s+\\w+)?\\s+${ID}`, 'gi'),
    new RegExp(`\\b(?:grant|revoke)\\b[^;]*?\\bon\\s+(?:table\\s+|function\\s+|sequence\\s+|all\\s+\\w+\\s+in\\s+schema\\s+)?${ID}`, 'gi'),
    new RegExp(`\\binsert\\s+into\\s+${ID}`, 'gi'),
    new RegExp(`\\bupdate\\s+(?:only\\s+)?${ID}\\s+(?:as\\s+\\w+\\s+)?set\\b`, 'gi'),
    new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?${ID}`, 'gi'),
    new RegExp(`\\btruncate\\s+(?:table\\s+)?${ID}`, 'gi'),
    new RegExp(`\\bcreate\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?\\S+\\s+on\\s+${ID}`, 'gi'),
    new RegExp(`\\bcreate\\s+policy\\s+\\S+\\s+on\\s+${ID}`, 'gi'),
    new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?trigger\\s+\\S+[\\s\\S]*?\\bon\\s+${ID}`, 'gi'),
  ]
  for (const re of pad) for (const m of sql.matchAll(re)) { const o = norm(m[1]); if (o) out.add(o) }
  return out
}

const citaObjeto = (sql: string, o: string) => {
  const nome = o.includes('.') ? o : o
  const esc = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w$])(?:public\\.)?"?${esc}"?(?![\\w$])`, 'i').test(sem_comentarios(sql))
}

export function independentes(a: Mig, b: Mig): boolean {
  const oa = objetosTocados(a.sql), ob = objetosTocados(b.sql)
  // dúvida: migration que não expõe objeto nenhum (ex.: bloco DO $$ opaco) não entra em lote
  if (oa.size === 0 || ob.size === 0) return false
  for (const o of oa) if (citaObjeto(b.sql, o)) return false
  for (const o of ob) if (citaObjeto(a.sql, o)) return false
  return true
}

/** Dado o conjunto candidato (em ordem de fila), devolve o lote: a 1ª sempre, as demais só se independentes de TODAS as já aceitas. */
export function montarLote(cands: Mig[], max = 3): number[] {
  const lote: Mig[] = []
  for (const c of cands) {
    if (lote.length >= max) break
    if (lote.length === 0) { lote.push(c); continue }
    const ult = lote[lote.length - 1]
    if (!(c.versao > ult.versao)) continue // ordem estrita e sem repetição
    if (lote.every(l => independentes(l, c))) lote.push(c)
  }
  return lote.map(l => l.n)
}

if (process.argv[1] && /lote-migrations\.ts$/.test(process.argv[1])) {
  const cands = JSON.parse(readFileSync(0, 'utf8')) as Mig[]
  console.log(JSON.stringify({ lote: montarLote(cands, Number(process.env.LOTE_MIG_MAX || 3)) }))
}
