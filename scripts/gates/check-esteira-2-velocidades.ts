// Gate (CEO 07/10 08:05) — esteira em 2 velocidades, TEMPORÁRIA até haver um banco de testes por vaga. Sem rede.
//  (a) fila de merge: PR SEM revisao-eng-chefe = via rápida (aceitação/triagem/@pos-migration informativo fora do
//      cálculo e não exigida; demais checks + Vercel de build real exigidos); COM a label = via revisada (aceitação
//      verde + MERGE AUTORIZADO pelo patch-id, como antes); a regra de migration fica intacta; o log diz a via.
//  (b) aceitacao-main.yml: de hora em hora + manual, build da main no runner apontado para o BANCO DE TESTES (nunca
//      produção), fila aceitacao-testes sem cancelar, issue main-vermelha (abre/atualiza no vermelho, fecha no verde).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

// (a) fila de merge
const sh = ler('scripts/merge/fila-merge.sh')
ok(/ACEITACAO_INFORMATIVA='\^\(aceitacao\|triagem\|@pos-migration \[\(\]informativo\[\)\]\)\$'/.test(sh),
  '(a) via rápida: aceitacao, triagem e @pos-migration (informativo) são os checks informativos')
ok(/\[ "\$via" = rapida \] && linhas=\$\(awk .*'\$1 !~ re'/.test(sh), '(a) via rápida: tira esses checks de pendentes/vermelhos/cancelados')
const iPend = sh.indexOf('pend=$('), iFiltro = sh.indexOf('[ "$via" = rapida ] && linhas=')
ok(iFiltro > 0 && iFiltro < iPend, '(a) o filtro vem ANTES do cálculo de pendentes, vermelhos e cancelados')
ok(/if \[ "\$via" = revisada \]; then\s*\n\s*acc=/.test(sh), '(a) aceitação só é exigida na via revisada')
ok(/test\("cancel\|ignor"; "i"\)\)\) then "pending"/.test(sh), '(a) Vercel só conta build real ("Canceled by Ignored Build Step" não é verde)')
ok(/via=rapida\s*\n\s*jq -e --arg l "\$SENSIVEL" .* && via=revisada/.test(sh), '(a) a via sai da label revisao-eng-chefe')
ok(/if \[ "\$via" = revisada \]; then\s*\n\s*a=\$\(autorizacao "\$n"\)/.test(sh), '(a) via revisada continua exigindo MERGE AUTORIZADO pelo patch-id')
ok(/c=\$\(estado_checks "\$sha" "\$via"( "\$so_docs")?\)/.test(sh), '(a) o laço passa a via para estado_checks')
ok(/via rápida/.test(sh) && /via revisada/.test(sh) && /log "#\$n segue a /.test(sh), '(a) o log diz a via de cada PR')
ok(/m=\$\(estado_main\)/.test(sh) && /so_sem_migration=1/.test(sh), '(a) regra de migration intacta (espera o @pos-migration da anterior)')

// (b) aceitação da main
const wf = ler('.github/workflows/aceitacao-main.yml')
ok(/cron: '17 \* \* \* \*'/.test(wf) && /workflow_dispatch:/.test(wf), '(b) de hora em hora + manual')
// 07/10: a agenda do GitHub descarta runs sob carga (0 runs em ~7 h) → também roda ao fim de cada montagem do banco de
// testes na main, e a triagem pula a ponta da main já julgada
ok(/workflow_run:\s*\n\s*workflows: \['Montar banco de testes'\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \[main\]/.test(wf),
  '(b) dispara também ao fim do "Montar banco de testes" na main (não depende só da agenda)')
ok(/SHA=\$\(gh api "repos\/\$REPO\/commits\/main" --jq \.sha\)/.test(wf) && /if \[ "\$EVENTO" != workflow_dispatch \]/.test(wf),
  '(b) triagem: ponta ATUAL da main já julgada → não roda de novo (manual roda sempre)')
const job = wf.slice(wf.search(/^  aceitacao-main:\s*$/m))
ok(/group: aceitacao-testes\s*\n\s*cancel-in-progress: false\s*\n\s*queue: max/.test(job), '(b) fila aceitacao-testes, FIFO, sem cancelar')
ok(/\*horsymhsinqcimflrtjo\*\) echo "::error::TEST_SUPABASE_URL aponta para a PRODUÇÃO/.test(job) && /\*xjzqndnvjkdjyisuklpy\*\)/.test(job),
  '(b) trava: recusa a produção e exige o projeto de testes')
ok(!/secrets\.(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)\b/.test(wf),
  '(b) nenhum segredo da produção no workflow (só TEST_*)')
ok(/npx next build/.test(job) && /next start -p 3000/.test(job) && /PROD_BASE_URL: http:\/\/localhost:3000/.test(job),
  '(b) build + start da main no próprio runner; a suíte abre o localhost')
ok(/NEXT_PUBLIC_SUPABASE_URL: \$\{\{ secrets\.TEST_SUPABASE_URL \}\}/.test(job), '(b) o build aponta para o banco de testes')
ok(/ref: \$\{\{ steps\.ja\.outputs\.sha \}\}/.test(job), '(b) roda a ponta da main (o SHA conferido no 1º passo)')
// CEO 07/10 (fila aceitacao-testes com 29 runs): 1º passo já dentro da fila encerra se a ponta ATUAL já foi julgada ou
// está em julgamento por outro run; todos os passos seguintes dependem disso
const passos = job.split(/\n      - /).slice(1)
ok(/^name: Ponta da main já julgada\?/.test(passos[0] ?? '') && /id: ja/.test(passos[0] ?? ''), '(b) 1º passo do job: "Ponta da main já julgada?"')
ok(/\.id != \$RUN_ID and \.head_sha == \\"\$sha\\"/.test(passos[0] ?? '') && /\.status == \\"in_progress\\"/.test(passos[0] ?? '')
  && /\.conclusion == \\"success\\" or \.conclusion == \\"failure\\"/.test(passos[0] ?? ''),
  '(b) encerra se a ponta já tem run concluído (verde/vermelho) ou outro em andamento')
ok(passos.slice(1).every((p) => /\n        if: steps\.ja\.outputs\.pular == 'false'/.test(`\n${p}`) || /^if: steps\.ja\.outputs\.pular == 'false'/.test(p)),
  '(b) todos os passos depois do 1º só rodam se a ponta não foi julgada')
ok(/if \[ "\$EVENTO" = workflow_run \] && \[ "\$WR_CONCLUSAO" != success \]/.test(wf) && /WR_CONCLUSAO: \$\{\{ github\.event\.workflow_run\.conclusion \}\}/.test(wf),
  '(b) disparo pós-montagem só roda se o "Montar banco de testes" terminou com success')

// (c) aceitação de PR só na via revisada (CEO 07/10): a via rápida não entra na fila aceitacao-testes
const pr = ler('.github/workflows/aceitacao-pr.yml')
const tri = pr.slice(pr.indexOf('  triagem:'), pr.indexOf('  aceitacao:'))
ok(/index\("revisao-eng-chefe"\) != null/.test(tri) && /if \[ "\$revisada" != true \]; then\s*\n\s*rodar=false/.test(tri),
  '(c) triagem: PR sem revisao-eng-chefe → aceitação dispensada')
ok(/via rápida: julgada na aceitação da main/.test(tri), '(c) triagem: notice "via rápida: julgada na aceitação da main"')
ok(/if \[ -z "\$pr" \]; then\s*\n\s*rodar=false/.test(tri), '(c) triagem: commit sem PR aberta → aceitação dispensada')
ok(/\|\| echo true\)/.test(tri), '(c) triagem: falha ao ler a etiqueta → roda (falha segura)')
const aceit = pr.slice(pr.indexOf('  aceitacao:'))
ok(/needs\.triagem\.outputs\.rodar == 'true'/.test(aceit.slice(0, 600)), '(c) job aceitacao (o que entra na fila) só roda se a triagem mandar')
const etq = ler('.github/workflows/aceitacao-etiqueta.yml')
ok(/pull_request_target:\s*\n\s*types: \[labeled\]/.test(etq) && /github\.event\.label\.name == 'revisao-eng-chefe'/.test(etq),
  '(c) etiqueta posta depois → aceitacao-etiqueta.yml dispara')
