// Gate (CEO 18/10, presente) — "FALHA COMUM = AMBIENTE" na fila de merge (regra temporária, até 21/10 18:00 BRT).
// Aceitação vermelha da PR cujas falhas são TODAS comuns a ≥2 outras PRs (últimas 6 h) NÃO bloqueia; falha só desta PR,
// spec da própria PR, dados insuficientes (<2 outras PRs) e regra vencida bloqueiam. Roda o fila-merge.sh de verdade
// contra o gh/curl simulados; a contagem das OUTRAS PRs vem do override FILA_FALHA_COMUM_CONTAGEM.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPT_FILA, comFilaSimulada, merges, comentariosEm, temFerramentas } from '../merge/fila-simulada'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sh = readFileSync(SCRIPT_FILA, 'utf8')
ok(/falha_comum_janela\(\)/.test(sh) && /falha_comum_contagem\(\)/.test(sh) && /comentar_falha_comum\(\)/.test(sh),
  'fila-merge.sh tem a regra "falha comum = ambiente" (janela, contagem das outras PRs, comentário)')
ok(/FALHA_COMUM_FIM='2026-10-21T21:00:00Z'/.test(sh), 'fim explícito no código: 21/10 18:00 BRT (21:00 UTC)')
ok(/aceitacao-pr\.yml\/runs/.test(sh), 'a contagem vem dos runs do aceitacao-pr.yml que falharam')
ok(/\$2!=this/.test(sh), 'conta OUTRAS PRs distintas (exclui a própria) por spec')
ok(/n_out:-0\}" -ge 2/.test(sh), 'limiar: spec é ambiente só com ≥2 outras PRs')

const S1 = 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts'
const S2 = 'e2e/jornadas/aceitacao/caminho-oficina-diagnostico.spec.ts'
// 2026-10-19 12:00Z: depois das janelas aceitação-revisada/baseline-main/celular (todas vencidas) e ANTES de FALHA_COMUM_FIM
const dentro = String(Math.floor(Date.UTC(2026, 9, 19, 12) / 1000))
const vencida = String(Math.floor(Date.UTC(2026, 9, 22) / 1000))   // > FALHA_COMUM_FIM

if (!temFerramentas()) {
  console.log('… cenários pulados: jq ou git ausente neste ambiente')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'fcomum-'))
  const vazia = join(dir, 'q.txt'); writeFileSync(vazia, '# vazia\n')
  const env = { FILA_QUARENTENA_JORNADAS: vazia, FILA_AGORA_EPOCH: dentro }
  const rev = { n: 1, labels: ['revisao-eng-chefe'], autorizada: true, aceitacao: 'failure' as const }
  comFilaSimulada((rodar) => {
    // (a) falha comum em 2 outras PRs → não bloqueia + comenta
    let x = rodar([{ ...rev, aceitacaoSpecs: [S1] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).join() === '1', '(a) falha comum a ≥2 outras PRs → publica')
    ok(/fila:falha-comum-/.test(x.escritas.join('\n')) && comentariosEm(x.escritas, 1).length > 0, '(a) comenta na PR as falhas de ambiente (com as PRs)')

    // (b) falha só nesta PR (S2 sem contagem) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: [S1, S2] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).length === 0, '(b) uma falha fora de ≥2 outras PRs → bloqueia')

    // (c) spec da própria PR → bloqueia mesmo sendo comum
    x = rodar([{ ...rev, aceitacaoSpecs: [S1], specsProprios: [S1] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).length === 0 && /spec da própria PR falhando/.test(x.log), '(c) spec da PRÓPRIA PR (mesmo comum) → bloqueia')

    // (d) regra vencida (> FALHA_COMUM_FIM) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: [S1] }], false, 5000, { ...env, FILA_AGORA_EPOCH: vencida, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).length === 0, '(d) regra vencida → bloqueia como antes')

    // (e) dados insuficientes: só 1 outra PR (N<2) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: [S1] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t1\t7` })
    ok(merges(x.escritas).length === 0, '(e) < 2 outras PRs (dados insuficientes) → bloqueia')

    // (f) falha ilegível (sem spec) → fail-closed
    x = rodar([{ ...rev }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).length === 0, '(f) falha ilegível → fail-closed, bloqueia')
  })
}

if (falhas) { console.error(`\ncheck-fila-falha-comum: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — falha comum = ambiente: ok')
