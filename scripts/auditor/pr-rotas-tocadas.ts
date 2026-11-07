// Ferramenta do eng-chefe-auto (RD-97): mapeia os arquivos alterados por uma PR nas rotas do dashboard e
// diz se a PR exige auditoria COMPLETA do Hub ou só checagem barata. Estático, sem login e sem rede.
//
// Uso:
//   tsx scripts/auditor/pr-rotas-tocadas.ts <arquivo> [<arquivo> ...]   # lista explícita de arquivos da PR
//   tsx scripts/auditor/pr-rotas-tocadas.ts --git <base>                # git diff --name-only <base>...HEAD
//   git diff --name-only main...HEAD | tsx scripts/auditor/pr-rotas-tocadas.ts   # pela stdin
//   ... qualquer forma acima com --json para saída em JSON (para o relatório/caixa).
//
// A decisão (plantão, passo 2): exigeAuditoriaHub=true → auditoria completa do Hub; veredito 'outra-vertical'
// → checagem barata (abre, sem erro de console, sem 4xx/5xx/404, sem lentidão); 'sem-tela' → nada a auditar.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { classificarPR } from '../../src/lib/dev/prRotas'

function lerStdin(): string[] {
  try {
    return readFileSync(0, 'utf8').split('\n')
  } catch {
    return []
  }
}

function arquivosDoGit(base: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  return out.split('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const rest = argv.filter((a) => a !== '--json')

  let arquivos: string[] = []
  const iGit = rest.indexOf('--git')
  if (iGit >= 0) {
    const base = rest[iGit + 1]
    if (!base) {
      console.error('--git exige a ref base (ex.: --git main)')
      process.exit(2)
    }
    arquivos = arquivosDoGit(base)
  } else if (rest.length > 0) {
    arquivos = rest
  } else {
    arquivos = lerStdin()
  }

  arquivos = arquivos.map((a) => a.trim()).filter(Boolean)
  const c = classificarPR(arquivos)

  if (json) {
    console.log(JSON.stringify(c, null, 2))
    return
  }

  console.log(`veredito: ${c.veredito}  (exige auditoria do Hub: ${c.exigeAuditoriaHub ? 'SIM' : 'não'})`)
  if (c.rotasHub.length) console.log(`rotas do Hub tocadas:\n  - ${c.rotasHub.join('\n  - ')}`)
  const outras = c.rotas.filter((r) => !c.rotasHub.includes(r))
  if (outras.length) console.log(`outras rotas tocadas:\n  - ${outras.join('\n  - ')}`)
  if (c.compartilhados.length) console.log(`código compartilhado (pode afetar o Hub):\n  - ${c.compartilhados.join('\n  - ')}`)
  if (c.outros.length) console.log(`fora de tela (${c.outros.length}): ${c.outros.slice(0, 8).join(', ')}${c.outros.length > 8 ? ' …' : ''}`)
}

main()
