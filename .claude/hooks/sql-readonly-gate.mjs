#!/usr/bin/env node
// PreToolUse gate para o MCP Supabase execute_sql.
// Decisão CEO (16/09/2026): tirar o atrito das PROVAS (SELECTs de diagnóstico RD-38) SEM abrir mão
// do clique nas ESCRITAS. Este hook libera automaticamente SÓ leitura pura; qualquer coisa ambígua
// cai no fluxo normal de aprovação (pergunta). vault.* é bloqueado de vez.
//
// 🔒 Regras de rigor exigidas pelo CEO:
//   - CTE com escrita no fim  (WITH x AS (...) INSERT/UPDATE/DELETE ...) → ESCRITA (pergunta)
//   - função chamada por SELECT (SELECT fn_qualquer(...)) → tratada como ESCRITA (pergunta), porque
//     o texto do SQL não revela se a função escreve; só builtins de leitura conhecidos passam
//   - comentário no começo não engana (/* select */ DELETE ...) → comentários e strings são removidos
//     ANTES de classificar
//   - default seguro = PERGUNTAR. Só imprime "allow" quando tem certeza de que é leitura.
//
// Saída: imprime JSON {permissionDecision:"allow"} para liberar; nada (exit 0) para cair na pergunta
// padrão; {permissionDecision:"deny"} só para vault.

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    // se não vier nada rápido, não trava
    setTimeout(() => resolve(data), 2000)
  })
}

function ask(_reason) {
  // Não imprime decisão → o runtime segue o fluxo normal (execute_sql não está no allow → pergunta).
  process.exit(0)
}
function allow(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason },
  }))
  process.exit(0)
}
function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }))
  process.exit(0)
}

// Builtins/keywords de LEITURA que podem aparecer antes de "(" sem indicar escrita.
// Qualquer identificador seguido de "(" que NÃO esteja aqui (ex.: fn_*, procedures) → pergunta.
const SAFE_CALLS = new Set([
  // palavras-chave que precedem "("
  'in', 'exists', 'all', 'any', 'some', 'as', 'on', 'using', 'and', 'or', 'not', 'values',
  'over', 'partition', 'filter', 'within', 'grouping', 'array', 'row', 'case', 'from', 'where',
  'select', 'by', 'order', 'group', 'having', 'union', 'intersect', 'except', 'distinct', 'lateral',
  'tablesample', 'returning',
  // agregados / janela
  'count', 'sum', 'avg', 'min', 'max', 'bool_or', 'bool_and', 'every',
  'array_agg', 'string_agg', 'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_object_agg',
  'rank', 'dense_rank', 'row_number', 'lag', 'lead', 'first_value', 'last_value', 'ntile', 'percentile_cont', 'percentile_disc',
  // condicionais / nulos
  'coalesce', 'nullif', 'greatest', 'least', 'nvl',
  // string
  'lower', 'upper', 'initcap', 'trim', 'btrim', 'ltrim', 'rtrim', 'length', 'char_length', 'character_length',
  'substring', 'substr', 'left', 'right', 'replace', 'regexp_replace', 'regexp_match', 'regexp_matches',
  'regexp_split_to_array', 'regexp_split_to_table', 'split_part', 'position', 'strpos', 'lpad', 'rpad',
  'concat', 'concat_ws', 'format', 'md5', 'starts_with', 'reverse', 'translate', 'ascii', 'chr', 'repeat', 'quote_literal', 'quote_ident',
  // números / datas
  'abs', 'ceil', 'ceiling', 'floor', 'round', 'trunc', 'mod', 'power', 'sqrt', 'sign', 'div', 'exp', 'ln', 'log',
  'to_char', 'to_date', 'to_timestamp', 'to_number', 'date_trunc', 'date_part', 'extract', 'age', 'now',
  'current_date', 'current_timestamp', 'current_time', 'localtimestamp', 'make_date', 'make_timestamp', 'justify_interval',
  // cast / tipos / json
  'cast', 'array', 'unnest', 'generate_series', 'json_build_object', 'jsonb_build_object', 'json_build_array', 'jsonb_build_array',
  'json_object', 'jsonb_object', 'to_json', 'to_jsonb', 'row_to_json', 'json_agg', 'jsonb_pretty', 'jsonb_array_elements',
  'jsonb_array_elements_text', 'jsonb_each', 'jsonb_each_text', 'jsonb_extract_path', 'jsonb_extract_path_text',
  'json_extract_path', 'jsonb_object_keys', 'jsonb_typeof', 'jsonb_set', 'jsonb_strip_nulls',
  'array_length', 'cardinality', 'array_to_string', 'string_to_array', 'array_position', 'array_append', 'array_remove',
  'coalesce', 'nullif', 'pg_typeof', 'octet_length',
  // pg helpers de leitura comuns
  'pg_get_functiondef', 'pg_get_function_arguments', 'pg_get_function_result', 'pg_get_expr', 'pg_get_triggerdef',
  'pg_get_viewdef', 'pg_get_constraintdef', 'pg_get_indexdef', 'obj_description', 'col_description', 'format_type',
  'current_setting', 'version', 'current_user', 'session_user', 'current_schema', 'has_table_privilege',
])

