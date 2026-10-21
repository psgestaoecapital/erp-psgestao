// Gate (19/10, gilberto-desenv): dados fiscais das DEMOs no banco de testes. A semente.sql criava as DEMOs sem uf_fiscal e o
// fn_demo_reset/fn_gold_ge_seed_reparar não escrevem esse campo; numa vaga montada do zero toda NF-e travava em "UF fiscal do
// emitente não cadastrada" e nfe-cfop-venda, nfe-sem-tributacao-suposta e nfe-simples-cst ficavam vermelhas em TODA PR (vagas
// 0 e 2). Regras: a semente fiscal põe uf_fiscal 'SC' (espelho da produção) só em linha is_demo, de forma idempotente, e roda
// no Montar (semente.sql), na aceitação de PR (depois do sync com a main, ANTES da foto da vaga) e na aceitação da main.
// Sem rede, banco ou variável.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const ler = (f: string) => readFileSync(f, 'utf8')
const semComentario = (s: string) => s.replace(/--[^\n]*/g, '')

const sql = semComentario(ler('scripts/banco-testes/semente-fiscal-demo.sql'))
const DEMOS = ['b0700000-0000-4000-a000-000000000001', 'b0700000-0000-4000-a000-000000000002', 'b0700000-0000-4000-a000-000000000003',
  'b0700000-0000-4000-a000-000000000004', 'b0700000-0000-4000-a000-000000000005', 'b0700000-0000-4000-a000-000000000006',
  'ded00000-0000-4000-a000-000000000001']
const updUf = /UPDATE public\.companies SET uf_fiscal = 'SC'([\s\S]*?);/.exec(sql)
ok(!!updUf, 'semente fiscal: põe uf_fiscal = SC')
ok(!!updUf && /WHERE is_demo\b/.test(updUf[1]) && /uf_fiscal IS DISTINCT FROM 'SC'/.test(updUf[1]),
  'semente fiscal: só linha is_demo e idempotente (IS DISTINCT FROM)')
ok(!!updUf && DEMOS.every((id) => updUf[1].includes(`'${id}'`)), 'semente fiscal: as 7 DEMOs da semente.sql')
ok(/inscricao_estadual = '255000000'[\s\S]*?WHERE is_demo AND id = 'b0700000-0000-4000-a000-000000000004' AND inscricao_estadual IS NULL/.test(sql),
  'semente fiscal: IE da Comércio GE espelho da produção, só se vazia')
ok(!/\b(DELETE|TRUNCATE|DROP)\b/i.test(sql), 'semente fiscal: não apaga nada')

// as DEMOs que as specs fiscais usam estão cobertas
for (const spec of ['nfe-cfop-venda', 'nfe-sem-tributacao-suposta', 'nfe-simples-cst']) {
  const s = ler(`e2e/jornadas/aceitacao/${spec}.spec.ts`)
  const id = /const DEMO(?:_COMERCIO)? = '([0-9a-f-]{36})'/.exec(s)?.[1]
  ok(!!id && DEMOS.includes(id), `${spec}: a DEMO da spec (${id ?? '?'}) recebe a semente fiscal`)
}

// roda nos três lugares
ok(/^\\ir semente-fiscal-demo\.sql\s*$/m.test(ler('scripts/banco-testes/semente.sql')), 'semente.sql (Montar) inclui a semente fiscal')
const pr = ler('.github/workflows/aceitacao-pr.yml')
const iSync = pr.indexOf('1) sincronizando a vaga'), iFiscal = pr.indexOf('git show origin/main:scripts/banco-testes/semente-fiscal-demo.sql'),
  iFoto = pr.indexOf('2) tirando a FOTO da vaga')
ok(iSync > 0 && iFiscal > iSync && iFoto > iFiscal, 'aceitacao-pr: semente fiscal (lida da main) depois do sync e ANTES da foto da vaga')
ok(/semente fiscal das DEMOs falhou na vaga \$\{ACEITACAO_VAGA:-\?\} — aceitação abortada"; exit 1/.test(pr), 'aceitacao-pr: falha da semente fiscal aborta (não testa em vaga sem UF)')
const mn = ler('.github/workflows/aceitacao-main.yml')
const iPushMain = mn.indexOf('banco da vaga 1 não sincronizou (supabase db push falhou)'), iFiscalMain = mn.indexOf('-f scripts/banco-testes/semente-fiscal-demo.sql')
ok(iPushMain > 0 && iFiscalMain > iPushMain, 'aceitacao-main: semente fiscal na vaga 1 depois do sync')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-semente-fiscal-demo: ok')
