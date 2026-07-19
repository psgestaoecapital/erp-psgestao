/**
 * RÉGUA PERMANENTE anti-404 no menu.
 *
 * Por que existe: cadastrar um módulo (module_catalog) e criar a página (src/app) são passos
 * SEPARADOS — nada garante os dois. Quando um item fica ativo sem página real, a RPC
 * fn_modulos_sidebar_por_area sintetiza uma rota que não existe → 404 silencioso no menu.
 *
 * O que faz: cruza os itens ATIVOS do module_catalog com as páginas REAIS de src/app e
 * aponta (1) itens ativos sem rota e (2) itens cuja rota não tem página. Sai com código 1
 * se achar problema — pra travar em CI/pre-deploy. Sem credenciais, faz SKIP (exit 0).
 *
 * Uso: npm run check:menu   (precisa de NEXT_PUBLIC_SUPABASE_URL/ANON_KEY no ambiente)
 */
import { createClient } from '@supabase/supabase-js'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const APP_DIR = join(process.cwd(), 'src', 'app')

// 1 · rotas REAIS a partir do filesystem (todo page.tsx/js/ts)
export function coletarRotasReais(): string[] {
  const rotas: string[] = []
  const walk = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (/^page\.(tsx|ts|jsx|js)$/.test(nome)) {
        const relDir = relative(APP_DIR, dir)
        const segs = relDir.split(/[\\/]/).filter((s) => s && !/^\(.*\)$/.test(s)) // remove route groups (…)
        rotas.push('/' + segs.join('/'))
      }
    }
  }
  walk(APP_DIR)
  return rotas
}

// casa a rota-candidata (segmentos) contra uma rota real (que pode ter [slug] / [...slug])
function casa(candidato: string[], real: string): boolean {
  const rs = real.split('/').filter(Boolean)
  for (let i = 0; i < rs.length; i++) {
    const seg = rs[i]
    if (/^\[\.\.\..+\]$/.test(seg)) return true                 // catch-all → casa o resto
    if (i >= candidato.length) return false
    if (/^\[.+\]$/.test(seg)) continue                          // [slug] → casa 1 segmento
    if (seg !== candidato[i]) return false
  }
  return candidato.length === rs.length
}

export function rotaTemPagina(rota: string, reais: string[]): boolean {
  const path = rota.split('#')[0].split('?')[0]                 // tira hash e query
  if (!path || path === '/') return true                        // âncora na home / raiz
  const segs = path.split('/').filter(Boolean)
  if (segs.length === 0) return true
  return reais.some((r) => casa(segs, r))
}

async function main() {
  // aceita o esquema local (NEXT_PUBLIC_*) e o de CI (SUPABASE_URL + SERVICE_ROLE_KEY)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('⚠️  check:menu — SKIP (defina NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ou SUPABASE_URL/SERVICE_ROLE_KEY).')
    process.exit(0)
  }
  const sb = createClient(url, key)
  const { data, error } = await sb
    .from('module_catalog')
    .select('id, nome, grupo, rota, ativo')
    .eq('ativo', true)
  if (error) { console.error('check:menu — erro ao ler module_catalog:', error.message); process.exit(0) }

  const reais = coletarRotasReais()
  const semRota: string[] = []
  const semPagina: string[] = []

  for (const m of (data ?? []) as { id: string; nome: string; grupo: string | null; rota: string | null }[]) {
    const rota = (m.rota ?? '').trim()
    if (!rota) { semRota.push(`${m.grupo}/${m.id} (${m.nome})`); continue }
    if (/^https?:\/\//.test(rota) || rota.startsWith('/api/')) continue     // externo/API: fora do escopo
    if (!rotaTemPagina(rota, reais)) semPagina.push(`${m.grupo}/${m.id} → ${rota}`)
  }

  const problemas = semRota.length + semPagina.length
  if (semRota.length) {
    console.error(`\n🔴 ${semRota.length} item(ns) ATIVO(s) SEM ROTA (a RPC sintetiza rota morta → 404):`)
    semRota.forEach((s) => console.error('   - ' + s))
  }
  if (semPagina.length) {
    console.error(`\n🔴 ${semPagina.length} item(ns) com ROTA SEM PÁGINA real em src/app:`)
    semPagina.forEach((s) => console.error('   - ' + s))
  }
  if (problemas === 0) {
    console.log(`✅ check:menu — ${(data ?? []).length} itens ativos, todos com página real. Nenhum 404 no menu.`)
    process.exit(0)
  }
  console.error(`\n👉 Conserte: crie a página, ou aponte a rota pro placeholder /dashboard/em-construcao/<id>, ou desative o item.`)
  process.exit(1)
}

// só executa quando chamado direto (npm run check:menu) — não ao ser importado num teste
import { fileURLToPath } from 'node:url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
