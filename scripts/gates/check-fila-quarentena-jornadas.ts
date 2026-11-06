// Gate (CEO 17/10, presente) — QUARENTENA DE JORNADAS na fila de merge.
// Spec que falha na aceitação da PR mas já está em scripts/merge/quarentena-jornadas.txt (falha também na main) NÃO bloqueia
// PR alheia e vira P1 ao Code dono; spec da PRÓPRIA PR, falha NOVA (fora da lista) e falha ilegível continuam bloqueando.
// Roda o fila-merge.sh de verdade contra o gh/curl simulados, FORA da janela da aceitação (agora padrão do simulador).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPT_FILA, comFilaSimulada, merges, acionamentos, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/quarentena_specs\(\)/.test(sh) && /p1_quarentena\(\)/.test(sh) && /acc_quar=1/.test(sh),
  'fila-merge.sh tem a quarentena de jornadas (lista, P1 ao dono, aceitação informativa só quando TODO falho está na lista)')
ok(/\[ "\$acc_quar" = 1 \]; then linhas=/.test(sh), 'aceitação sai do cálculo de vermelhos só com acc_quar=1')
const real = readFileSync('scripts/merge/quarentena-jornadas.txt', 'utf8')
for (const s of ['sicredi-erro-claro-88', 'tryo-anexos-264-266', 'xml-compra-lote'])
  ok(real.includes(`e2e/jornadas/aceitacao/${s}.spec.ts|`), `lista real traz ${s}`)
ok(/Quarentena de jornadas na fila \(CEO 17\/10/.test(readFileSync('AGENTS.md', 'utf8')), 'AGENTS.md documenta a quarentena de jornadas')

const Q1 = 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts'
const Q2 = 'e2e/jornadas/aceitacao/tryo-anexos-264-266.spec.ts'
const NOVO = 'e2e/jornadas/aceitacao/novo-regressao.spec.ts'

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'quar-'))
  const lista = join(dir, 'q.txt')
  writeFileSync(lista, `# teste\n${Q1}|2026-10-17T14:00:00Z|jordana-code|x\n${Q2}|2026-10-17T14:00:00Z|gilberto-desenv|y\n`)
  // Aceitação informativa por padrão (esteira contínua); forçamos o bloqueio para exercer a distinção da quarentena
  // (todo spec falho em quarentena → informativa; spec novo → bloqueia), que só importa quando a aceitação bloqueia.
  const env = { FILA_QUARENTENA_JORNADAS: lista, SUPABASE_URL: 'http://sb.local', SUPABASE_SERVICE_ROLE_KEY: 'k', FILA_ACEITACAO_BLOQUEIA: '1' }
  const rev = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }
  comFilaSimulada((rodar) => {
    let x = rodar([{ ...rev, aceitacaoSpecs: [Q1, Q2] }], false, 5000, env)
    ok(merges(x.escritas).join() === '1', '(a) só specs em quarentena falhando → publica (não bloqueia PR alheia)')
    const p1 = acionamentos(x.curl)
    ok(p1.length === 2 && p1.some((l) => /jordana-code/.test(l) && /P1 quarentena/.test(l)) && p1.some((l) => /gilberto-desenv/.test(l)),
      '(a) P1 enviado a cada dono (jordana-code e gilberto-desenv)')

    x = rodar([{ ...rev, aceitacaoSpecs: [Q1, NOVO] }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(b) spec em quarentena + falha NOVA → continua bloqueando')
    ok(acionamentos(x.curl).length === 0, '(b) sem P1 quando a PR bloqueia por falha nova')

    x = rodar([{ ...rev, aceitacaoSpecs: [Q1], specsProprios: [Q1] }], false, 5000, env)
    ok(merges(x.escritas).length === 0 && /spec da própria PR falhando/.test(x.log), '(c) spec da PRÓPRIA PR (mesmo em quarentena) → bloqueia')

    x = rodar([{ ...rev }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(d) aceitação vermelha sem specs legíveis → fail-closed, bloqueia')

    x = rodar([{ ...rev, aceitacaoSpecs: [Q1] }], false, 5000, { ...env, FILA_QUARENTENA_JORNADAS: join(dir, 'nao-existe.txt') })
    ok(merges(x.escritas).length === 0, '(e) sem a lista, o spec falho bloqueia (quarentena é só o que está na lista)')
  })
}

if (falhas) { console.error(`\ncheck-fila-quarentena-jornadas: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — quarentena de jornadas: ok')
