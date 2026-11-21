#!/usr/bin/env tsx
// Decisão do PORTÃO @pos-migration da main (Item 4, CEO 20/11), VERSIONADA (a lógica fica no repo, não em bash solto).
// Roda no passo "Registrar status da main" do aceitacao-pos-migration.yml, DEPOIS da suíte. Imprime em stdout um JSON
// { verde, spec, n_vigentes, vencidas } que o workflow usa para montar o corpo de fn_dev_main_teste_set — sem mudar
// a função (guard rail: ela só RECEBE a decisão já computada).
//
// Entradas (env):
//   SUITE_OUTCOME  = 'success' | 'failure'  (steps.suite.outcome do Playwright; quarentenados NÃO rodam, via testIgnore)
//   PW_LOG         = caminho do log da suíte (p/ extrair o 1º spec falho quando vermelha); default /tmp/pw-pos.log
//   HOJE           = 'YYYY-MM-DD' (opcional; default = hoje UTC) — para o gate/testes controlarem a data
//
// Nunca derruba o job: em qualquer erro, decide pelo SUITE_OUTCOME puro (fail-safe) e segue.
import { readFileSync } from 'node:fs'
import { decidirVerde, hojeIso } from '../../e2e/quarentena'

function primeiroSpecFalho(logPath: string): string {
  try {
    const log = readFileSync(logPath, 'utf8')
    // 1º spec da SEÇÃO de falhas (após "N failed"); linhas de PASS não contam (mesma heurística do bash antigo)
    const corte = log.search(/^\s*\d+\s+failed/m)
    const trecho = corte >= 0 ? log.slice(corte) : log
    const m = trecho.match(/e2e\/[A-Za-z0-9_./-]+\.spec\.ts:\d+/)
    return m ? m[0] : ''
  } catch {
    return ''
  }
}

function main(): void {
  const suiteVerde = (process.env.SUITE_OUTCOME ?? '') === 'success'
  const hoje = process.env.HOJE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.HOJE) ? process.env.HOJE : hojeIso()
  const logPath = process.env.PW_LOG || '/tmp/pw-pos.log'

  const d = decidirVerde(suiteVerde, hoje)
  // spec para o banner/portão: suíte vermelha → o spec que falhou; vermelho por validade → o 1º spec vencido.
  let spec = ''
  if (!d.verde) spec = suiteVerde ? d.vencidas[0] ?? '' : primeiroSpecFalho(logPath)

  // log legível no run + JSON na última linha (o workflow pega a última linha com jq)
  console.error(`[quarentena-verde] suite=${suiteVerde ? 'verde' : 'vermelha'} hoje=${hoje} → ${d.motivo}`)
  if (d.vencidas.length) console.error(`[quarentena-verde] VENCIDAS (re-congelam): ${d.vencidas.join(', ')}`)
  console.log(JSON.stringify({ verde: d.verde, spec, n_vigentes: d.n_vigentes, vencidas: d.vencidas }))
}

main()
