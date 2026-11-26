// Independência de migrations para o LOTE da fila (CEO 16/10): decide se o SQL de uma PR candidata pode publicar na
// mesma rodada que as migrations já publicadas no lote. QUALQUER dúvida → "duvida:<motivo>" (cai para 1 por rodada).
// Uso: tsx scripts/merge/migrations-independentes.ts <candidata.sql> <ja-no-lote-1.sql> [<ja-no-lote-2.sql> ...]
// Saída (stdout): "ok" ou "duvida:<motivo>".
//
// CATÁLOGO ADITIVO POR CHAVE (CEO 24/11): migrations que SÓ inserem chaves DIFERENTES numa tabela de catálogo puramente
// aditiva (hoje erp_ajuda_campo, o texto do "?" da RD-95) são INDEPENDENTES — não devem cair para 1/rodada só porque
// ambas tocam a mesma tabela. Antes, as duas recebiam `rel:erp_ajuda_campo` e colidiam, forçando SOLO: era o que
// segurava o backlog de telas de P&M. Agora, INSERT-só numa tabela do catálogo vira `ajuda:<tab>:<chave>` e só colide
// na MESMA chave. Viés de segurança preservado: QUALQUER coisa fora de INSERT-literal (UPDATE/DELETE/TRUNCATE/ALTER/
// DROP/GRANT na tabela, INSERT..SELECT, chave fora da 1ª coluna, literal não extraível) volta ao conservador (rel:) e
// cai para 1/rodada, como antes. Uma migration que ALTERA o catálogo e outra que INSERE chave nele → dependência.
import { readFileSync, existsSync } from 'node:fs'
const norm = (s: string) => s.trim().replace(/"/g, '').replace(/^public\./i, '').replace(/\([\s\S]*$/, '').toLowerCase()
export interface Analise { tocados: Set<string>; criados: Set<string>; duvida: string | null; texto: string }
const tiraComentarios = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

// Tabelas de catálogo puramente ADITIVAS por chave: duas migrations que só INSERem CHAVES DIFERENTES nelas são
// independentes. Só vale com INSERT (nada estrutural/UPDATE/DELETE/TRUNCATE/GRANT na tabela) e chaves extraíveis como
// literais, com `chave` na 1ª coluna da lista explícita. Qualquer dúvida → trata como objeto comum (rel:), como hoje.
const CATALOGO_ADITIVO = new Set(['erp_ajuda_campo'])

// Extrai os literais da 1ª coluna (`chave`) de um INSERT no catálogo. null = não dá para extrair com segurança (→ rel:).
// Cobre as DUAS formas idempotentes reais da RD-95 (provado contra as ~890 migrations de ajuda do repo):
//   (A) INSERT (chave, ...) VALUES ('k1',...),('k2',...) [ON CONFLICT (chave) DO NOTHING] ;
//   (B) INSERT (chave, ...) SELECT <proj> FROM (VALUES ('k1',...),...) AS alias(chave, ...) [WHERE NOT EXISTS ...]
// A forma crua `INSERT (chave,...) VALUES (...)` SEM cláusula idempotente também é coberta. QUALQUER desvio → null:
// coluna `chave` fora do 1º lugar (INSERT ou alias do VALUES), 1ª coluna da tupla não é literal string, ON CONFLICT
// DO UPDATE (muda linha existente), RETURNING/outra cláusula, INSERT..SELECT de uma tabela (não de VALUES), etc.
const soCol = (c: string) => (c ?? '').trim().replace(/"/g, '').toLowerCase()
const pulaWs = (sql: string, i: number) => { while (i < sql.length && /\s/.test(sql[i])) i++; return i }

// Lê uma lista entre parênteses a partir de sql[i]==='(' (colunas do INSERT ou do alias) → {cols, next} | null.
function lerLista(sql: string, i: number): { cols: string[]; next: number } | null {
  const n = sql.length
  if (sql[i] !== '(') return null
  i++
  let depth = 1, buf = ''
  const cols: string[] = []
  while (i < n && depth > 0) {
    const ch = sql[i]
    if (ch === "'") { buf += ch; i++; while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue } buf += sql[i]; if (sql[i] === "'") { i++; break } i++ }; continue }
    if (ch === '(') { depth++; buf += ch; i++; continue }
    if (ch === ')') { depth--; if (depth === 0) { i++; break } buf += ch; i++; continue }
    if (ch === ',' && depth === 1) { cols.push(buf.trim()); buf = ''; i++; continue }
    buf += ch; i++
  }
  if (depth !== 0) return null
  if (buf.trim()) cols.push(buf.trim())
  return { cols, next: i }
}

