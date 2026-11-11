// Gate (PDCA GE 11/11, tarefas 0c3345df/26111304) — LIMPEZA DE e2e NÃO PODE USAR "%" COMO CURINGA.
// No PostgREST o operador `like`/`ilike` usa `*` como curinga, NÃO `%`: um `%` escrito no padrão vira caractere
// LITERAL e não casa com nada. Foi exatamente isso que fez o afterAll de caminho-contas-mais-de-500-titulos.spec.ts
// casar 0 linhas e vazar 521 títulos de teste por execução na DEMO Comércio GE (27 mil órfãos em erp_receber).
//
// Regra: nenhum filtro de db-helper de e2e (dbDelete/dbSelect/dbPatch) pode usar `=like.`/`=ilike.` com um `%`
// literal como curinga — use `*`. Assim a limpeza afterAll realmente apaga as linhas do próprio RUN (idempotente).
// Só leitura estática de arquivos; sem rede, banco ou variável.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Varre e2e/ recursivamente por arquivos .ts
function listarTs(dir: string): string[] {
  const out: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...listarTs(p))
    else if (nome.endsWith('.ts')) out.push(p)
  }
  return out
}

// Captura o valor do operador like/ilike num filtro PostgREST, aceitando:
//  - literal direto:            =like.Contas500 % abc
//  - template com interpolação: =like.${encodeURIComponent(`Contas500 % ${RUN}`)}
// O valor vai até um separador de filtro (&), aspas/crases de fechamento ou o fim do parêntese da chamada.
// Dentro do valor, consome strings aninhadas (`...`, '...', "...") e ${...} para não parar cedo demais.
const RE_LIKE = /=i?like\.((?:`[^`]*`|'[^']*'|"[^"]*"|\$\{[^}]*\}|[^&`'")])*)/g

// Um `%` é curinga-bug quando NÃO é um octeto percent-encoding (%20, %25, %2A...). encodeURIComponent já
// produz %XX em runtime; o que detectamos é o `%` cru digitado no padrão (a armadilha do SQL LIKE).
const temPorcentoCru = (valor: string): boolean => /%(?![0-9a-fA-F]{2})/.test(valor)

const arquivos = listarTs('e2e')
let varridos = 0
for (const f of arquivos) {
  const src = readFileSync(f, 'utf8')
  varridos++
  let m: RegExpExecArray | null
  RE_LIKE.lastIndex = 0
  while ((m = RE_LIKE.exec(src)) !== null) {
    const valor = m[1]
    if (temPorcentoCru(valor)) {
      falhas++
      const trecho = m[0].length > 90 ? m[0].slice(0, 90) + '…' : m[0]
      console.error(`✗ ${f}: filtro like/ilike com "%" literal (no PostgREST o curinga é "*"): ${trecho}`)
    }
  }
}

ok(varridos > 0, `varreu ${varridos} arquivo(s) .ts em e2e/`)

if (falhas) {
  console.error(`\n${falhas} ocorrência(s) de "%" como curinga em filtro de e2e — troque por "*" (PostgREST).`)
  process.exit(1)
}
console.log('\ncheck-e2e-cleanup-postgrest-wildcard: ok')
