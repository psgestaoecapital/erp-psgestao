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
// Pilar 2 na aceitação (inalterado): nenhum segredo de produção
ok(!/prod-url\.sh/.test(pr) && !/SUPABASE_ACCESS_TOKEN/.test(pr) && !/SUPABASE_DB_PASSWORD/.test(pr), 'aceitacao-pr continua SEM segredo de produção (Pilar 2)')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — desfazer migrations da PR na vaga`); process.exit(1) }
console.log('\ncheck-aceitacao-desfaz-pr: ok')