// palavras que, como statement/keyword, indicam ESCRITA ou efeito colateral → pergunta
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|VACUUM|REINDEX|REFRESH|CALL|COPY|LOCK|CLUSTER|CHECKPOINT|LISTEN|NOTIFY|UNLISTEN|DISCARD|PREPARE|EXECUTE|DEALLOCATE|DECLARE|FETCH|MOVE|CLOSE|REASSIGN|IMPORT|SECURITY\s+LABEL)\b/
const COMMENT_ON = /\bCOMMENT\s+ON\b/
const SET_STMT = /\b(SET|RESET)\s+[A-Z]/          // SET x / RESET x (config); evita casar OFFSET
const SEQ_WRITE = /\b(NEXTVAL|SETVAL)\s*\(/
const INTO_WRITE = /\bINTO\b/                     // SELECT ... INTO cria tabela; CREATE ... INTO idem
const DO_BLOCK = /^\s*DO\b/
const READ_START = /^(SELECT|WITH|EXPLAIN|SHOW|TABLE|VALUES)\b/i

async function main() {
  let input
  try { input = JSON.parse(await readStdin() || '{}') } catch { return ask('json inválido') }
  const q = input && input.tool_input && typeof input.tool_input.query === 'string' ? input.tool_input.query : ''
  if (!q.trim()) return ask('sem query')

  // 1) remover comentários e literais para não serem enganados
  let s = q
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ')                         // /* ... */
  s = s.replace(/--[^\n]*/g, ' ')                                  // -- ...
  s = s.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " '' ")      // $tag$ ... $tag$
  s = s.replace(/'(?:[^']|'')*'/g, " '' ")                          // '...'
  const U = s.toUpperCase()

  // 2) vault → bloqueia de vez (CEO: nunca)
  if (/\bVAULT\s*\./.test(U)) return deny('acesso a vault.* é bloqueado por protocolo')

  // 3) cron.schedule/etc → pergunta (só com autorização explícita)
  if (/\bCRON\s*\./.test(U)) return ask('cron.* exige autorização explícita')

  // 4) qualquer marcador de escrita/efeito → pergunta
  if (WRITE_WORD.test(U)) return ask('palavra de escrita detectada')
  if (COMMENT_ON.test(U)) return ask('COMMENT ON é escrita')
  if (SET_STMT.test(U)) return ask('SET/RESET altera estado')
  if (SEQ_WRITE.test(U)) return ask('nextval/setval altera sequência')
  if (INTO_WRITE.test(U)) return ask('INTO materializa dados')
  if (DO_BLOCK.test(U)) return ask('bloco DO pode escrever')

  // 5) todo statement precisa começar com verbo de leitura
  const stmts = s.split(';').map((x) => x.trim()).filter(Boolean)
  if (stmts.length === 0) return ask('sem statement')
  for (const st of stmts) {
    if (!READ_START.test(st)) return ask('statement não começa com verbo de leitura')
  }

  // 6) portão de chamadas de função: identificador seguido de "(" precisa ser builtin de leitura conhecido.
  //    Pega fn_* (RPCs — podem escrever, ex.: fn_psgc_recalcular_dre_mes / fn_registrar_handoff) → pergunta.
  const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
  let m
  while ((m = callRe.exec(s)) !== null) {
    const name = m[1].toLowerCase()
    if (!SAFE_CALLS.has(name)) {
      return ask(`chamada de função não reconhecida como leitura: ${name}()`)
    }
  }

  return allow('leitura pura (sem escrita, sem função não-leitura, sem vault/cron)')
}

main()
