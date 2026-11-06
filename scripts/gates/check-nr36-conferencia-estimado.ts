// Gate (#4032/#2119, Karol · Pausas térmicas › Conferência) · prova da correção do filtro de pendências.
// Revisor pediu prova de que a pausa com fim de origem 'estimado'/'indeterminado' passa a aparecer na Conferência
// (fn_nr36_pausas_pendentes_listar), alinhando EXATAMENTE à regra da apuração ("a estimativa do sistema não fecha o
// veredito" — decisão do CEO). Gate ESTÁTICO (sem rede/banco): confere que a migration redefine a função listando
// também as origens 'estimado'/'indeterminado', além do caso sem fim de origem efetiva.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const erro = (m: string) => { falhas++; console.error(`✗ ${m}`) }
const ok = (m: string) => console.log(`✓ ${m}`)

const MIG_DIR = join('supabase', 'migrations')
const migs = existsSync(MIG_DIR) ? readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')) : []
// acha a migration pelo conteúdo (a fila pode renumerar o arquivo): a que redefine a listagem e cita 'estimado'
const migFile = migs.find((f) => {
  const s = readFileSync(join(MIG_DIR, f), 'utf8')
  return /create\s+or\s+replace\s+function\s+public\.fn_nr36_pausas_pendentes_listar\b/i.test(s) && /'estimado'/.test(s)
})

if (!migFile) {
  erro("migration da Conferência (redefine fn_nr36_pausas_pendentes_listar incluindo 'estimado') não encontrada")
} else {
  const sql = readFileSync(join(MIG_DIR, migFile), 'utf8')
  ok(`migration da Conferência: ${migFile}`)
  const checa = (cond: boolean, m: string) => cond ? ok(`  ${m}`) : erro(`  ${m}`)
  // o WHERE precisa manter o caso sem fim efetivo E acrescentar as origens estimadas
  checa(/fn_nr36_fim_origem_efetiva\([^)]*\)\s+is\s+null/i.test(sql), 'mantém o caso sem fim de origem efetiva (IS NULL)')
  checa(/fim_origem\s+in\s*\(\s*'indeterminado'\s*,\s*'estimado'\s*\)/i.test(sql), "acrescenta fim_origem IN ('indeterminado','estimado')")
  // o acréscimo tem de estar em OR com o IS NULL (senão restringiria em vez de ampliar)
  checa(/is\s+null[\s\S]{0,120}\bor\b[\s\S]{0,120}fim_origem\s+in/i.test(sql), 'o acréscimo é por OR (amplia a lista, não restringe)')
  // só leitura: a função é STABLE (não grava nada)
  checa(/\bstable\b/i.test(sql), 'função STABLE (correção só de leitura)')
}

if (falhas) { console.error(`\n#4032/#2119: ${falhas} verificação(ões) do filtro da Conferência falharam.`); process.exit(1) }
console.log("✓ #4032/#2119: Conferência lista também as pausas 'estimado'/'indeterminado' (alinhada à apuração)")
