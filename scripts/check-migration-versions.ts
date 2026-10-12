/**
 * Régua de versão de migration (RD-52) — nasce da colisão 20260926140000 de 26/09 (#1811 x #1813).
 *
 * Defeito: dois arquivos com a mesma versão (14 dígitos). `supabase_migrations.schema_migrations.version` é a
 * chave, então quando o primeiro já está aplicado o `db push` PULA o segundo em silêncio — a migration nunca
 * entra e ninguém vê (dívida invisível). Nenhum gate cobria isso; foi pego à mão.
 *
 * 1) OFFLINE (sempre, sem segredo): duas migrations no repo com a mesma versão → falha.
 * 2) ONLINE (precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY): versão de arquivo local já presente no ledger
 *    com OUTRO nome → falha. Lê o ledger pela RPC `fn_migrations_ledger()` (service_role only; a tabela não é
 *    exposta pelo PostgREST). Sem credenciais: LOCAL = SKIP da regra 2; CI (GITHUB_ACTIONS/CI) = fail-closed.
 *    Se a RPC ainda não existe (primeiro deploy após 20260926160000) → aviso + SKIP, nunca trava o próprio deploy.
 *
 * 3) PR (git disponível, origin/main alcançável): migration NOVA (adicionada no PR) com versão menor ou igual à
 *    última versão da main → falha (CEO 05/10: cada agente usa a sua faixa de segundos e nunca volta no tempo;
 *    renomeie para uma versão acima da última da main). Sem origin/main (clone raso, local) → SKIP com aviso.
 *
 * Uso: npm run check:migrations
 */
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const MIG_DIR = join(process.cwd(), 'supabase', 'migrations')
const RE = /^(\d{14})_(.+)\.sql$/

export type Local = { arquivo: string; version: string; name: string }
export type LedgerRow = { version: string; name: string | null }

// Regra 2 isolada (pura, testável). Só acusa quando o ledger tem um NOME REAL diferente do arquivo.
// 95 linhas legadas (07/05–19/06) gravaram a própria versão como name, ou nenhum name: aí o ledger não diz
// qual migration rodou, e comparar gera falso positivo (1ª execução real, PR #1818). Essas versões seguem
// protegidas pela regra 1: reusar uma versão legada num arquivo novo deixa DOIS arquivos com a mesma versão.
export function colisoesComLedger(locaisArr: Local[], ledgerRows: LedgerRow[]): { problemas: string[]; semNomeReal: number } {
  const ledger = new Map<string, string>()
  for (const r of ledgerRows) ledger.set(String(r.version), String(r.name ?? '').trim())
  const problemas: string[] = []
  let semNomeReal = 0
  for (const l of locaisArr) {
    const nomeLedger = ledger.get(l.version)
    if (nomeLedger === undefined) continue
    if (nomeLedger === '' || nomeLedger === l.version) { semNomeReal++; continue }
    if (nomeLedger !== l.name) {
      problemas.push(`versão ${l.version} já aplicada no ledger como "${nomeLedger}" — o arquivo ${l.arquivo} seria PULADO pelo db push; renomeie para uma versão livre`)
    }
  }
  return { problemas, semNomeReal }
}

// Regra 3 isolada (pura, testável): novas versões que não passam da última da main.
export function novasAbaixoDaMain(novas: string[], versoesMain: string[]): string[] {
  if (!versoesMain.length) return []
  const ultima = versoesMain.reduce((a, b) => (b > a ? b : a))
  return novas.filter((v) => v <= ultima && !versoesMain.includes(v)).map((v) => `versão ${v} nova no PR não passa da última da main (${ultima}) — renomeie para uma versão maior, na sua faixa de segundos (AGENTS.md)`)
}

function git(args: string[]): string | null {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
}

