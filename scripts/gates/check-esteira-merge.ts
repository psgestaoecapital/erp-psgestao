// Gate (CEO 06/10): esteira de merge (regras a–e) e cópia dos catálogos globais para o banco de testes. Sem rede.
//  · aceitação (preview e @pos-migration) com timeout de 40 min; vigia cancela job executando há > 45 min;
//  · fila de merge própria: PAT (merge com GITHUB_TOKEN não dispara o deploy-migrations), squash travado no SHA,
//    update-branch, autorização pelo patch-id, cancelado do @pos-migration re-roda, PR sem migration não espera a main;
//  · catálogos: whitelist sem tabela proibida, passo antes do fn_demo_reset, autorização do CEO citada, travas.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

// (e) timeouts e vigia
for (const f of ['aceitacao-pr.yml', 'aceitacao-pos-migration.yml']) {
  const wf = ler(`.github/workflows/${f}`)
  const job = wf.slice(wf.search(/^  (aceitacao|producao):\s*$/m))
  ok(/^    timeout-minutes: 40\s*$/m.test(job), `${f}: job de aceitação com timeout-minutes: 40`)
}
const vigia = ler('.github/workflows/vigia-runs.yml')
ok(/cron: '\*\/10 \* \* \* \*'/.test(vigia) && /LIMITE_MIN: '45'/.test(vigia), 'vigia: a cada 10 min, limite de 45 min')
ok(/select\(\.status == "in_progress"\)/.test(vigia), 'vigia: só conta job EXECUTANDO (esperar na fila não é preso)')
ok(/aceitacao-pr\.yml/.test(vigia) && /aceitacao-pos-migration\.yml/.test(vigia), 'vigia: cobre as duas aceitações')

// zumbi (Eng. Chefe 08/10): teto de 90 min pela idade do run + timeout explícito no job e no step longo
ok(/LIMITE_RUN_MIN: '90'/.test(vigia) && /Cancelar aceitação em andamento há mais de 90 min/.test(vigia) && /run_started_at/.test(vigia),
  'vigia: run de aceitação em andamento há > 90 min (idade do run) é cancelado com aviso')
ok(/ACEITACOES: aceitacao-pr\.yml aceitacao-pos-migration\.yml aceitacao-main\.yml/.test(vigia), 'vigia: zumbi cobre aceitação do preview, pós-migration e da main')
ok(/VIGIADOS:[^\n]*aceitacao-main\.yml/.test(vigia), 'vigia: job executando há > 45 min também vale para a aceitação da main')
for (const [f, step] of [['aceitacao-pr.yml', 'Jornadas de aceitação contra o preview'], ['aceitacao-pos-migration.yml', 'Aceitação @pos-migration contra produção'], ['aceitacao-main.yml', 'Suíte de aceitação contra a main']]) {
  const wf = ler(`.github/workflows/${f}`)
  const i = wf.indexOf(`- name: ${step}`)
  ok(i > 0 && /^\s+timeout-minutes: \d+\s*$/m.test(wf.slice(i, i + 200)), `${f}: step longo "${step}" com timeout-minutes próprio`)
}
ok(/^    timeout-minutes: 60\s*$/m.test(ler('.github/workflows/aceitacao-main.yml')), 'aceitacao-main.yml: job com timeout-minutes explícito')

// (a)–(d) fila de merge
const fila = ler('.github/workflows/fila-merge.yml')
const sh = ler('scripts/merge/fila-merge.sh')
ok(/GH_TOKEN: \$\{\{ secrets\.FILA_MERGE_TOKEN \}\}/.test(fila) && !/GH_TOKEN: \$\{\{ github\.token \}\}/.test(fila),
  'fila: merge com PAT (FILA_MERGE_TOKEN), nunca com o GITHUB_TOKEN')
