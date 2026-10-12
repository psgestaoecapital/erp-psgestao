/**
 * Gate de build (CEO 04/10, tarefa ee360ddc · RD-79) — salário e custo por pessoa só para quem vê salário.
 * Migration 20261005180000: compliance_funcionarios.salario_base e agency_timesheet.custo_hora/custo_total.
 *  1) a migration tira o direito de LER/GRAVAR a coluna do logado e do anônimo (direito por coluna montado pela lista
 *     real de colunas), cria as funções protegidas (SECURITY DEFINER, search_path fixo, fechadas ao anônimo) que
 *     registram o acesso, e a auditoria fn_seguranca_colunas_pessoa_legiveis (só serviço);
 *  2) nenhuma migration POSTERIOR devolve GRANT de tabela inteira (SELECT/ALL/INSERT/UPDATE) a authenticated/anon/PUBLIC
 *     nessas tabelas — nem a agency_equipe (custo_hora) — sem lista de colunas;
 *  3) o código do app não lê nem grava a coluna sensível por caminho de logado: `.from(<tabela>).select('*' | coluna
 *     sensível)`, embutido `tabela(*)` e insert/update de custo_hora em agency_timesheet falham o build;
 *  4) rotas /api que leem compliance_funcionarios com service_role (ignora o direito por coluna) têm de passar a linha
 *     por removerSalario();
 *  5) regra pura da margem por job com o agregado (`tem_custo`) e removerSalario (testados sem rede);
 *  6) as telas usam as funções (Apontamento → fn_pm_timesheet_apontar; Margem → fn_pm_job_custos).
 *   npm run gates -- lgpd-salario
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { calcularMargem } from '../../src/lib/pm/margem'
import { removerSalario, salarioDoCorpo } from '../../src/lib/compliance/salario'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const semComentario = (s: string) => s.replace(/--[^\n]*/g, '')

const dirMig = join(__dirname, '../../supabase/migrations')
const MIG = '20261005180000_lgpd_salario_custo_pessoa_protegido.sql'
const arqs = readdirSync(dirMig).filter((f) => f.endsWith('.sql')).sort()
const mig = semComentario(readFileSync(join(dirMig, MIG), 'utf8'))

// ── 1) a migration ───────────────────────────────────────────────────────────────────────────────────────────────────
ok(/REVOKE ALL ON TABLE public\.compliance_funcionarios FROM PUBLIC, anon, authenticated/.test(mig), '1) compliance_funcionarios: tabela inteira fechada antes de conceder por coluna')
ok(/REVOKE ALL ON TABLE public\.agency_timesheet FROM PUBLIC, anon, authenticated/.test(mig), '1) agency_timesheet: tabela inteira fechada antes de conceder por coluna')
ok(/column_name\s*<>\s*'salario_base'/.test(mig) && /column_name NOT IN \('custo_hora', 'custo_total'\)/.test(mig), '1) o direito por coluna exclui exatamente as colunas sensíveis')
ok(/GRANT SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\) ON public\.compliance_funcionarios TO authenticated/.test(mig)
  && /GRANT SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\) ON public\.agency_timesheet TO authenticated/.test(mig), '1) logado: SELECT/INSERT/UPDATE só nas colunas comuns')
