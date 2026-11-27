// T1 (CEO 25/11) — parser de segurança do Consultor IA: valida o SELECT que o modelo quer rodar ANTES de mandar à RPC
// public.fn_consultor_sql. É a 1ª das 5 travas; a 2ª é o papel consultor_leitor no banco (sem acesso a public, só leitura
// das views do schema consultor). Aqui exigimos:
//   - exatamente 1 comando, e tem de ser um SELECT (nada de INSERT/UPDATE/DELETE/DDL/2 comandos);
//   - só relações da camada semântica (schema consultor) — nenhuma tabela de public;
//   - funções só de uma allowlist (agregações, data, texto, matemática, coalesce...); proibido set_config,
//     current_setting, pg_* (exceto agregações de pg_catalog da allowlist), dblink, lo_*, e qualquer função de
//     public/consultor;
//   - sem FOR UPDATE/SHARE (lockingClause) e sem SELECT ... INTO.
// Usa o parser real do PostgreSQL (pgsql-parser / libpg-query, WASM) — nada de regex frágil.
import { parse } from 'pgsql-parser'

// relações permitidas = as views da camada semântica (schema consultor)
export const RELACOES_CONSULTOR = new Set<string>([
  'titulos', 'baixas', 'boletos', 'extrato', 'conciliacao_vinculos', 'contas_bancarias',
  'parceiros', 'categorias', 'centros_custo', 'contratos', 'historico_titulo', 'dicionario_view',
])

// funções permitidas (minúsculas). Só leitura/agregação/formatação — nada que mude estado, durma ou leia ambiente.
export const FUNCOES_PERMITIDAS = new Set<string>([
  // agregação / janela simples
  'sum', 'count', 'avg', 'min', 'max', 'coalesce', 'nullif', 'greatest', 'least',
  // matemática
  'round', 'abs', 'ceil', 'ceiling', 'floor', 'trunc', 'mod', 'power', 'sqrt', 'sign', 'div',
  // texto
  'lower', 'upper', 'length', 'char_length', 'trim', 'btrim', 'ltrim', 'rtrim', 'left', 'right',
  'substr', 'substring', 'concat', 'concat_ws', 'replace', 'split_part', 'position', 'strpos',
  'initcap', 'to_char', 'format', 'regexp_replace',
  // data
  'now', 'current_date', 'current_timestamp', 'date_trunc', 'date_part', 'extract', 'age',
  'to_date', 'to_timestamp', 'make_date', 'make_interval', 'justify_interval',
  // conversão / util
  'cast', 'abs', 'bool_and', 'bool_or', 'string_agg', 'array_agg', 'jsonb_agg', 'json_agg',
])

// esquemas aceitos para funções qualificadas (agregações de pg_catalog, p.ex. pg_catalog.count)
const SCHEMAS_FN_OK = new Set<string>(['pg_catalog', ''])

export type GuardOk = { ok: true }
export type GuardFail = { ok: false; motivo: string }
export type GuardResult = GuardOk | GuardFail

const fail = (motivo: string): GuardFail => ({ ok: false, motivo })

// extrai o nome (minúsculo) de uma lista funcname do AST: [{String:{sval}}] ou [{String schema},{String fn}]
function nomeFuncao(funcname: unknown): { schema: string; nome: string } | null {
  if (!Array.isArray(funcname) || funcname.length === 0) return null
  const parts = funcname.map((p: Record<string, { sval?: string }>) => {
    const s = p?.String
    return (s?.sval ?? '').toLowerCase()
  })
  const nome = parts[parts.length - 1]
  const schema = parts.length > 1 ? parts[parts.length - 2] : ''
  return { schema, nome }
}

// percorre o AST recursivamente, aplicando as regras; devolve o 1º motivo de recusa ou null
function varrer(node: unknown, ctes: Set<string>): string | null {
  if (node === null || node === undefined) return null
  if (Array.isArray(node)) {
    for (const item of node) { const m = varrer(item, ctes); if (m) return m }
    return null
  }
  if (typeof node !== 'object') return null
  const obj = node as Record<string, unknown>

  // relação: RangeVar
  if (obj.RangeVar) {
    const rv = obj.RangeVar as { schemaname?: string; relname?: string }
    const schema = (rv.schemaname ?? '').toLowerCase()
    const rel = (rv.relname ?? '').toLowerCase()
    if (schema && schema !== 'consultor') return `relação fora da camada semântica: ${schema}.${rel}`
    if (!schema && !RELACOES_CONSULTOR.has(rel) && !ctes.has(rel)) return `relação não permitida: ${rel}`
    if (schema === 'consultor' && !RELACOES_CONSULTOR.has(rel)) return `relação não permitida: consultor.${rel}`
    // continua varrendo (RangeVar não tem filhos perigosos, mas por segurança)
  }

  // função: FuncCall
  if (obj.FuncCall) {
    const fc = obj.FuncCall as { funcname?: unknown }
    const f = nomeFuncao(fc.funcname)
    if (!f) return 'chamada de função ilegível'
    if (!SCHEMAS_FN_OK.has(f.schema)) return `função de schema não permitido: ${f.schema}.${f.nome}`
    if (f.nome.startsWith('pg_') || f.nome.startsWith('lo_') || f.nome.startsWith('dblink'))
      return `função proibida: ${f.nome}`
    if (!FUNCOES_PERMITIDAS.has(f.nome)) return `função fora da allowlist: ${f.nome}`
  }

  // nós proibidos explicitamente
  if (obj.SelectStmt) {
    const ss = obj.SelectStmt as Record<string, unknown>
    if (ss.lockingClause) return 'FOR UPDATE/SHARE não é permitido'
    if (ss.intoClause) return 'SELECT ... INTO não é permitido'
  }

  for (const k of Object.keys(obj)) {
    // bloqueia nós de comando que não sejam de leitura, em qualquer profundidade
    if (/^(Insert|Update|Delete|Copy|Create|Drop|Alter|Grant|Truncate|Call|Do|Execute|Transaction|Vacuum|Explain)Stmt$/.test(k))
      return `comando não permitido: ${k}`
    const m = varrer(obj[k], ctes)
    if (m) return m
  }
  return null
}

export async function validarSqlConsultor(sql: string): Promise<GuardResult> {
  if (typeof sql !== 'string' || sql.trim() === '') return fail('SQL vazio')
  let ast: { stmts?: Array<{ stmt?: unknown }> }
  try {
    ast = (await parse(sql)) as { stmts?: Array<{ stmt?: unknown }> }
  } catch (e) {
    return fail('SQL inválido: ' + (e instanceof Error ? e.message : String(e)))
  }
  const stmts = ast?.stmts ?? []
  if (stmts.length !== 1) return fail(`esperado exatamente 1 comando, veio ${stmts.length}`)
  const stmt = stmts[0]?.stmt as Record<string, unknown> | undefined
  if (!stmt || !stmt.SelectStmt) return fail('apenas SELECT é permitido')

  // coleta nomes de CTE (WITH) para permitir referenciá-los
  const ctes = new Set<string>()
  const sel = stmt.SelectStmt as { withClause?: { ctes?: Array<{ CommonTableExpr?: { ctename?: string } }> } }
  for (const c of sel.withClause?.ctes ?? []) {
    const n = c?.CommonTableExpr?.ctename
    if (n) ctes.add(n.toLowerCase())
  }

  const motivo = varrer(stmt, ctes)
  if (motivo) return fail(motivo)
  return { ok: true }
}
