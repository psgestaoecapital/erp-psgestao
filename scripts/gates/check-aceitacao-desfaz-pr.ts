// Gate (CEO 14/10) — a aceitação SUJAVA a vaga: aplicava as migrations da PR e nada as desfazia, então cada PR deixava
// schema não aprovado para a próxima (e, quando a versão da PR passava a maior da main, a guarda mandava recriar → toda
// aceitação vermelha). Agora, SEM segredo de produção (Pilar 2), a vaga é fotografada após o sync só-da-main e ANTES das
// migrations da PR; ao fim (if: always()) é restaurada à foto. Este gate trava o mecanismo.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/banco-testes/vaga-snapshot.sh', 'utf8')
ok(/\bsnapshot\b/.test(sh) && /\brestaurar\b/.test(sh), 'vaga-snapshot.sh tem os modos snapshot e restaurar')
ok(!/PROD_DATABASE_URL/.test(sh), 'Pilar 2: vaga-snapshot.sh NUNCA usa segredo/URL de produção (a referência é a própria foto da vaga)')
ok(/case "\$TEST_DATABASE_URL" in \*"\$PROD_REF"\*\) erro/.test(sh), 'guarda: TEST_DATABASE_URL nunca é a produção')
ok(/create schema _vaga_snapshot/.test(sh), 'snapshot grava a foto no schema _vaga_snapshot')
ok(/raise exception 'vaga-snapshot: vaga nao voltou a foto/.test(sh), 'verify-before-commit: RAISE (rollback) se a vaga não voltar à foto')
ok(/delete from supabase_migrations\.schema_migrations where version not in \(select version from _vaga_snapshot\.led\)/.test(sh), 'restaurar remove do ledger as versions da PR (as que não estão na foto)')
ok(/VERIFICA[ÇC][ÃA]O FINAL OBRIGAT[ÓO]RIA/.test(sh) && /recriar "verificação final/.test(sh), 'verificação final obrigatória no dado → recriar se a vaga != foto')

ok(/statement_timeout='10min'/.test(sh), 'restauração com statement_timeout próprio de 10min (14/10: 180s estourava)')
ok(/tentando uma vez mais/.test(sh) && /_vaga_suja\.marca/.test(sh), 'restauração falha → 1 retry; falhando de novo marca a vaga SUJA')

const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok(/git archive origin\/main -- supabase\b/.test(pr), 'aceitacao-pr materializa SÓ a main (config+migrations) para o sync só-da-main')
ok(/vaga-snapshot\.sh snapshot/.test(pr), 'aceitacao-pr tira a FOTO (snapshot) antes das migrations da PR')
ok(/vaga-snapshot\.sh restaurar/.test(pr), 'aceitacao-pr DESFAZ as migrations da PR (restaurar) ao fim')
// o restaurar roda sempre (if: always), mesmo com teste vermelho/cancelado
ok(/vaga-snapshot\.sh restaurar/.test(pr) && /Desfazer migrations da PR[\s\S]{0,200}if: always\(\)/.test(pr), 'o passo "Desfazer migrations da PR" roda if: always()')
// a ordem: a foto (snapshot) vem ANTES do db push das migrations da PR no passo de sync
const idxSnap = pr.indexOf('vaga-snapshot.sh snapshot')
const idxPrPush = pr.indexOf('aplicando as migrations da PR')
ok(idxSnap > 0 && idxPrPush > idxSnap, 'a foto é tirada ANTES de aplicar as migrations da PR')
// foto que falha é FATAL: sem foto não se aplica migration de PR (vaga suja, caso markup 14/10)
ok(!/vaga-snapshot\.sh snapshot \|\| echo/.test(pr) && /vaga-snapshot\.sh snapshot \|\| \{[^}]*exit 1/.test(pr), 'foto falhou → aborta ANTES de aplicar as migrations da PR (nunca só warning)')
// Pilar 2 na aceitação (inalterado): nenhum segredo de produção
ok(!/prod-url\.sh/.test(pr) && !/SUPABASE_ACCESS_TOKEN/.test(pr) && !/SUPABASE_DB_PASSWORD/.test(pr), 'aceitacao-pr continua SEM segredo de produção (Pilar 2)')

ok(/statement_timeout='10min'/.test(sh), 'restauração com statement_timeout de 10 min (14/10: estourava 180s)')
ok(/tentando uma vez mais/.test(sh) && /marcada SUJA/.test(sh), 'restauração tenta 2× e marca a vaga SUJA se falhar')
// Eng. Chefe 15/10: CHECK/constraint ampliado por DO $$ (PR do Hub 20261015000005) caía em "recriar" SEM reverter nem limpar o ledger
ok(/_vaga_snapshot\.condef/.test(sh) && /_vaga_snapshot\.idxdef/.test(sh) && /_vaga_snapshot\.trgdef/.test(sh), 'a foto guarda defs de constraint, índice e trigger')
ok(/\^\(func\|view\|constraint\|index\|trigger\) /.test(sh) && /add constraint/.test(sh), 'restaurar reverte constraint/índice/trigger MODIFICADO à def da foto (não cai em recriar)')
if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — desfazer migrations da PR na vaga`); process.exit(1) }
console.log('\ncheck-aceitacao-desfaz-pr: ok')