function regra3(): string[] {
  const ls = git(['ls-tree', '--name-only', 'origin/main', 'supabase/migrations/'])
  const add = git(['diff', '--name-only', '--diff-filter=A', 'origin/main...HEAD', '--', 'supabase/migrations/'])
  if (ls === null || add === null) {
    console.warn('⚠️  check:migrations — origin/main inacessível (clone raso/local): regra "versão acima da main" SKIP.')
    return []
  }
  const ver = (f: string) => f.split('/').pop()!.match(RE)?.[1]
  const main = ls.split('\n').map(ver).filter((v): v is string => !!v)
  const novas = add.split('\n').map(ver).filter((v): v is string => !!v)
  return novasAbaixoDaMain(novas, main)
}

function locais(): Local[] {
  let files: string[]
  try { files = readdirSync(MIG_DIR) } catch { return [] }
  const out: Local[] = []
  for (const f of files) {
    const m = f.match(RE)
    if (m) out.push({ arquivo: f, version: m[1], name: m[2] })
  }
  return out.sort((a, b) => a.version.localeCompare(b.version))
}

async function main() {
  const emCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true'
  const all = locais()
  const problemas: string[] = []

  // ── Regra 1 · duplicata de versão dentro do repo (offline) ────────────────────────────────────
  const porVersao = new Map<string, Local[]>()
  for (const l of all) porVersao.set(l.version, [...(porVersao.get(l.version) ?? []), l])
  for (const [v, ls] of porVersao) {
    if (ls.length > 1) problemas.push(`versão ${v} em ${ls.length} arquivos: ${ls.map((l) => l.arquivo).join(' · ')} — só um entra no ledger; renomeie os demais`)
  }

  // ── Regra 3 · versão nova acima da última da main (git) ───────────────────────────────────────
  problemas.push(...regra3())

  // ── Regra 2 · colisão com o ledger (online) ────────────────────────────────────────────────────
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  let ledgerLido = false
  if (!url || !key) {
    if (emCI) {
      console.error('🔴 check:migrations — sem credenciais no CI (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY). Gate fail-closed: não posso comparar com o ledger.')
      process.exit(1)
    }
    console.warn('⚠️  check:migrations — sem credenciais: regra do ledger SKIP (só a duplicata offline foi checada).')
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await sb.rpc('fn_migrations_ledger')
    if (error) {
      const semRpc = /PGRST202|could not find the function|fn_migrations_ledger/i.test(`${error.code ?? ''} ${error.message ?? ''}`)
      if (semRpc) {
        console.warn('⚠️  check:migrations — RPC fn_migrations_ledger ainda não existe no banco (primeiro deploy após 20260926160000): regra do ledger SKIP.')
      } else if (emCI) {
        console.error('🔴 check:migrations — erro ao ler o ledger:', error.message, '(CI: erro de leitura não é "OK", RD-51)')
        process.exit(1)
      } else {
        console.warn('⚠️  check:migrations — erro ao ler o ledger (local, SKIP):', error.message)
      }
    } else {
      ledgerLido = true
      const rows = (data ?? []) as LedgerRow[]
      const r2 = colisoesComLedger(all, rows)
      problemas.push(...r2.problemas)
      if (r2.semNomeReal) console.log(`ℹ️  ${r2.semNomeReal} versão(ões) do ledger sem nome real (legado: name = versão) — não comparadas por nome; protegidas pela regra de duplicata.`)
      const orfaos = rows.filter((r) => !porVersao.has(String(r.version))).length
      if (orfaos) console.log(`ℹ️  ${orfaos} versão(ões) no ledger sem arquivo no repo (órfãs — ver CLAUDE.md "reconciliação"; não falha aqui).`)
    }
  }

  if (problemas.length) {
    console.error(`\n🔴 check:migrations — ${problemas.length} problema(s):`)
    problemas.forEach((p) => console.error('   - ' + p))
    console.error('\n👉 Duas migrations não podem compartilhar versão: schema_migrations.version é a chave e o db push pula a segunda em silêncio.')
    process.exit(1)
  }
  console.log(`✅ check:migrations — ${all.length} migration(s), versões únicas${ledgerLido ? ' e sem colisão com o ledger' : ''}.`)
  process.exit(0)
}

// só executa quando chamado direto (npm run check:migrations) — não ao ser importado num teste
import { fileURLToPath } from 'node:url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
