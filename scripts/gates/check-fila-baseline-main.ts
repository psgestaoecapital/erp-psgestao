// Gate (CEO 17/10, presente) — COMPARAÇÃO COM A MAIN na fila de merge (regra temporária de 24 h, msg bad99b31).
// Aceitação vermelha da PR cujas falhas ⊆ falhas da última aceitação da main NÃO bloqueia; falha nova, spec da PRÓPRIA PR
// e regra vencida bloqueiam como antes. Roda o fila-merge.sh de verdade contra o gh/curl simulados.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPT_FILA, comFilaSimulada, merges, comentariosEm, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/baseline_main_ativa\(\)/.test(sh) && /baseline_main_specs\(\)/.test(sh) && /comentar_herdadas_main\(\)/.test(sh),
  'fila-merge.sh tem a comparação com a main (ativa, specs da main, comentário das herdadas)')
ok(/baseline_main_ativa\(\)\s*{\s*return 0;\s*}/.test(sh), 'regra é PERMANENTE (CEO 21/10): baseline_main_ativa sempre true — a trava real é a main verde, não a data')
ok(/aceitacao-main\.yml\/runs/.test(sh), 'a lista da main vem da última aceitação da main (aceitacao-main.yml)')

const M1 = 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts'
const M2 = 'e2e/jornadas/aceitacao/tryo-anexos-264-266.spec.ts'
const NOVO = 'e2e/jornadas/aceitacao/novo-regressao.spec.ts'
const dentro = String(Math.floor(Date.UTC(2026, 9, 17, 20) / 1000))
const vencida = String(Math.floor(Date.UTC(2026, 9, 18, 18) / 1000))

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'bmain-'))
  const vazia = join(dir, 'q.txt'); writeFileSync(vazia, '# vazia\n')
  // A aceitação é informativa por padrão (esteira contínua); aqui forçamos o bloqueio (FILA_ACEITACAO_BLOQUEIA=1)
  // para exercer de verdade a lógica de comparação com a main (que só roda quando a aceitação bloqueia).
  const env = { FILA_QUARENTENA_JORNADAS: vazia, FILA_AGORA_EPOCH: dentro, FILA_BASELINE_MAIN_SPECS: `${M1}\n${M2}`, FILA_ACEITACAO_BLOQUEIA: '1' }
  const rev = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }
  comFilaSimulada((rodar) => {
    let x = rodar([{ ...rev, aceitacaoSpecs: [M1] }], false, 5000, env)
    ok(merges(x.escritas).join() === '1', '(a) falhas ⊆ main → publica')
    ok(/fila:baseline-main-/.test(x.escritas.join('\n')) && comentariosEm(x.escritas, 1).length > 0, '(a) comenta na PR as falhas herdadas da main')

    x = rodar([{ ...rev, aceitacaoSpecs: [M1, NOVO] }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(b) falha que a main não tem → bloqueia')

    x = rodar([{ ...rev, aceitacaoSpecs: [M1], specsProprios: [M1] }], false, 5000, env)
    ok(merges(x.escritas).length === 0 && /spec da própria PR falhando/.test(x.log), '(c) spec da PRÓPRIA PR (mesmo na main) → bloqueia')

    // PERMANENTE (CEO 21/10): fora da antiga janela de 24 h a regra CONTINUA valendo — a trava é a main verde, não a data.
    x = rodar([{ ...rev, aceitacaoSpecs: [M1] }], false, 5000, { ...env, FILA_AGORA_EPOCH: vencida })
    ok(merges(x.escritas).join() === '1', '(d) fora da antiga janela (>24 h) → ainda publica (regra permanente)')

    x = rodar([{ ...rev, aceitacaoSpecs: [M1] }], false, 5000, { ...env, FILA_BASELINE_MAIN_SPECS: '' })
    ok(merges(x.escritas).length === 0, '(e) main sem falhas (voltou a passar) → regra desligada, bloqueia')

    x = rodar([{ ...rev }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(f) falha ilegível → fail-closed')
  })
}

if (falhas) { console.error(`\ncheck-fila-baseline-main: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — comparação com a main: ok')
