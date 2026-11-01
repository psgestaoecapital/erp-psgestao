// Gate (HB0, auditor 24/10) — telas de detalhe do Hub nunca mostram erro cru do Postgres/PostgREST.
// Antes: /dashboard/projetos/catalogo/[id] exibia "invalid input syntax for type uuid: %5Bid%5D" (score F0).
// Regra: src/lib/erroAmigavel.ts traduz código → frase do usuário; as telas [id] do Hub checam o uuid antes de ir
// ao banco e não põem `.message` do erro direto na tela. Sem rede.
import { readFileSync } from 'node:fs'
import { erroAmigavel, codigoAmigavel, ehUuid, MSG_ENDERECO_INVALIDO } from '../../src/lib/erroAmigavel'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regras puras ──
ok(ehUuid('b0700000-0000-4000-a000-000000000006') && !ehUuid('[id]') && !ehUuid('%5Bid%5D') && !ehUuid(undefined), 'ehUuid aceita só uuid')
ok(erroAmigavel({ code: '22P02', message: 'invalid input syntax for type uuid: "%5Bid%5D"' }) === MSG_ENDERECO_INVALIDO, '22P02 (uuid inválido) vira frase do endereço')
ok(erroAmigavel({ message: 'invalid input syntax for type uuid: "x"' }) === MSG_ENDERECO_INVALIDO, 'mensagem de uuid sem código também é traduzida')
ok(erroAmigavel({ code: 'P0001', message: 'Tarefa não encontrada' }) === 'Tarefa não encontrada', 'RAISE das nossas funções (P0001) passa como está')
ok(erroAmigavel({ code: 'P0001', message: 'sem_acesso' }) === 'Você não tem acesso a este registro.', 'P0001 em snake_case é traduzido')
ok(erroAmigavel({ code: '42501', message: 'new row violates row-level security policy for table "x"' }).startsWith('Você não tem permissão'), 'RLS vira frase de permissão')
ok(erroAmigavel({ code: '23502', message: 'null value in column "unidade"' }) === 'Preencha os campos obrigatórios.', 'not-null vira frase de obrigatório')
ok(erroAmigavel({ code: 'XX000', message: 'internal error at foo.c:123' }, 'Genérica.') === 'Genérica.', 'erro desconhecido cai na genérica do contexto')
ok(erroAmigavel(new Error('TypeError: Failed to fetch')).startsWith('A conexão'), 'falha de rede vira frase de conexão')
ok(codigoAmigavel('obra_nao_encontrada', 'G.') === 'G.' && codigoAmigavel('motivo_obrigatorio') === 'Informe o motivo.', 'código desconhecido nunca aparece cru')
ok(codigoAmigavel('Informe a data da visita.') === 'Informe a data da visita.', 'texto já legível passa')
for (const e of [{ code: '22P02', message: 'invalid input syntax for type uuid: "a"' }, { code: '42P01', message: 'relation "x" does not exist' }, { code: '23505', message: 'duplicate key value violates unique constraint "x_pkey"' }]) {
  const s = erroAmigavel(e)
  ok(!/syntax|relation|constraint|duplicate key|uuid|pkey/i.test(s), `sem termo técnico na tela (${e.code})`)
}

// ── telas [id] do Hub ──
const TELAS = [
  'src/app/dashboard/projetos/catalogo/[id]/page.tsx',
  'src/app/dashboard/projetos/oportunidades/[id]/page.tsx',
  'src/app/dashboard/projetos/obras/[id]/cockpit/page.tsx',
  'src/app/dashboard/projetos/obras/[id]/horas/page.tsx',
  'src/app/dashboard/projetos/obras/[id]/linha-do-tempo/page.tsx',
  'src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx',
]
for (const t of TELAS) {
  const src = readFileSync(t, 'utf8')
  ok(src.includes("@/lib/erroAmigavel"), `${t}: usa erroAmigavel`)
  ok(/ehUuid\(id\)|UUID\.test\(id\)/.test(src), `${t}: confere o uuid antes de ir ao banco`)
  // erro do banco direto na tela: setErro(x.message) / setToast(`Erro: ${x.message}`) / setErr(error.message)
  ok(!/set(Erro|Err|Toast|FalhaCarga)\([^)]*\berror\.message\b/.test(src) && !/set(Erro|Err|Toast)\(\w+\.error\.message\)/.test(src) && !/`Erro: \$\{\w+\.message\}`/.test(src),
    `${t}: não põe error.message direto na tela`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-erro-amigavel`); process.exit(1) }
console.log('\ncheck-hub-erro-amigavel: verde')