ok(!/actions\/checkout/.test(etq) && /actions\/runs\/\$id\/rerun/.test(etq) && /secrets\.FILA_MERGE_TOKEN/.test(etq),
  '(c) aceitacao-etiqueta: sem checkout da PR; só re-roda a aceitação do head com o FILA_MERGE_TOKEN')
ok(/scripts\/merge\/main-vermelha\.sh/.test(job) && /if: (steps\.ja\.outputs\.pular == 'false' && \()?success\(\) \|\| failure\(\)/.test(job), '(b) issue main-vermelha no fim (não em cancelado)')
const mv = ler('scripts/merge/main-vermelha.sh')
ok(/LABEL=main-vermelha/.test(mv) && /state=closed/.test(mv) && /issues\?state=open&labels=\$LABEL/.test(mv), '(b) uma issue só: atualiza a aberta, fecha no verde')
ok(/git log --format='%s' \$faixa/.test(mv) && /desde o último verde/.test(mv), '(b) lista as PRs publicadas desde o último verde')
ok(!/graphql|gh issue|gh pr /.test(mv), '(b) só API REST (gh api)')

// AGENTS.md: regra escrita e marcada como temporária
const ag = ler('AGENTS.md')
ok(/2 velocidades/.test(ag) && /TEMPOR[ÁA]RIA/.test(ag) && /banco de testes por vaga/.test(ag), 'AGENTS.md: regra das 2 velocidades, temporária')

if (falhas) { console.error(`\ncheck-esteira-2-velocidades: ${falhas} falha(s)`); process.exit(1) }
console.log('\nEsteira em 2 velocidades: ok')
