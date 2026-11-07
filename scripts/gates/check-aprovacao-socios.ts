// Gate · Aprovação pelos sócios (CEO 06/11/2026 — "nada deve ficar parado; deve fluir com OK de qualquer um de nós").
// Sem rede. Confere: (1) só aprovador LOGADO decide (fn__aprovador_pr_assert com auth.uid) e a autoria é auth.uid();
// (2) as funções do workflow só pelo canal de serviço; (3) RLS ligada nas 3 tabelas, sem policy recursiva;
// (4) a decisão é presa à versão (patch-id) e exige justificativa; (5) o workflow só põe `ceo-aprovado` em decisão
// APROVADA, comenta quem decidiu e não faz checkout de PR; (6) a tela lê só as RPCs e tem "?" com chave cadastrada.
import { readFileSync, readdirSync } from 'node:fs'
import { itemDaBandeja, patchIdDe } from '../dev/bandeja-socios.mjs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_aprovacao_socios_bandeja.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_aprovacao_socios_bandeja.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const wf = readFileSync('.github/workflows/bandeja-socios.yml', 'utf8')
const js = readFileSync('scripts/dev/bandeja-socios.mjs', 'utf8')
const tela = readFileSync('src/components/dev/AprovacoesSocios.tsx', 'utf8')

ok(/IF auth\.uid\(\) IS NULL THEN RAISE EXCEPTION 'login_obrigatorio'/.test(sql) && /'so_socios_aprovam'/.test(sql), 'só aprovador logado decide')
for (const f of ['fn_pr_bandeja_listar()', 'fn_pr_bandeja_aprovar(', 'fn_aprovador_ok_mensagem(']) {
  const corpo = sql.slice(sql.indexOf(`FUNCTION public.${f}`), sql.indexOf('$fn$;', sql.indexOf(`FUNCTION public.${f}`)))
  ok(/public\.fn__aprovador_pr_assert\(\)/.test(corpo), `guarda de aprovador: ${f}`)
}
ok(/VALUES \(p_pr_numero, b\.patch_id, p_decisao, btrim\(p_justificativa\), auth\.uid\(\), v_nome\)/.test(sql), 'autoria = auth.uid()')
for (const f of ['fn_pr_bandeja_sincronizar(jsonb)', 'fn_pr_aprovacao_pendentes()', 'fn_pr_aprovacao_marcar(uuid, text)']) {
  ok(sql.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`), `serviço só pelo canal protegido: ${f}`)
}
ok((sql.match(/PERFORM public\.fn__agente_assert_servico\(\)/g) || []).length === 3, 'funções do workflow conferem o canal de serviço')
for (const t of ['erp_aprovador_pr', 'erp_pr_bandeja', 'erp_pr_aprovacao']) ok(sql.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`), `RLS ligada: ${t}`)
ok((sql.match(/USING \(public\.fn__eh_aprovador_pr\(\)\)/g) || []).length === 3 && !/USING \(EXISTS \(SELECT 1 FROM public\.erp_aprovador_pr/.test(sql), 'policies sem recursão')
ok(/'versao_mudou'/.test(sql) && /'justificativa_curta'/.test(sql), 'decisão presa à versão e com justificativa')
ok(/'jordana-code', u\.id, 'code-jordana', true/.test(sql), 'Jordana com escopo de chamados')
ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(TABLE|FUNCTION|COLUMN)\b/i.test(sql), 'nada apagado')
ok(!/ref: \$\{\{ github\.event\.pull_request/.test(wf) && /default_branch/.test(wf), 'workflow roda o código da main, sem checkout de PR')
ok(/if \(d\.decisao === 'aprovada'\) await gh\(`\/repos\/\$\{REPO\}\/issues\/\$\{d\.pr\}\/labels`/.test(js), 'etiqueta só em decisão aprovada')
ok(/OK DE SÓCIO #\$\{d\.pr\} — \$\{d\.por\}/.test(js), 'comentário diz quem aprovou')
// a bandeja vem do ÚLTIMO parecer do revisor
const pr = { number: 7, title: 't', labels: [{ name: 'revisao-eng-chefe' }], body: 'Code: rodrigo-code', draft: false }
const PID = 'a'.repeat(40)
ok(itemDaBandeja(pr, [{ body: `BANDEJA DO CEO — gilberto-revisor\npatch-id atual: \`${PID}\`` }])?.patch_id === PID, 'bandeja lida com patch-id')
ok(itemDaBandeja(pr, [{ body: 'BANDEJA DO CEO' }, { body: `MERGE AUTORIZADO #7 — gilberto-revisor · patch-id ${PID}` }]) === null, 'autorizada depois sai da bandeja')
ok(itemDaBandeja({ ...pr, labels: [...pr.labels, { name: 'ceo-aprovado' }] }, [{ body: 'BANDEJA DO CEO' }]) === null, 'já aprovada não entra')
ok(patchIdDe('sem hash') === null, 'sem patch-id → null')
ok((tela.match(/supabase\.rpc\('/g) || []).length === 3 && !/\.from\(/.test(tela), 'tela lê só as RPCs')
for (const k of [...tela.matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])) ok(mig.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)

if (falhas) { console.error(`\n${falhas} falha(s) — aprovação dos sócios`); process.exit(1) }
console.log('\nAprovação dos sócios ok')