// Lê tuplas VALUES a partir de sql[i] (espera '('…). A 1ª coluna de CADA tupla tem de ser literal string → devolve-as.
// Para quando o próximo token (após espaços/vírgulas) não for '('. null se alguma tupla não começar com literal.
function lerTuplas(sql: string, i: number): { keys: string[]; next: number } | null {
  const n = sql.length
  const keys: string[] = []
  while (i < n) {
    while (i < n && /[\s,]/.test(sql[i])) i++
    if (i >= n || sql[i] !== '(') break
    i++
    while (i < n && /\s/.test(sql[i])) i++
    if (sql[i] !== "'") return null
    i++
    let k = ''
    while (i < n) {
      if (sql[i] === "'" && sql[i + 1] === "'") { k += "'"; i += 2; continue }
      if (sql[i] === "'") { i++; break }
      k += sql[i++]
    }
    keys.push(k)
    let depth = 1
    while (i < n && depth > 0) {
      const ch = sql[i]
      if (ch === "'") { i++; while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue } if (sql[i] === "'") { i++; break } i++ }; continue }
      if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
    if (depth !== 0) return null
  }
  return keys.length ? { keys, next: i } : null
}

// Índice da próxima palavra-chave kw em profundidade 0 (fora de strings/parênteses) a partir de start; -1 se não achar.
function acharTop(sql: string, start: number, kw: string): number {
  const n = sql.length
  const re = new RegExp(`^${kw}\\b`, 'i')
  let i = start, depth = 0
  while (i < n) {
    const ch = sql[i]
    if (ch === "'") { i++; while (i < n) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue } if (sql[i] === "'") { i++; break } i++ }; continue }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') { depth--; i++; continue }
    if (depth === 0 && (i === start || /[\s)]/.test(sql[i - 1])) && re.test(sql.slice(i))) return i
    i++
  }
  return -1
}

function extrairChaves(sql: string, apartirDe: number): string[] | null {
  const n = sql.length
  let i = pulaWs(sql, apartirDe)
  // lista de colunas do INSERT (obrigatória; `chave` tem de ser a 1ª)
  if (sql[i] !== '(') return null
  const cl = lerLista(sql, i)
  if (!cl || soCol(cl.cols[0]) !== 'chave') return null
  i = pulaWs(sql, cl.next)

  // ── forma A: VALUES (...),(...) [ON CONFLICT ... DO NOTHING] ;
  if (/^VALUES\b/i.test(sql.slice(i))) {
    i += 'VALUES'.length
    const t = lerTuplas(sql, i)
    if (!t) return null
    i = pulaWs(sql, t.next)
    if (i >= n || sql[i] === ';') return t.keys
    const resto = sql.slice(i)
    if (!/^ON\s+CONFLICT\b/i.test(resto)) return null // RETURNING / outra cláusula → conservador
    const clausula = resto.split(';')[0]
    if (/\bDO\s+UPDATE\b/i.test(clausula)) return null // muda linha existente → conservador
    if (/\bDO\s+NOTHING\b/i.test(clausula)) return t.keys
    return null
  }

  // ── forma B: SELECT <proj> FROM (VALUES (...),...) AS alias(chave, ...) [WHERE ...]
  if (/^SELECT\b/i.test(sql.slice(i))) {
    const projStart = pulaWs(sql, i + 'SELECT'.length)
    const fromIdx = acharTop(sql, projStart, 'FROM')
    if (fromIdx < 0) return null
    const p0 = soCol(sql.slice(projStart, fromIdx).split(',')[0]) // 1ª coluna projetada → tem de mapear p/ `chave`
    if (!(p0 === '*' || p0 === 'chave' || p0.endsWith('.chave'))) return null
    let j = pulaWs(sql, fromIdx + 'FROM'.length)
    if (sql[j] !== '(') return null // o FROM tem de ser a subconsulta (VALUES ...)
    j = pulaWs(sql, j + 1)
    if (!/^VALUES\b/i.test(sql.slice(j))) return null
    j += 'VALUES'.length
    const t = lerTuplas(sql, j)
    if (!t) return null
    j = pulaWs(sql, t.next)
    if (sql[j] !== ')') return null // fecha a subconsulta (VALUES ...)
    j = pulaWs(sql, j + 1)
    if (/^AS\b/i.test(sql.slice(j))) j = pulaWs(sql, j + 2)
    const mAlias = sql.slice(j).match(/^[a-z_]\w*/i) // alias obrigatório + lista de colunas com `chave` em 1º
    if (!mAlias) return null
    j = pulaWs(sql, j + mAlias[0].length)
    const al = lerLista(sql, j)
    if (!al || soCol(al.cols[0]) !== 'chave') return null
    return t.keys
  }
  return null
}

