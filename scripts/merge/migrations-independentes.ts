// Independência de migrations para o LOTE da fila (CEO 16/10): decide se o SQL de uma PR candidata pode publicar na
// mesma rodada que as migrations já publicadas no lote. QUALQUER dúvida → "duvida:<motivo>" (cai para 1 por rodada).
// Uso: tsx scripts/merge/migrations-independentes.ts <candidata.sql> <ja-no-lote-1.sql> [<ja-no-lote-2.sql> ...]
// Saída (stdout): "ok" ou "duvida:<motivo>".
import { readFileSync, existsSync } from 'node:fs'

const norm = (s: string) => s.trim().replace(/"/g, '').replace(/^public\./i, '').replace(/\([\s\S]*$/, '').toLowerCase()

export interface Analise { tocados: Set<string>; criados: Set<string>; duvida: string | null; texto: string }

const tiraComentarios = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

export function analisar(sqlBruto: string): Analise {
  const texto = tiraComentarios(sqlBruto)
  const a: Analise = { tocados: new Set(), criados: new Set(), duvida: null, texto }
  if (!texto.trim()) { a.duvida = 'migration vazia ou ilegível'; return a }
  // SQL dinâmico / blocos anônimos / DO: não dá para extrair objetos com segurança
  if (/\bEXECUTE\b/i.test(texto) || /\bDO\s+(\$|LANGUAGE)/i.test(texto)) { a.duvida = 'SQL dinâmico (EXECUTE/DO)'; return a }
  // remove corpos de função ($$...$$) para separar comandos; objetos dentro do corpo contam como "tocados" por palavra
  const semCorpos = texto.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, ' $$$$ ')
  const NOME = String.raw`((?:"?[\w]+"?\.)?"?[\w]+"?)`
  const IFX = String.raw`(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`
  const cria = new RegExp(String.raw`\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:UNIQUE\s+|TEMP(?:ORARY)?\s+|MATERIALIZED\s+|RECURSIVE\s+|CONSTRAINT\s+)*(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TYPE|SEQUENCE|SCHEMA|EXTENSION|TRIGGER|POLICY|DOMAIN)\s+(?:CONCURRENTLY\s+)?${IFX}${NOME}`, 'gi')
  let m: RegExpExecArray | null
  while ((m = cria.exec(semCorpos))) {
    const tipo = m[1].toLowerCase(); const nome = norm(m[2])
    if (tipo === 'trigger' || tipo === 'policy') {
      const resto = semCorpos.slice(m.index + m[0].length, m.index + m[0].length + 400)
      const t = resto.match(new RegExp(String.raw`\bON\s+${NOME}`, 'i'))
      if (!t) { a.duvida = `${tipo} ${nome} sem tabela identificável`; return a }
      a.tocados.add(`tabela:${norm(t[1])}`); a.tocados.add(`${tipo}:${norm(t[1])}.${nome}`)
    } else if (tipo === 'index') {
      a.tocados.add(`index:${nome}`)
      const t = semCorpos.slice(m.index, m.index + 400).match(new RegExp(String.raw`\bON\s+(?:ONLY\s+)?${NOME}`, 'i'))
      if (t) a.tocados.add(`tabela:${norm(t[1])}`)
    } else {
      const k = tipo === 'view' || tipo === 'table' ? 'rel' : tipo === 'procedure' ? 'function' : tipo
      a.tocados.add(`${k}:${nome}`)
      if (/^CREATE/i.test(m[0])) a.criados.add(nome)
    }
  }
  const dml = [
    String.raw`\bINSERT\s+INTO\s+${NOME}`, String.raw`\bUPDATE\s+(?:ONLY\s+)?${NOME}\s+(?:AS\s+\w+\s+)?SET\b`,
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
    }
  }
  if (a.tocados.size === 0) a.duvida = 'nenhum objeto identificado na migration'
  return a
}

/** Palavras-identificador do texto (para detectar dependência por referência a objeto criado por outra migration). */
const palavras = (t: string) => new Set((t.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []))

export function independentes(candidata: string, lote: string[]): string {
  if (lote.length === 0) return 'ok'
  const c = analisar(candidata)
  if (c.duvida) return `duvida:candidata: ${c.duvida}`
  for (const [i, sql] of lote.entries()) {
    const o = analisar(sql)
    if (o.duvida) return `duvida:migration ${i + 1} do lote: ${o.duvida}`
    // mesmo objeto (tabela, view, função, política, trigger, tipo...)? a relação rel:/function: não é um bloco só — compara por nome puro também
    const puro = (s: Set<string>) => new Set([...s].map((x) => x.split(':').slice(1).join(':')))
    const pc = puro(c.tocados); const po = puro(o.tocados)
    const comum = [...c.tocados].filter((x) => o.tocados.has(x)).concat([...pc].filter((x) => po.has(x) && !x.includes('.')))
    if (comum.length) return `duvida:mesmo objeto em duas migrations: ${[...new Set(comum)].slice(0, 3).join(', ')}`
    // dependência: uma cita objeto CRIADO pela outra
    const pcTxt = palavras(c.texto); const poTxt = palavras(o.texto)
    const dep1 = [...o.criados].find((x) => pcTxt.has(x.split('.').pop()!))
    const dep2 = [...c.criados].find((x) => poTxt.has(x.split('.').pop()!))
    if (dep1 || dep2) return `duvida:dependência entre migrations (${dep1 ?? dep2})`
    // tocam a mesma tabela por dentro de corpo de função / referência? citar objeto tocado (não só criado) da outra
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
