// Gate (eng-chefe-auto 17/10, PDCA do Hub): o disparo de foto do auditor NUNCA pode voltar a postar o
// Playwright sem a empresa DEMO. Sem empresa_id o endpoint /api/screen-watcher/playwright devolve 403
// (RD-69/LGPD "só demonstração") e o run fica "pending" para sempre — foi o que deixou o Hub "não auditado".
//
// Prova estática (sem rede/banco): na ÚLTIMA definição de fn_auditor_disparar nas migrations,
//   (1) o corpo do http_post inclui 'empresa_id';
//   (2) a empresa vem de fn_demo_da_area (resolução por área, igual ao lote);
//   (3) existe guarda: empresa NULL não dispara (não gera run que morre no 403);
//   (4) há trava explícita is_demo (RD-97/LGPD) recusando empresa que não seja de demonstração;
//   (5) o escape consciente do check-fn-guards está presente (ci-sem-guarda: fn_auditor_disparar);
// e a área 'projetos' do Hub está mapeada em demo_por_area (senão a Calculadora cai como "sem_demo").
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join('supabase', 'migrations')
const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Última migration que (re)define fn_auditor_disparar — é ela que vale no banco.
const reDef = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_auditor_disparar/i
const comDef = arquivos.filter((f) => reDef.test(readFileSync(join(DIR, f), 'utf8')))
ok(comDef.length > 0, 'fn_auditor_disparar definida em migration no repo')

if (comDef.length > 0) {
  const ultima = comDef[comDef.length - 1]
  const sql = readFileSync(join(DIR, ultima), 'utf8')
  // Isola o trecho a partir do CREATE (para checar o corpo e os grants que vêm logo depois).
  const corpo = sql.slice(sql.search(reDef))

  const temEmpresaNoBody =
    /net\.http_post\([\s\S]*?body\s*:=\s*[\s\S]*?'empresa_id'[\s\S]*?\)/i.test(corpo)
  ok(temEmpresaNoBody, `${ultima}: http_post manda 'empresa_id' no corpo`)

  ok(/fn_demo_da_area\s*\(/i.test(corpo), `${ultima}: empresa resolvida por fn_demo_da_area`)

  // Guarda: empresa NULL não dispara (evita 403/pending). Procura IF ... IS NULL ... RETURN antes do http_post.
  const idxPost = corpo.search(/net\.http_post/i)
  const antesDoPost = idxPost > 0 ? corpo.slice(0, idxPost) : corpo
  const temGuarda = /v_empresa\s+IS\s+NULL/i.test(antesDoPost) && /RETURN/i.test(antesDoPost)
  ok(temGuarda, `${ultima}: guarda "empresa IS NULL → não dispara" antes do http_post`)

  // Trava explícita is_demo (RD-97/LGPD): recusa empresa que não seja de demonstração antes do disparo.
  const temIsDemo = /is_demo\s*=\s*true/i.test(antesDoPost)
  ok(temIsDemo, `${ultima}: trava explícita is_demo (recusa empresa não-DEMO) antes do http_post`)

  // Escape consciente do check-fn-guards (SECURITY DEFINER de serviço que grava no catálogo global).
  const temEscape = /--\s*ci-sem-guarda:\s*(?:public\.)?fn_auditor_disparar\b[^\n]*\S/i.test(sql)
  ok(temEscape, `${ultima}: comentário ci-sem-guarda para fn_auditor_disparar presente`)

  // REVOKE de PUBLIC/anon/authenticated (execução só pelo papel de serviço).
  const temRevoke =
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_auditor_disparar\s*\([^)]*\)\s+FROM\s+[^;]*\banon\b/i.test(sql)
  ok(temRevoke, `${ultima}: REVOKE ... FROM ... anon presente`)
}

// 'projetos' mapeada em demo_por_area (a Calculadora do Hub vive nessa área).
const mapeiaProjetos = arquivos.some((f) => {
  const sql = readFileSync(join(DIR, f), 'utf8')
  return /INSERT\s+INTO\s+public\.demo_por_area[\s\S]*?'projetos'/i.test(sql)
})
ok(mapeiaProjetos, "área 'projetos' mapeada em demo_por_area")

if (falhas) { console.error(`\n${falhas} falha(s) no gate check-auditor-disparar-demo`); process.exit(1) }
console.log('\ncheck-auditor-disparar-demo: OK')