export function analisar(sqlBruto: string): Analise {
  const texto = tiraComentarios(sqlBruto)
  const a: Analise = { tocados: new Set(), criados: new Set(), duvida: null, texto }
  if (!texto.trim()) { a.duvida = 'migration vazia ou ilegível'; return a }
  if (/\bEXECUTE\b/i.test(texto) || /\bDO\s+(\$|LANGUAGE)/i.test(texto)) { a.duvida = 'SQL dinâmico (EXECUTE/DO)'; return a }
  const semCorpos = texto.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, ' $$$$ ')
  const NOME = String.raw`((?:"?[\w]+"?\.)?"?[\w]+"?)`
  const IFX = String.raw`(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`
  const catChaves = new Map<string, Set<string>>()
  const catSujo = new Set<string>()
  const cria = new RegExp(String.raw`\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:UNIQUE\s+|TEMP(?:ORARY)?\s+|MATERIALIZED\s+|RECURSIVE\s+|CONSTRAINT\s+)*(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TYPE|SEQUENCE|SCHEMA|EXTENSION|TRIGGER|POLICY|DOMAIN)\s+(?:CONCURRENTLY\s+)?${IFX}${NOME}`, 'gi')
  let m: RegExpExecArray | null
  while ((m = cria.exec(semCorpos))) {
    const tipo = m[1].toLowerCase(); const nome = norm(m[2])
    if (tipo === 'trigger' || tipo === 'policy') {
      const resto = semCorpos.slice(m.index + m[0].length, m.index + m[0].length + 400)
      const t = resto.match(new RegExp(String.raw`\bON\s+${NOME}`, 'i'))
      if (!t) { a.duvida = `${tipo} ${nome} sem tabela identificável`; return a }
      a.tocados.add(`tabela:${norm(t[1])}`); a.tocados.add(`${tipo}:${norm(t[1])}.${nome}`)
      if (CATALOGO_ADITIVO.has(norm(t[1]))) catSujo.add(norm(t[1]))
    } else if (tipo === 'index') {
      a.tocados.add(`index:${nome}`)
      const t = semCorpos.slice(m.index, m.index + 400).match(new RegExp(String.raw`\bON\s+(?:ONLY\s+)?${NOME}`, 'i'))
      if (t) { a.tocados.add(`tabela:${norm(t[1])}`); if (CATALOGO_ADITIVO.has(norm(t[1]))) catSujo.add(norm(t[1])) }
    } else {
      const k = tipo === 'view' || tipo === 'table' ? 'rel' : tipo === 'procedure' ? 'function' : tipo
      a.tocados.add(`${k}:${nome}`)
      if (/^CREATE/i.test(m[0])) a.criados.add(nome)
      if (CATALOGO_ADITIVO.has(nome)) catSujo.add(nome)
    }
  }
  // INSERT: caso especial p/ catálogo aditivo
  {
    const r = new RegExp(String.raw`\bINSERT\s+INTO\s+${NOME}`, 'gi')
    while ((m = r.exec(semCorpos))) {
      const nome = norm(m[1])
      if (CATALOGO_ADITIVO.has(nome)) {
        const chaves = extrairChaves(semCorpos, m.index + m[0].length)
        if (chaves) { const s = catChaves.get(nome) ?? new Set<string>(); chaves.forEach((k) => s.add(k)); catChaves.set(nome, s) }
        else { catSujo.add(nome) }
      } else a.tocados.add(`rel:${nome}`)
    }
  }
  const dml = [
    String.raw`\bUPDATE\s+(?:ONLY\s+)?${NOME}\s+(?:AS\s+\w+\s+)?SET\b`,
    String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?${NOME}`, String.raw`\bTRUNCATE\s+(?:TABLE\s+)?${NOME}`,
    String.raw`\bCOMMENT\s+ON\s+(?:TABLE|VIEW|COLUMN|FUNCTION|MATERIALIZED\s+VIEW)\s+${NOME}`,
    String.raw`\b(?:GRANT|REVOKE)\b[^;]*?\bON\s+(?:TABLE\s+|FUNCTION\s+|ALL\s+\w+\s+IN\s+SCHEMA\s+)?${NOME}`,
  ]
  for (const re of dml) {
    const r = new RegExp(re, 'gi')
    while ((m = r.exec(semCorpos))) {
      let nome = norm(m[1])
      if (/^COMMENT ON COLUMN/i.test(m[0])) nome = nome.replace(/\.[^.]+$/, '')
      a.tocados.add(`rel:${nome}`)
      if (CATALOGO_ADITIVO.has(nome)) catSujo.add(nome)
    }
  }
  // fecha o catálogo: chave-a-chave se limpo; senão rel: conservador
  for (const [tab, keys] of catChaves) {
    if (catSujo.has(tab)) { a.tocados.add(`rel:${tab}`); continue }
    for (const k of keys) a.tocados.add(`ajuda:${tab}:${k}`)
  }
  for (const tab of catSujo) if (!catChaves.has(tab)) a.tocados.add(`rel:${tab}`)
  if (a.tocados.size === 0) a.duvida = 'nenhum objeto identificado na migration'
  return a
}
const palavras = (t: string) => new Set((t.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []))
export function independentes(candidata: string, lote: string[]): string {
  if (lote.length === 0) return 'ok'
  const c = analisar(candidata)
  if (c.duvida) return `duvida:candidata: ${c.duvida}`
  for (const [i, sql] of lote.entries()) {
    const o = analisar(sql)
    if (o.duvida) return `duvida:migration ${i + 1} do lote: ${o.duvida}`
    const puro = (s: Set<string>) => new Set([...s].map((x) => x.split(':').slice(1).join(':')))
    const pc = puro(c.tocados); const po = puro(o.tocados)
    const comum = [...c.tocados].filter((x) => o.tocados.has(x)).concat([...pc].filter((x) => po.has(x) && !x.includes('.')))
    if (comum.length) return `duvida:mesmo objeto em duas migrations: ${[...new Set(comum)].slice(0, 3).join(', ')}`
    // catálogo aditivo: um lado ALTERA/DML (rel:tab) e o outro INSERE chave (ajuda:tab:*) no mesmo catálogo → dependência
    for (const tab of CATALOGO_ADITIVO) {
      const cRel = c.tocados.has(`rel:${tab}`), oRel = o.tocados.has(`rel:${tab}`)
      const cAj = [...c.tocados].some((x) => x.startsWith(`ajuda:${tab}:`))
      const oAj = [...o.tocados].some((x) => x.startsWith(`ajuda:${tab}:`))
      if ((cRel && oAj) || (oRel && cAj)) return `duvida:catálogo ${tab}: uma migration o altera e a outra insere chave`
    }
    const pcTxt = palavras(c.texto); const poTxt = palavras(o.texto)
    const dep1 = [...o.criados].find((x) => pcTxt.has(x.split('.').pop()!))
    const dep2 = [...c.criados].find((x) => poTxt.has(x.split('.').pop()!))
    if (dep1 || dep2) return `duvida:dependência entre migrations (${dep1 ?? dep2})`
    const citado = [...o.tocados].map((x) => x.split(':').slice(1).join(':')).filter((x) => !x.includes('.')).find((x) => pcTxt.has(x) && x.length > 3)
    if (citado) return `duvida:a candidata cita objeto tocado por outra migration do lote (${citado})`
  }
  return 'ok'
}

if (process.argv[1]?.endsWith('migrations-independentes.ts')) {
  const [cand, ...lote] = process.argv.slice(2)
  const ler = (p: string) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '')
  console.log(independentes(ler(cand), lote.map(ler)))
}