for (const fn of ['fn_compliance_funcionario_salario(uuid)', 'fn_compliance_salarios(uuid)', 'fn_compliance_funcionario_salario_salvar(uuid, numeric)',
  'fn_pm_timesheet_custos(uuid, integer)', 'fn_pm_job_custos(uuid)', 'fn_compliance_salario_media_funcao(uuid)']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.replace(/[().]/g, '\\$&')} FROM PUBLIC, anon`).test(mig), `1) ${fn} fechada ao anônimo`)
}
ok(/REVOKE ALL ON FUNCTION public\.fn_seguranca_colunas_pessoa_legiveis\(\) FROM PUBLIC, anon, authenticated/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_seguranca_colunas_pessoa_legiveis\(\) TO service_role/.test(mig), '1) auditoria da regra só de serviço')
const defs = mig.match(/CREATE OR REPLACE FUNCTION public\.fn_(?:compliance|pm_timesheet|pm_job)[\s\S]*?\$function\$;/g) ?? []
ok(defs.length >= 6 && defs.every((d) => /SECURITY DEFINER/.test(d) && /SET search_path TO 'public'/.test(d)), `1) funções protegidas: SECURITY DEFINER + search_path fixo (${defs.length})`)
ok(['fn_compliance_funcionario_salario(', 'fn_compliance_salarios(', 'fn_compliance_funcionario_salario_salvar(', 'fn_pm_timesheet_custos('].every((f) => {
  const d = defs.find((x) => x.includes(`FUNCTION public.${f}`)) ?? ''
  return /fn__mao_obra_pode_ver_individual/.test(d) && /get_user_company_ids/.test(d)
}), '1) valor individual: confere empresa E "vê salário" (fn__mao_obra_pode_ver_individual, a regra única — RD-65)')
ok(['fn_compliance_funcionario_salario(', 'fn_compliance_salarios(', 'fn_compliance_funcionario_salario_salvar(', 'fn_pm_timesheet_custos('].every((f) =>
  /erp_custo_pessoa_acesso_log/.test(defs.find((x) => x.includes(`FUNCTION public.${f}`)) ?? '')), '1) cada leitura/gravação por pessoa registra o acesso')
ok(!/fn__mao_obra_pode_ver_individual\s*\(\s*p_company_id uuid\s*\)\s*RETURNS/i.test(mig) && !/CREATE OR REPLACE FUNCTION public\.fn__mao_obra_pode_ver_individual/.test(mig), '1) a guarda existente não é reescrita (RD-91)')
ok(/\(VALUES \('compliance_funcionarios', 'salario_base'\),\s*\('agency_timesheet', 'custo_hora'\),\s*\('agency_timesheet', 'custo_total'\),\s*\('agency_equipe', 'custo_hora'\)\)/.test(mig),
  '1) a auditoria cobre as 4 colunas conhecidas (qualquer outra coluna nova de salário entra aqui)')
ok(!/\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN))\b/i.test(mig), '1) aditivo: sem DELETE/TRUNCATE/DROP de dado')
ok(!/UPDATE\s+public\.(compliance_funcionarios|agency_timesheet)\b/.test(mig) && /UPDATE compliance_funcionarios SET salario_base = p_valor WHERE id = p_id/.test(mig),
  '1) o único UPDATE de dado é a gravação de UM salário pela função protegida')

// ── 2) migrations posteriores não devolvem o direito ─────────────────────────────────────────────────────────────────
const TABELAS = ['compliance_funcionarios', 'agency_timesheet', 'agency_equipe']
const reGrant = new RegExp(String.raw`GRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?(${TABELAS.join('|')})\s+TO\s+([^;]*);`, 'gi')
const reGrantTodas = /GRANT\s+([^;]*?)\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO\s+([^;]*);/gi
const violacoes: string[] = []
for (const a of arqs.filter((f) => f > MIG)) {
  const sql = semComentario(readFileSync(join(dirMig, a), 'utf8'))
  for (const m of sql.matchAll(reGrant)) {
    if (!/\b(authenticated|anon|public)\b/i.test(m[3])) continue
    if (/\(/.test(m[1].replace(/\bDELETE\b/gi, ''))) continue // GRANT ... (colunas) é o desenho certo
    if (/^\s*DELETE\s*$/i.test(m[1])) continue
    violacoes.push(`${a}: GRANT ${m[1]} ON ${m[2]} TO ${m[3]}`)
  }
  for (const m of sql.matchAll(reGrantTodas)) if (/\b(authenticated|anon|public)\b/i.test(m[2])) violacoes.push(`${a}: GRANT ${m[1]} ON ALL TABLES IN SCHEMA public TO ${m[2]}`)
}
ok(violacoes.length === 0, `2) nenhuma migration depois da ${MIG.slice(0, 14)} devolve GRANT de tabela inteira${violacoes.length ? ': ' + violacoes.join(' | ') : ''}`)

// ── 3) código do app ─────────────────────────────────────────────────────────────────────────────────────────────────
function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) arquivos(p, acc)
    else if (/\.(ts|tsx)$/.test(n)) acc.push(p)
  }
  return acc
}
const src = arquivos(join(__dirname, '../../src'))
const COL = /\b(salario_base|custo_hora|custo_total)\b/
const achados: string[] = []
const servicoSemTira: string[] = []
for (const f of src) {
  const t = readFileSync(f, 'utf8')
  const usaServico = /SUPABASE_SERVICE_ROLE_KEY/.test(t)
  for (const m of t.matchAll(/\.from\(\s*['"](compliance_funcionarios|agency_timesheet)['"]\s*\)([\s\S]{0,700})/g)) {
    const resto = m[2]
    const sel = resto.match(/\.select\(\s*(['"`])([^'"`]*)\1/)
    const ins = resto.match(/^\s*\.(insert|update|upsert)\(([\s\S]{0,400})/)
    if (sel && !usaServico && (sel[2].trim() === '*' || COL.test(sel[2]))) achados.push(`${f.replace(/^.*\/src\//, 'src/')}: .from('${m[1]}').select('${sel[2]}')`)
    if (ins && m[1] === 'agency_timesheet' && /custo_hora|custo_total/.test(ins[2])) achados.push(`${f.replace(/^.*\/src\//, 'src/')}: grava custo em agency_timesheet`)
    if (usaServico && m[1] === 'compliance_funcionarios' && !/removerSalario/.test(t)) servicoSemTira.push(f.replace(/^.*\/src\//, 'src/'))
  }
  for (const m of t.matchAll(/\b(compliance_funcionarios|agency_timesheet)\(\s*\*/g)) achados.push(`${f.replace(/^.*\/src\//, 'src/')}: embutido ${m[0]}`)
}
ok(achados.length === 0, `3) nenhuma tela/rota de logado lê select('*') ou a coluna sensível${achados.length ? ': ' + achados.join(' | ') : ''}`)
ok(servicoSemTira.length === 0, `4) rota com service_role que lê compliance_funcionarios passa por removerSalario${servicoSemTira.length ? ': ' + [...new Set(servicoSemTira)].join(', ') : ''}`)
const rotaLista = readFileSync('src/app/api/compliance/funcionarios/route.ts', 'utf8')
const rotaId = readFileSync('src/app/api/compliance/funcionarios/[id]/route.ts', 'utf8')
ok(/removerSalario\(f\)/.test(rotaLista) && /removerSalario\(data\)/.test(rotaLista), '4) lista e criação não devolvem salário')
ok(/lerSalario\(u\.token, id\)/.test(rotaId) && /removerSalario\(funcionario/.test(rotaId) && /removerSalario\(data as/.test(rotaId), '4) ficha: salário só por lerSalario (JWT do usuário); gravação só por gravarSalario')
ok(/for \(const k of CAMPOS\) if \(k in body && k !== 'salario_base'\)/.test(rotaId) && /for \(const k of CAMPOS\) if \(k in body && k !== 'salario_base'\)/.test(rotaLista),
  '4) o corpo da requisição nunca grava salario_base direto na tabela')

// ── 5) regras puras ──────────────────────────────────────────────────────────────────────────────────────────────────
const job = { id: 'j1', valor_job: 1000, custo_estimado: null }
const comCusto = calcularMargem(job, [{ job_id: 'j1', horas: 2, tem_custo: true, custo_total: 200 }])
ok(comCusto.situacao === 'ok' && comCusto.lucro === 800 && comCusto.margem === 80, '5) agregado com custo: lucro = valor − custo do job (sem custo/hora por pessoa)')
const semCusto = calcularMargem(job, [{ job_id: 'j1', horas: 2, tem_custo: true, custo_total: 200 }, { job_id: 'j1', horas: 3, tem_custo: false, custo_total: 0 }])
ok(semCusto.situacao === 'sem_custo_hora' && semCusto.horasSemCusto === 3 && semCusto.lucro === null, '5) horas sem custo no agregado → não vira "lucro = valor" (RD-51)')
const legado = calcularMargem(job, [{ job_id: 'j1', horas: 4, custo_hora: null, custo_total: null }])
ok(legado.situacao === 'sem_custo_hora' && legado.horasSemCusto === 4, '5) formato antigo (custo_hora) segue valendo')
const tira = removerSalario({ id: 'a', nome: 'x', salario_base: 1234 }) as Record<string, unknown>
ok(!('salario_base' in tira) && tira.nome === 'x', '5) removerSalario tira só o salário')
ok(removerSalario([{ id: 1, salario_base: 1 }, { id: 2 }]).every((l) => !('salario_base' in l)), '5) removerSalario em lista')
ok(salarioDoCorpo('') === null && salarioDoCorpo(null) === null && salarioDoCorpo(-1) === undefined && salarioDoCorpo('abc') === undefined && salarioDoCorpo('3500.5') === 3500.5,
  '5) salarioDoCorpo: vazio limpa; negativo/texto não grava')

// ── 6) telas ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const apont = readFileSync('src/app/dashboard/pm/apontamento-horas/page.tsx', 'utf8')
ok(/rpc\('fn_pm_timesheet_apontar'/.test(apont) && /rpc\('fn_pm_timesheet_custos'/.test(apont) && !/from\('agency_timesheet'\)\s*\.insert/.test(apont), '6) Apontamento grava pela função e pede o custo por apontamento só a quem vê salário')
const marg = readFileSync('src/app/dashboard/pm/margem-job/page.tsx', 'utf8')
ok(/rpc\('fn_pm_job_custos'/.test(marg) && !/from\('agency_timesheet'\)/.test(marg), '6) Margem por Job usa o agregado por job')
const ficha = readFileSync('src/app/dashboard/compliance/funcionarios/[id]/page.tsx', 'utf8')
ok(/podeVerSalario\s*\n?\s*\?/.test(ficha) && /salario-media-funcao/.test(ficha), '6) ficha: campo de salário só para quem vê; os demais veem a média da função')

if (falhas) { console.error(`\n[check-lgpd-salario-custo-pessoa] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-lgpd-salario-custo-pessoa] salário e custo por pessoa: direito por coluna, funções com registro, nenhuma tela lendo a coluna.')
