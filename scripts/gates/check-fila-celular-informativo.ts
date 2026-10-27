// Gate (CEO 17/10, presente) — REGRA TEMPORÁRIA [celular] informativo na fila de merge (msg 7dd43fa6, 24 h).
// Aceitação vermelha só no projeto celular não bloqueia; computador e spec da PRÓPRIA PR bloqueiam; vencida bloqueia.
// Roda o fila-merge.sh de verdade contra o gh/curl simulados.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPT_FILA, comFilaSimulada, merges, comentariosEm, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/celular_info_janela\(\)/.test(sh) && /pos_specs_falhos_desktop\(\)/.test(sh) && /celular_main_falhando\(\)/.test(sh) && /comentar_celular_info\(\)/.test(sh),
  'fila-merge.sh tem a regra do celular informativo')
ok(/CELULAR_INFO_INICIO='2026-10-17T19:30:00Z'/.test(sh) && /CELULAR_INFO_FIM='2026-10-18T19:30:00Z'/.test(sh), 'início e fim (24 h) registrados')

const C1 = 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts'
const C2 = 'e2e/jornadas/aceitacao/tryo-anexos-264-266.spec.ts'
const D1 = 'e2e/jornadas/aceitacao/desktop-regressao.spec.ts'
const dentro = String(Math.floor(Date.UTC(2026, 9, 17, 20) / 1000))
const vencida = String(Math.floor(Date.UTC(2026, 9, 18, 20) / 1000))

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'cel-'))
  const vazia = join(dir, 'q.txt'); writeFileSync(vazia, '# vazia\n')
  const env = { FILA_QUARENTENA_JORNADAS: vazia, FILA_AGORA_EPOCH: dentro, FILA_BASELINE_MAIN_SPECS: '', FILA_CELULAR_MAIN_FALHA: '1', JANELA_ACEITACAO_REVISADA_FIM: '2026-10-16T00:00:00Z', FILA_ACEITACAO_BLOQUEIA: '1' }
  const rev = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }
  comFilaSimulada((rodar) => {
    let x = rodar([{ ...rev, aceitacaoSpecs: [C1, C2] }], false, 5000, env)
    ok(merges(x.escritas).join() === '1', '(a) só celular → publica')
    ok(/fila:celular-info-/.test(x.escritas.join('\n')) && comentariosEm(x.escritas, 1).length > 0, '(a) comenta as falhas como informativas')

    x = rodar([{ ...rev, aceitacaoSpecs: [C1], aceitacaoSpecsDesktop: [D1] }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(b) falha no computador → bloqueia')

    x = rodar([{ ...rev, aceitacaoSpecs: [C1], specsProprios: [C1] }], false, 5000, env)
    ok(merges(x.escritas).length === 0 && /spec da própria PR falhando/.test(x.log), '(c) spec da PRÓPRIA PR → bloqueia')

    x = rodar([{ ...rev, aceitacaoSpecs: [C1] }], false, 5000, { ...env, FILA_AGORA_EPOCH: vencida })
    ok(merges(x.escritas).length === 0, '(d) vencida (>24 h) → bloqueia')

    const sem = { ...env, FILA_CELULAR_MAIN_FALHA: '' }
    x = rodar([{ ...rev, aceitacaoSpecs: [C1] }], false, 5000, { ...sem, FILA_CELULAR_MAIN_SEQ: 'ok,falha' })
    ok(merges(x.escritas).join() === '1', '(e1) main passou 1x só → regra segue, publica')
    x = rodar([{ ...rev, aceitacaoSpecs: [C1] }], false, 5000, { ...sem, FILA_CELULAR_MAIN_SEQ: 'ok,ok' })
    ok(merges(x.escritas).length === 0, '(e2) main passou 2x seguidas → regra desliga, bloqueia')
    x = rodar([{ ...rev, aceitacaoSpecs: [C1] }], false, 5000, { ...sem, FILA_CELULAR_MAIN_SEQ: 'falha,ok' })
    ok(merges(x.escritas).join() === '1', '(e3) última da main falhou → regra segue')

    x = rodar([{ ...rev }], false, 5000, env)
    ok(merges(x.escritas).length === 0, '(f) falha ilegível → fail-closed')
  })
}

if (falhas) { console.error(`\ncheck-fila-celular-informativo: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — celular informativo: ok')
