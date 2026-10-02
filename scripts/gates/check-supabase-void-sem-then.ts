// Gate (defeito achado em 02/10 pelo veredito da #1978): `void supabase.rpc(...)` / `void supabase.from(...)...` SEM
// `.then` nunca chega ao banco — o cliente do Supabase só envia a requisição quando a promessa é consumida. Assim ficaram
// sem efeito: o registro de uso da Central de Ajuda (0 linhas desde sempre), o "lido" do sino de chamados (0 de 3.299),
// o vínculo NFS-e → OS da emissão pela OS, o "lido" do chat e logs de auditoria. Este gate reprova a forma quebrada;
// o certo é `void supabase.rpc(...).then(() => undefined)` (dispara e ignora) ou `await`. Sem rede.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const arquivos: string[] = []
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) arquivos.push(p) } }
walk('src')

// a cadeia começa em supabase.rpc / supabase.from / supabase.schema (construtores preguiçosos)
function raizPreguicosa(e: ts.Expression): boolean {
  let x: ts.Node = e
  while (true) {
    if (ts.isCallExpression(x)) x = x.expression
    else if (ts.isPropertyAccessExpression(x)) {
      if (ts.isIdentifier(x.expression) && x.expression.text === 'supabase') return ['rpc', 'from', 'schema'].includes(x.name.text)
      x = x.expression
    } else if (ts.isParenthesizedExpression(x)) x = x.expression
    else return false
  }
}

let falhas = 0
for (const f of arquivos) {
  const src = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visita = (n: ts.Node) => {
    if (ts.isVoidExpression(n) && ts.isCallExpression(n.expression) && raizPreguicosa(n.expression)) {
      const callee = n.expression.expression
      const ultimo = ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
      if (!['then', 'catch', 'finally'].includes(ultimo)) {
        falhas++
        console.error(`✗ ${f}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} \`void supabase…\` sem .then nunca envia ao banco — use .then(() => undefined) ou await`)
      }
    }
    ts.forEachChild(n, visita)
  }
  visita(src)
}
if (falhas) { console.error(`\ncheck-supabase-void-sem-then: ${falhas} chamada(s) que nunca chegam ao banco`); process.exit(1) }
console.log('✓ nenhuma chamada `void supabase.rpc/from(...)` sem .then (todas chegam ao banco)')
