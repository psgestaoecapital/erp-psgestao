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
ok(/pos_log_falhas\(\)/.test(sh) && /actions\/jobs\/\$1\/logs/.test(sh), 'lista completa: lê o LOG do job (falhas numeradas), não as anotações limitadas a 10')
ok(/pos_anot_falhas\(\)/.test(sh) && /PW-FALHAS-COMPLETAS/.test(sh), 'lista completa: fonte 1 = anotação única PW-FALHAS-COMPLETAS (o log dá 404 com o token da fila)')
ok(/"\$total" -ne "\$numerados"/.test(sh) && /"\$numerados" -ne "\$nomeados"/.test(sh), 'fail-closed: total ausente/≠ numeradas lidas/numerada sem spec → bloqueia')

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
  const env = { FILA_QUARENTENA_JORNADAS: vazia, FILA_AGORA_EPOCH: dentro, JANELA_ACEITACAO_REVISADA_FIM: '2026-10-16T00:00:00Z', FILA_ACEITACAO_BLOQUEIA: '1' }
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

    // (g) lista TRUNCADA: 1 spec nomeado (comum a ≥2) mas o resumo diz 5 falhas → não dá pra concluir "todas comuns" → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: [S1], aceitacaoTotal: 5 }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).length === 0 && /sem lista COMPLETA/.test(x.log), '(g) total de falhas > nomes lidos no log → bloqueia (fail-closed)')

    // (h) lista COMPLETA (total == nomeados) e todas comuns → publica (controle do caso g)
    x = rodar([{ ...rev, aceitacaoSpecs: [S1], aceitacaoTotal: 1 }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).join() === '1', '(h) lista completa (total = nomeados) e todas comuns → publica')

    // (i) P3: 11 e 30 falhas comuns (acima do teto de 10 das anotações) → lista completa pelo LOG → publica
    for (const qtd of [11, 30]) {
      const specs = Array.from({ length: qtd }, (_, k) => `e2e/jornadas/aceitacao/amb-${k}.spec.ts`)
      const cont = specs.map((sp) => `${sp}\t2\t7,8`).join('\n')
      x = rodar([{ ...rev, aceitacaoSpecs: specs }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: cont })
      ok(merges(x.escritas).join() === '1', `(i) ${qtd} falhas, todas comuns a ≥2 outras PRs (lista completa pelo log) → publica`)
      // (j) uma única falha NÃO comum entre as ${qtd} → bloqueia
      x = rodar([{ ...rev, aceitacaoSpecs: specs }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: specs.slice(1).map((sp) => `${sp}\t2\t7,8`).join('\n') })
      ok(merges(x.escritas).length === 0, `(j) ${qtd} falhas com 1 não comum → bloqueia`)
    }
    // (k) nomes lidos < total (resumo diz 30, log traz 11) → bloqueia
    const onze = Array.from({ length: 11 }, (_, k) => `e2e/jornadas/aceitacao/amb-${k}.spec.ts`)
    x = rodar([{ ...rev, aceitacaoSpecs: onze, aceitacaoTotal: 30 }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: onze.map((sp) => `${sp}\t2\t7,8`).join('\n') })
    ok(merges(x.escritas).length === 0, '(k) nomes lidos (11) < total (30) → bloqueia')
    // (l) log ilegível/ausente → bloqueia mesmo com todas comuns nas anotações
    x = rodar([{ ...rev, aceitacaoSpecs: [S1], aceitacaoSemLog: true }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: `${S1}\t2\t7,8` })
    ok(merges(x.escritas).length === 0, '(l) log do job ilegível → fail-closed, bloqueia')
    // (m) spec da própria PR entre as falhas do log (mesmo comum) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: onze, specsProprios: [onze[5]] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: onze.map((sp) => `${sp}\t2\t7,8`).join('\n') })
    ok(merges(x.escritas).length === 0 && /spec da própria PR/.test(x.log), '(m) spec da própria PR → bloqueia')

    // (n) 19/10: o log do job não é legível pelo token da fila → a lista completa vem da anotação PW-FALHAS-COMPLETAS
    // (publicada pela aceitação). 30 falhas comuns, SEM log → publica.
    const trinta = Array.from({ length: 30 }, (_, k) => `e2e/jornadas/aceitacao/amb-${k}.spec.ts`)
    const contT = trinta.map((sp) => `${sp}\t2\t7,8`).join('\n')
    x = rodar([{ ...rev, aceitacaoSpecs: trinta.slice(0, 10), aceitacaoSemLog: true, aceitacaoAnotCompleta: ['total=30', ...trinta] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: contT })
    ok(merges(x.escritas).join() === '1', '(n) 30 falhas comuns pela anotação PW-FALHAS-COMPLETAS, sem log → publica')
    // (o) total da anotação ≠ linhas → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: trinta.slice(0, 10), aceitacaoSemLog: true, aceitacaoAnotCompleta: ['total=31', ...trinta] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: contT })
    ok(merges(x.escritas).length === 0 && /sem lista COMPLETA/.test(x.log), '(o) total da anotação ≠ linhas → bloqueia')
    // (p) linha "?" (erro fora de teste/spec ilegível) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: trinta.slice(0, 10), aceitacaoSemLog: true, aceitacaoAnotCompleta: ['total=2', trinta[0], '?'] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: contT })
    ok(merges(x.escritas).length === 0, '(p) falha sem arquivo de spec na anotação → bloqueia')
    // (q) anotação "total=?" (JSON ilegível) → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: trinta.slice(0, 10), aceitacaoSemLog: true, aceitacaoAnotCompleta: ['total=?'] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: contT })
    ok(merges(x.escritas).length === 0, '(q) anotação total=? → bloqueia')
    // (r) uma não comum entre as 30 da anotação → bloqueia
    x = rodar([{ ...rev, aceitacaoSpecs: trinta.slice(0, 10), aceitacaoSemLog: true, aceitacaoAnotCompleta: ['total=30', ...trinta] }], false, 5000, { ...env, FILA_FALHA_COMUM_CONTAGEM: trinta.slice(1).map((sp) => `${sp}\t2\t7,8`).join('\n') })
    ok(merges(x.escritas).length === 0, '(r) 1 não comum entre 30 → bloqueia')
  })

  // o script que a aceitação roda: JSON do Playwright → anotação única
  const { coletar, formatar } = require('../merge/anotar-falhas-completas.cjs') as { coletar: (j: unknown) => string[]; formatar: (l: string[]) => string }
  const teste = (status: string) => ({ tests: [{ status }] })
  const lin = coletar({ suites: [{ file: 'aceitacao/a.spec.ts', suites: [{ specs: [{ file: 'aceitacao/a.spec.ts', ...teste('unexpected') }, { file: 'aceitacao/a.spec.ts', ...teste('expected') }, { file: 'aceitacao/a.spec.ts', ...teste('flaky') }, { file: 'aceitacao/a.spec.ts', ...teste('skipped') }] }] }, { file: 'aceitacao/b.spec.ts', specs: [{ file: 'aceitacao/b.spec.ts', tests: [{ status: 'unexpected' }, { status: 'unexpected' }] }] }], errors: [{ message: 'x' }] })
  ok(lin.length === 4 && lin[0] === 'e2e/jornadas/aceitacao/a.spec.ts' && lin.slice(1, 3).every((l) => l === 'e2e/jornadas/aceitacao/b.spec.ts') && lin[3] === '?',
    'anotar-falhas-completas: só "unexpected" conta (não passou/flaky/pulado), 1 linha por teste, erro fora de teste vira "?"')
  ok(formatar(lin).startsWith('total=4\n'), 'anotar-falhas-completas: mensagem começa com total=N')
}

if (falhas) { console.error(`\ncheck-fila-falha-comum: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila — falha comum = ambiente: ok')
