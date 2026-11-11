// Gate (Eng. Chefe 11/11, contexto 8c75d5d7) — RENUMERAÇÃO da fila com VERSÃO RESERVADA por rodada.
// Incidente 20261113140220: a fila renumerou DUAS PRs com migration (#4606 e #4608) na MESMA rodada e as duas
// receberam a MESMA versão (ambas calculadas a partir da última da main, que não reflete o que a rodada já atribuiu
// aos ramos das outras PRs). `schema_migrations.version` é a chave: o `db push` pulou a segunda em silêncio e o
// deploy-migrations ficou vermelho, travando a esteira.
//
// Correção: dentro de uma MESMA rodada, cada migration renumerada incrementa sobre o MAIOR entre a última da main e as
// versões já reservadas nesta rodada (piso_reservado_rodada, devolvido por renumerar_migrations em RENUM_PISO_FINAL).
//
// Parte 1: a fiação da reserva no laço da fila. Parte 2 (se houver bash): roda a função REAL proxima_versao do script e
// prova que, com o piso reservado, a 2ª renumeração recebe uma versão ESTRITAMENTE MAIOR (distinta) — enquanto sem a
// reserva (mesmo piso) as duas dariam a MESMA versão (o defeito).
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/merge/fila-merge.sh', 'utf8')
const laco = sh.slice(sh.indexOf('for n in $fila; do'))

// ── Parte 1: fiação da reserva ──────────────────────────────────────────────────────────────────────────────────────
ok(/piso_reservado_rodada=''/.test(sh) && sh.indexOf("piso_reservado_rodada=''") < sh.indexOf('for n in $fila; do'),
  'piso_reservado_rodada é zerado no início da rodada (antes do laço das PRs)')
ok(/piso_efetivo=\$ult_main/.test(laco) && /piso_reservado_rodada" '>' "\$piso_efetivo"/.test(laco),
  'piso_efetivo = MAIOR entre a última da main e o já reservado na rodada')
ok(/renumerar_migrations "\$n" "\$pj" "\$piso_efetivo"/.test(laco),
  'renumerar_migrations recebe o piso_efetivo (não só a última da main)')
ok(/piso_reservado_rodada=\$RENUM_PISO_FINAL/.test(laco),
  'após renumerar, a rodada reserva o último piso (RENUM_PISO_FINAL) para a próxima PR')
const iRenum = sh.indexOf('renumerar_migrations()')
const renum = sh.slice(iRenum, sh.indexOf('\n}\n', iRenum))
ok(/RENUM_PISO_FINAL=\$piso/.test(renum), 'renumerar_migrations devolve o seu último piso em RENUM_PISO_FINAL')

// ── Parte 2: comportamento da função REAL proxima_versao ────────────────────────────────────────────────────────────
const temBash = spawnSync('sh', ['-c', 'command -v bash']).status === 0
if (!temBash) {
  console.log('ℹ️  sem bash: Parte 2 (comportamento) pulada — Parte 1 (fiação) cobre a reserva.')
} else {
  const m = sh.match(/proxima_versao\(\)\s*\{[\s\S]*?\n\}/)
  ok(!!m, 'proxima_versao() encontrada no script')
  const corpo = m ? m[0] : ''
  const prox = (piso: string, ss: string) =>
    execFileSync('bash', ['-c', `${corpo}\nproxima_versao "$1" "$2"`, '_', piso, ss], { encoding: 'utf8' }).trim()

  const base = '20261008150005'          // "última da main" simulada
  const ss = '20'                        // faixa de segundos do agente (ex.: jordana-code)
  const v1 = prox(base, ss)              // 1ª PR renumerada
  const vMesmoPiso = prox(base, ss)      // 2ª PR SEM reserva (mesmo piso) → o defeito
  const v2 = prox(v1, ss)               // 2ª PR COM o piso reservado (= versão da 1ª)

  ok(/^[0-9]{14}$/.test(v1) && /^[0-9]{14}$/.test(v2), 'proxima_versao devolve timestamp de 14 dígitos')
  ok(v1 > base && v2 > base, 'ambas as versões ficam acima da última da main')
  ok(v1 === vMesmoPiso, 'SEM reserva (mesmo piso): 2 renumerações na mesma rodada dariam a MESMA versão (o defeito que quebrou o deploy)')
  ok(v2 > v1, 'COM o piso reservado (= versão da 1ª PR): a 2ª PR recebe versão ESTRITAMENTE MAIOR → distinta (o fix)')

  // 3 PRs na mesma rodada: encadeando a reserva, as três versões são estritamente crescentes e distintas.
  const v3 = prox(v2, ss)
  ok(v1 < v2 && v2 < v3 && new Set([v1, v2, v3]).size === 3,
    '3 PRs na mesma rodada, encadeando a reserva: versões estritamente crescentes e distintas')
}

if (falhas) { console.error(`\n✗ check:fila-renumera-reserva — ${falhas} falha(s)`); process.exit(1) }
console.log('\n✓ check:fila-renumera-reserva — renumeração reserva versão única por rodada')
