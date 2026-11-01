// Gate (sessao-manual 27/10, Opção 1 aprovada pelo CEO) — o @pos-migration cancela os SUPERADOS na hora, por evento,
// sem depender do cron do vigia (que o GitHub descarta sob carga). Prova, por texto, os quatro pontos que não podem
// regredir: (1) o job superados existe e roda só quando o run vai julgar (mesma condição do producao); (2) ele NÃO usa o
// grupo demo-e2e (cancelar ali derrubaria as aceitações de PR); (3) o grupo demo-e2e segue com cancel-in-progress: false;
// (4) o job usa o script de seleção do próprio repositório, com permissão actions: write.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const wf = readFileSync('.github/workflows/aceitacao-pos-migration.yml', 'utf8')
const bloco = (nome: string) => {
  const i = wf.indexOf(`\n  ${nome}:\n`)
  if (i < 0) return ''
  const resto = wf.slice(i + 1)
  const fim = resto.search(/\n  [a-z_-]+:\n/)
  return fim < 0 ? resto : resto.slice(0, fim)
}

const sup = bloco('superados')
ok(sup.length > 0, 'o job superados existe no aceitacao-pos-migration.yml')
ok(/if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.workflow_run\.conclusion == 'success'/.test(sup),
  'superados roda só quando o run vai julgar (mesma condição do producao)')
ok(!/concurrency:/.test(sup), 'superados NÃO tem concurrency (roda na hora, sem esperar o grupo demo-e2e)')
ok(/actions: write/.test(sup), 'superados tem permissão actions: write (para cancelar)')
ok(/scripts\/merge\/pos-superado-cancelar\.sh/.test(sup), 'superados chama o script de seleção do repositório')
ok(/WF: aceitacao-pos-migration\.yml/.test(sup), 'superados restringe o script ao próprio workflow')

const prod = bloco('producao')
ok(/group: demo-e2e\s*\n\s*cancel-in-progress: false/.test(prod),
  'producao segue no grupo demo-e2e com cancel-in-progress: false (fila da demo preservada)')

console.log(falhas === 0 ? '\nJob superados do @pos-migration: ok' : `\n${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
