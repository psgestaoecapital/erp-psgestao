// Gate (CEO 18/10) — DESTRAVE TEMPORÁRIO do [celular]. Prova, rodando o seletor de projeto e lendo os workflows:
//  (1) a aceitação de PR NÃO roda [celular] até o CORTE (26/10 16:00 BRT, adiado de 19/10) — roda [computador];
//  (2) depois do CORTE a aceitação de PR volta a rodar [celular];
//  (3) a aceitação da MAIN roda OS DOIS projetos ([computador] E [celular]) — detecção de regressão.
// Sem rede/banco: executa o script shell com uma data falsa (ACEITACAO_AGORA_TESTE) e lê o texto dos workflows.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ler = (p: string) => readFileSync(p, 'utf8')

const SCRIPT = 'scripts/merge/aceitacao-projeto.sh'
const projeto = (dataISO: string): string =>
  execFileSync('bash', [SCRIPT], { env: { ...process.env, ACEITACAO_AGORA_TESTE: dataISO }, encoding: 'utf8' }).trim()

const sh = ler(SCRIPT)
ok(/CORTE='2026-10-26T19:00:00Z'/.test(sh), 'corte explícito no código: 2026-10-26T19:00:00Z (26/10 16:00 BRT, adiado de 19/10)')

// (1) antes do corte → computador (PR não roda celular)
ok(projeto('2026-10-18T12:00:00Z') === 'computador', '(1) antes do corte: aceitação de PR roda [computador] (não [celular])')
ok(projeto('2026-10-20T12:00:00Z') === 'computador', '(1) durante a janela adiada (20/10): ainda [computador]')
ok(projeto('2026-10-26T18:59:00Z') === 'computador', '(1) véspera do corte (18:59): ainda [computador]')
// (2) no corte e depois → celular (PR volta a rodar celular)
ok(projeto('2026-10-26T19:00:00Z') === 'celular', '(2) no instante do corte: já volta a [celular]')
ok(projeto('2026-10-27T00:00:00Z') === 'celular', '(2) depois do corte: aceitação de PR volta a rodar [celular]')

// fiação na aceitação de PR: o seletor alimenta ACEITACAO_PROJETO e os DOIS runs usam --project=${ACEITACAO_PROJETO...}
const pr = ler('.github/workflows/aceitacao-pr.yml')
ok(/scripts\/merge\/aceitacao-projeto\.sh/.test(pr) && /ACEITACAO_PROJETO=\$proj" >> "\$GITHUB_ENV"/.test(pr),
  'aceitacao-pr: passo seleciona o projeto pelo script e exporta ACEITACAO_PROJETO')
ok((pr.match(/--project=\$\{ACEITACAO_PROJETO:-celular\}/g) ?? []).length === 2,
  'aceitacao-pr: os DOIS runs usam --project=${ACEITACAO_PROJETO:-celular} (nenhum fixa [celular])')
ok(!/--project=celular\b/.test(pr), 'aceitacao-pr: nenhum run fixa --project=celular (sempre pelo seletor)')

// (3) a MAIN roda os dois projetos
const main = ler('.github/workflows/aceitacao-main.yml')
ok(/--project=computador --project=celular/.test(main),
  '(3) aceitacao-main: roda OS DOIS projetos (--project=computador --project=celular)')

if (falhas) { console.error(`\n${falhas} falha(s) — destrave temporário do [celular]`); process.exit(1) }
console.log('\ncheck-aceitacao-projeto-celular: ok')
