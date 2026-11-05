/**
 * Régua de versão de migration (RD-52) — nasce da colisão 20260926140000 de 26/09 (#1811 x #1813).
 *
 * Defeito: dois arquivos com a mesma versão (14 dígitos). `supabase_migrations.schema_migrations.version` é a
 * chave, então quando o primeiro já está aplicado o `db push` PULA o segundo em silêncio — a migration nunca
 * entra e ninguém vê (dívida invisível). Nenhum gate cobria isso; foi pego à mão.
 *
 * 1) OFFLINE (sempre, sem segredo): duas migrations no repo com a mesma versão → falha.
 * 1c) OFFLINE (aviso): dois arquivos no MESMO minuto (12 díg.) → aviso (duas PRs/agentes podem colidir na ordem).
 * 2) ONLINE (precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY): versão de arquivo local já presente no ledger
 *    com OUTRO nome → falha. Lê o ledger pela RPC `fn_migrations_ledger()` (service_role only; a tabela não é
 *    exposta pelo PostgREST). Sem credenciais: LOCAL = SKIP da regra 2; CI (GITHUB_ACTIONS/CI) = fail-closed.
 *    Se a RPC ainda não existe (primeiro deploy após 20260926160000) → aviso + SKIP, nunca trava o próprio deploy.
 * 3) ONLINE (GUARDIÃO anti-órfã, 04/11): migration local NÃO aplicada cuja versão é MENOR que a última da main
 *    (ledger) → falha. É a órfã 20261104002141: o `db push --include-all` aborta ("to be inserted before the last
 *    migration on remote") e trava o deploy em silêncio. Pega no PR, com instrução clara de renumeração.
 *
 * Uso: npm run check:migrations
 */
import { readdirSync } from 'node:fs'
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

// Regra 3 (GUARDIÃO anti-órfã) · migration fora de ordem contra o ledger da main. Pura e testável.
// Uma migration local AINDA NÃO aplicada cuja versão é MENOR que a maior versão já aplicada faz o
// `db push --include-all` abortar e travar o deploy em silêncio (órfã 20261104002141, 04/11).
export function foraDeOrdem(locaisArr: Local[], ledgerRows: LedgerRow[]): string[] {
  const aplicadas = new Set<string>()
  let maxVer = ''
  for (const r of ledgerRows) {
    const v = String(r.version)
    if (!/^\d{14}$/.test(v)) continue
    aplicadas.add(v)
    if (v > maxVer) maxVer = v
  }
  if (!maxVer) return []
  const problemas: string[] = []
  for (const l of locaisArr) {
    if (aplicadas.has(l.version)) continue // já aplicada na main — não é nova
    if (l.version < maxVer) {
      problemas.push(`migration ${l.version} (${l.arquivo}) fora de ordem: número anterior à última da main (${maxVer}). Renumere para depois de ${maxVer}.`)
    }
  }
  return problemas
}

// Aviso (não falha): dois arquivos de migration no MESMO minuto (12 díg.), segundos diferentes. A faixa de segundos
// por agente evita a duplicata exata (regra 1), mas o mesmo minuto entre PRs/agentes merece atenção na ordem.
export function colisaoMesmoMinuto(locaisArr: Local[]): string[] {
  const porMinuto = new Map<string, Local[]>()
  for (const l of locaisArr) {
    const min = l.version.slice(0, 12)
    porMinuto.set(min, [...(porMinuto.get(min) ?? []), l])
  }
  const avisos: string[] = []
  for (const [min, ls] of porMinuto) {
    if (ls.length > 1) avisos.push(`mesmo minuto ${min}: ${ls.map((l) => l.arquivo).join(' · ')} — confirme que não há colisão de ordem entre PRs`)
  }
  return avisos
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

  // ── Regra 1b · versão com data futura (offline) ────────────────────────────────────────────────
  // Versão muito à frente do relógio "trava" o ledger: toda migration normal depois dela fica MENOR que a última
  // aplicada. Tolerância de 2 dias (a esteira já usa versão do dia seguinte).
  const limite = new Date(Date.now() + 2 * 86400_000).toISOString().replace(/\D/g, '').slice(0, 14)
  for (const l of all) {
    if (l.version > limite) problemas.push(`versão ${l.version} (${l.arquivo}) está no futuro (limite ${limite}) — use o timestamp de agora`)
  }

  // ── Regra 1c · aviso de colisão no mesmo minuto (offline, não falha) ─────────────────────────────
  colisaoMesmoMinuto(all).forEach((a) => console.warn('⚠️  check:migrations — ' + a))

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
      // Regra 3 · guardião anti-órfã: migration nova com versão anterior à última da main.
      problemas.push(...foraDeOrdem(all, rows))
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
