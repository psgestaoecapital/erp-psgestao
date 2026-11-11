// SEGURANÇA (CEO 10/11, Pilar 2): nenhum segredo em texto puro no repositório.
// Reprova migration (supabase/migrations) que grave literal de segredo do robô (header x-watcher-secret) ou
// chave de API no corpo. O valor real vive no cofre do banco (vault, nome screen_watcher_secret) e nas
// variáveis de ambiente da Vercel/edge. No repositório fica só o placeholder "<segredo no cofre: ...>".
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')

// Literal do robô: a forma antiga do segredo (prefixo ps-watcher-) gravada no código.
const LITERAL_ROBO = /ps-watcher-[A-Za-z0-9_-]{8,}/
// Header do robô com valor literal entre aspas (placeholder com "<" não conta).
const HEADER_LITERAL = /'x-watcher-secret'\s*,\s*'(?!<)[^']{12,}'/
// Chave de API comum (ex.: Anthropic) com corpo real, sem aspas de placeholder.
const CHAVE_API = /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/

export function achados(nome: string, conteudo: string): string[] {
  const out: string[] = []
  if (LITERAL_ROBO.test(conteudo)) out.push(`${nome}: literal do segredo do robô (ps-watcher-…)`)
  if (HEADER_LITERAL.test(conteudo)) out.push(`${nome}: header x-watcher-secret com valor literal`)
  if (CHAVE_API.test(conteudo)) out.push(`${nome}: chave de API em texto puro`)
  return out
}

const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql'))
const problemas = arquivos.flatMap((f) => achados(f, readFileSync(join(DIR, f), 'utf8')))

if (problemas.length) {
  console.error(`✗ segredo em texto puro em ${problemas.length} ponto(s):`)
  for (const p of problemas) console.error('  - ' + p)
  process.exit(1)
}
console.log(`✓ nenhum segredo em texto puro em ${arquivos.length} migration(s)`)
