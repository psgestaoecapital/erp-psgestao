// Gate (incidente 13/10 19:58 + restauração aprovada) — contaminação entre PRs no banco da vaga. Arquitetura que respeita
// o Pilar 2 (a aceitação NUNCA carrega segredo de produção — gate check-esteira-2-velocidades):
//  • DETECÇÃO na aceitação (aceitacao-pr/main): reconciliar-vaga.sh SEM PROD_DATABASE_URL → só detecta e, se o ledger
//    tiver versão > a maior da main, falha "precisa de recriar" (exit 2). Barra banco sujo sem ler a produção.
//  • RESTAURAÇÃO no workflow dedicado reconciliar-vaga.yml (tem segredo de produção, como o montar): reconciliar-vaga.sh
//    COM PROD_DATABASE_URL → restaura a vaga ao estado da produção (cirúrgico) e só COMMITA se, no dado, os objetos de
//    código da vaga == produção (verify-before-commit); senão ROLLBACK → recriar.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/banco-testes/reconciliar-vaga.sh', 'utf8')
// contaminação + modos
ok(/where version > '\$main_max'/.test(sh), 'contaminação = ledger > maior versão da main (não set-difference)')
ok(/PROD_DATABASE_URL="\$\{PROD_DATABASE_URL:-\}"/.test(sh), 'PROD_DATABASE_URL é OPCIONAL (detecção sem produção; restauração com)')
ok(/if \[ -z "\$PROD_DATABASE_URL" \]; then[\s\S]{0,240}recriar/.test(sh), 'modo DETECÇÃO (sem produção): contaminada → recriar (exit 2), sem ler a produção')
// RESTAURAÇÃO compara SEMPRE com a produção — órfão = ledger da vaga ausente na produção (pega órfão ABAIXO do main_max)
ok(/comm -13 "\$dir\/prod\.led" "\$dir\/vaga\.led"/.test(sh), 'restauração: órfão = versão do ledger da vaga ausente na produção (comm vaga−prod), não só > main_max')
ok(/delete from supabase_migrations\.schema_migrations where version not in \(select version from _prodled\)/.test(sh), 'restauração remove do ledger só os órfãos (versões ausentes na produção) — nunca as históricas')
// VERIFICAÇÃO FINAL OBRIGATÓRIA (verde falso do run #2): nunca termina 0 se, no dado, vaga ≠ produção
ok(/VERIFICA[ÇC][ÃA]O FINAL OBRIGAT[ÓO]RIA/.test(sh), 'há verificação final obrigatória no dado (pós-restauração)')
ok(/\[ "\$sig_div" -ne 0 \] \|\| \[ "\$orphan_fim" -ne 0 \]/.test(sh) && /recriar "verificação final/.test(sh), 'verificação final: assinatura divergente OU órfão restante → vermelho (recriar), nunca verde')
// verify-before-commit
ok(/\bbegin;/.test(sh) && /\bcommit;/.test(sh), 'restauração roda numa transação (begin … commit)')
ok(/raise exception 'reconcilia: vaga nao convergiu para a producao/.test(sh), 'verify-before-commit: RAISE (rollback) se não convergir')
ok(/_prodsig[\s\S]*except[\s\S]*_vagasig[\s\S]*except[\s\S]*_prodsig/.test(sh), 'verificação compara assinatura vaga×produção (EXCEPT nos dois sentidos)')
// nunca escreve na produção
ok(/case "\$TEST_DATABASE_URL" in \*"\$PROD_REF"\*\) erro/.test(sh), 'guarda: TEST_DATABASE_URL nunca é a produção')
ok(/"\$PSQL" "\$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "\$txn"/.test(sh), 'as escritas (transação) vão para a VAGA (TEST_DATABASE_URL)')
ok(!/"\$PROD_DATABASE_URL"[^\n]*-f /.test(sh) && !/"\$PROD_DATABASE_URL"[^\n]*(drop|delete|update|insert|alter|create)/i.test(sh), 'na produção o script só roda SELECT (nenhum -f/DDL/DML)')
// fallback seguro
ok(/prod_only\.keys/.test(sh) && /recriar /.test(sh), 'objeto aprovado ausente → recriar')
ok(/grep -qvE '\^\(func\|view\) '/.test(sh), 'modificação fora de função/view → recriar')

// prod-url.sh só leitura
const pu = readFileSync('scripts/banco-testes/prod-url.sh', 'utf8')
ok(!/\bpsql\b/.test(pu), 'prod-url.sh não executa psql (só monta a URL de leitura)')

// DETECÇÃO na aceitação, SEM segredo de produção
const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok((pr.match(/reconciliar-vaga\.sh/g) || []).length >= 2, 'aceitacao-pr roda a DETECÇÃO no início e no fim')
ok(!/prod-url\.sh/.test(pr) && !/SUPABASE_ACCESS_TOKEN/.test(pr) && !/SUPABASE_DB_PASSWORD/.test(pr), 'aceitacao-pr NÃO carrega segredo de produção (Pilar 2)')
const main = readFileSync('.github/workflows/aceitacao-main.yml', 'utf8')
ok(/reconciliar-vaga\.sh/.test(main), 'aceitacao-main roda a DETECÇÃO na vaga 0')
ok(!/prod-url\.sh/.test(main) && !/SUPABASE_ACCESS_TOKEN/.test(main) && !/SUPABASE_DB_PASSWORD/.test(main), 'aceitacao-main NÃO carrega segredo de produção (Pilar 2)')

// RESTAURAÇÃO no workflow dedicado, COM segredo de produção
const rv = readFileSync('.github/workflows/reconciliar-vaga.yml', 'utf8')
ok(/workflow_dispatch:/.test(rv), 'reconciliar-vaga.yml é disparável (workflow_dispatch)')
ok(/prod-url\.sh/.test(rv) && /PROD_DATABASE_URL=/.test(rv) && /reconciliar-vaga\.sh/.test(rv), 'reconciliar-vaga.yml roda a RESTAURAÇÃO com PROD_DATABASE_URL')
ok(/SUPABASE_ACCESS_TOKEN/.test(rv) && /SUPABASE_DB_PASSWORD/.test(rv), 'reconciliar-vaga.yml tem o segredo de produção (como o montar)')
ok(/group: \$\{\{ github\.event\.inputs\.vaga == '0' && 'aceitacao-testes'/.test(rv) && /cancel-in-progress: false/.test(rv), 'reconciliar-vaga.yml roda sob a trava da vaga (grupo aceitacao-testes, sem cancelar)')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — restauração/guarda de contaminação da vaga`); process.exit(1) }
console.log('\ncheck-aceitacao-reconcilia: ok')
