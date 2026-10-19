// Gate (19/10, gilberto-desenv): passo de workflow que roda um script DO REPO (scripts/…, e2e/…) precisa vir DEPOIS do
// actions/checkout do mesmo job. Na aceitacao-main a "Trava de segurança (vaga 1)" chamava
// scripts/merge/aceitacao-main-trava-banco.sh antes do checkout → exit 127 em ~13 s desde a #2849 (18/10): a aceitação da
// main nunca rodou, a main nunca ficou verde e o regime de construção ficou desligado para todas as PRs.
// Leitura textual do YAML (sem dependência), sem rede, banco ou variável.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }

type Passo = { nome: string; texto: string }

// Divide um workflow em jobs → passos, pela indentação de "steps:" e dos itens "- ".
export function passosPorJob(yml: string): Record<string, Passo[]> {
  const linhas = yml.split('\n')
  const jobs: Record<string, Passo[]> = {}
  let emJobs = false, job = '', indPassos = -1, atual: Passo | null = null
  const fecha = () => { if (atual && job) jobs[job].push(atual); atual = null }
  for (const l of linhas) {
    if (/^jobs:\s*$/.test(l)) { emJobs = true; continue }
    if (!emJobs) continue
    const mj = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l)
    if (mj) { fecha(); job = mj[1]; jobs[job] = []; indPassos = -1; continue }
    if (/^\S/.test(l)) { fecha(); emJobs = false; continue }
    const ms = /^(\s*)steps:\s*$/.exec(l)
    if (ms) { fecha(); indPassos = ms[1].length; continue }
    if (indPassos < 0) continue
    const ind = l.length - l.trimStart().length
    if (l.trim() && ind <= indPassos && !l.trimStart().startsWith('-')) { fecha(); indPassos = -1; continue }
    if (/^\s*- /.test(l) && ind >= indPassos && ind <= indPassos + 2) {
      fecha()
      atual = { nome: (/- (?:name|uses): (.+)$/.exec(l)?.[1] ?? '').trim(), texto: l + '\n' }
      continue
    }
    if (atual) atual.texto += l + '\n'
  }
  fecha()
  return jobs
}

// Script do repo invocado num `run:` (ignora comentários).
const chamaScript = (texto: string) =>
  texto.split('\n').filter((l) => !/^\s*#/.test(l)).some((l) => /(^|[\s;(&|"'=])(\.\/)?(scripts|e2e)\/[\w./-]+\.(sh|mjs|js|ts|py)\b/.test(l))
const ehCheckout = (texto: string) => /uses:\s*actions\/checkout@/.test(texto)

// prova do detector com o caso real (antes / depois)
const antes = `jobs:\n  a:\n    steps:\n      - name: Trava\n        run: |\n          scripts/merge/aceitacao-main-trava-banco.sh\n      - uses: actions/checkout@v4\n`
const depois = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - name: Trava\n        run: |\n          scripts/merge/aceitacao-main-trava-banco.sh\n`
const violacoes = (yml: string) => {
  const v: string[] = []
  for (const [job, passos] of Object.entries(passosPorJob(yml))) {
    let checkout = false
    for (const p of passos) {
      if (ehCheckout(p.texto)) { checkout = true; continue }
      if (!checkout && chamaScript(p.texto)) v.push(`${job} › ${p.nome || '(sem nome)'}`)
    }
  }
  return v
}
ok(violacoes(antes).length === 1 && violacoes(depois).length === 0, 'detector: acusa o script antes do checkout e aceita depois')

const dir = '.github/workflows'
for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
  const v = violacoes(readFileSync(join(dir, f), 'utf8'))
  if (v.length) ok(false, `${f}: script do repo antes do actions/checkout em ${v.join('; ')}`)
}
const main = passosPorJob(readFileSync(join(dir, 'aceitacao-main.yml'), 'utf8'))['aceitacao-main'] ?? []
const iCk = main.findIndex((p) => ehCheckout(p.texto)), iTrava = main.findIndex((p) => /Trava de segurança \(vaga 1/.test(p.nome))
ok(iCk >= 0 && iTrava > iCk, 'aceitacao-main: checkout antes da "Trava de segurança (vaga 1 …)"')
ok(iTrava >= 0 && main.slice(0, iTrava).every((p) => !/db push|psql|reconciliar/.test(p.texto)), 'aceitacao-main: nenhum acesso ao banco antes da trava')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-workflow-script-depois-do-checkout: ok')