ok(!/cron:/.test(fila), 'fila: sem polling (só eventos)')
ok(/group: fila-merge/.test(fila) && /cancel-in-progress: false/.test(fila), 'fila: uma rodada por vez')
ok(/ref: main/.test(fila), 'fila: roda o código da main (o da PR nunca é executado)')
ok(/merge_method=squash -f sha="\$sha"/.test(sh), 'fila: merge squash travado no SHA conferido')
ok(/update-branch" -f expected_head_sha/.test(sh), 'fila: atualiza com a main (merge, sem reescrever histórico)')
ok(/git patch-id --stable/.test(sh) && /revisao-eng-chefe/.test(sh), '(c) PR sensível: autorização pelo patch-id do conteúdo')
ok(/aceitacao-pos-migration\.yml\/runs\?branch=main&status=success/.test(sh) && /rerodar "\$id"/.test(sh),
  '(a) @pos-migration cancelado: libera se a última migration já teve verde, senão re-roda')
ok(/if \[ "\$com_migration" = 1 \]; then\s*\n\s*m=\$\(estado_main\)/.test(sh), '(b) só PR com migration espera a main')

// re-run pelo próprio GitHub (Eng. Chefe 07/10): a rede das sessões do Code não consegue POST /rerun
ok(/Re-rodar aceitação cancelada/.test(vigia) && /FILA_MERGE_TOKEN/.test(vigia) && /\$tent" -gt 2/.test(vigia), 'vigia: re-roda aceitação cancelada com PAT, no máximo 2 vezes por SHA')
ok(/head\.sha == /.test(vigia), 'vigia: só re-roda SHA ainda vigente (head de PR aberta ou main)')
const cmd = ler('.github/workflows/comando-pr.yml')
ok(/comment\.body == '\/re-rodar'/.test(cmd), 'comando-pr: só o comentário exato /re-rodar')
ok(/admin\|maintain\|write/.test(cmd) && /collaborators\/\$AUTOR\/permission/.test(cmd), 'comando-pr: exige permissão write do autor')
ok(!/actions\/checkout/.test(cmd) && !/\$\{\{ github\.event\.comment\.body \}\}/.test(cmd.replace(/if: >-[\s\S]*?runs-on/, '')), 'comando-pr: sem checkout e sem interpolar o comentário no shell')

// banco de testes: catálogos globais
const mbt = ler('.github/workflows/montar-banco-testes.yml')
ok(/Autorizado pelo CEO em 06\/10\/2026 17:38/.test(mbt.slice(0, 600)), 'montar-banco-testes: autorização do CEO citada no topo')
const iCat = mbt.indexOf('scripts/banco-testes/catalogos.sh'), iReset = mbt.indexOf('fn_demo_reset(')
ok(iCat > 0 && iReset > iCat, 'montar-banco-testes: cópia dos catálogos ANTES do fn_demo_reset')
ok(mbt.indexOf('Trava de segurança') < iCat, 'montar-banco-testes: a trava contra a produção vem antes da cópia')
const cat = ler('scripts/banco-testes/catalogos.sh')
ok(/\*"\$PROD_REF"\*\) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO/.test(cat), 'catalogos.sh: recusa a produção como destino')
ok(/--data-only/.test(cat) && /-t "public\.\$t"/.test(cat), 'catalogos.sh: pg_dump --data-only -t de cada tabela')
const tabelas = ler('scripts/banco-testes/catalogos.txt').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
ok(tabelas.includes('plan_catalog'), 'whitelist: plan_catalog (o fn_demo_reset precisa do v15_revenda)')
const proibida = /(^auth|^storage|^vault|^cron|^_|(^|_)logs?(_|$)|mensagem|contexto|handoff|bkp|backup|history|historico|sessao|usuario|users?(_|$)|^companies$|^organizations$|fiscal_ibpt_aliquota)/
for (const t of tabelas) ok(/^[a-z_][a-z0-9_]*$/.test(t) && !proibida.test(t), `whitelist: ${t} permitida`)

if (falhas) { console.error(`\ncheck-esteira-merge: ${falhas} falha(s)`); process.exit(1) }
console.log('\nEsteira de merge e catálogos do banco de testes: ok')
