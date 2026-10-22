// Gate (CEO 14/10, incidente 5W2H): CREATE OR REPLACE de função com ASSINATURA NOVA não substitui a antiga — cria um
// OVERLOAD. Para RPC do PostgREST, duas assinaturas do mesmo nome deixam a chamada ambígua (PGRST203) e quebram a tela.
// Regra: uma migration NOVA da PR não pode deixar uma função public.* com MAIS DE UMA assinatura viva. Se adiciona uma
// assinatura nova, tem de DROPar a(s) antiga(s) na mesma leva. Dívida histórica (overloads que já estavam na main e a PR
// não toca) não entra — este gate é só sobre o que a PR cria. Compara com o merge-base da origin/main; sem base → aviso.
// Sem rede.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).trim()

// assinatura canônica: lista de TIPOS (sem nome de parâmetro p_*, sem DEFAULT, sem modo IN/OUT/VARIADIC)
function canonSig(args: string): string {
  const s = args.trim()
  if (!s) return ''
  const partes: string[] = []
  let prof = 0, atual = ''
  for (const ch of s) {
    if (ch === '(') prof++
    else if (ch === ')') prof--
    if (ch === ',' && prof === 0) { partes.push(atual); atual = '' } else atual += ch
  }
  if (atual.trim()) partes.push(atual)
  return partes.map((p) => {
    let t = p.trim().replace(/\s+default\s+[\s\S]*$/i, '').trim()      // tira DEFAULT ...
    t = t.replace(/^(in|out|inout|variadic)\s+/i, '').trim()           // tira modo
    t = t.replace(/^p_[a-z0-9_]+\s+/i, '').trim()                      // tira nome do parâmetro (convenção p_*)
    return t.toLowerCase().replace(/\s+/g, ' ')
  }).join(', ')
}

type Ev = { nome: string; sig: string; arquivo: string }
function eventos(sql: string, arquivo: string): { cria: Ev[]; dropa: Ev[] } {
  const cria: Ev[] = [], dropa: Ev[] = []
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\)\s*returns/gi))
    cria.push({ nome: m[1].toLowerCase(), sig: canonSig(m[2]), arquivo })
  for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\)/gi))
    dropa.push({ nome: m[1].toLowerCase(), sig: canonSig(m[2]), arquivo })
  return { cria, dropa }
}

function arquivosNovosDaPR(): Set<string> | null {
  for (const ref of ['origin/main', 'main']) {
    try {
      const base = git('merge-base', 'HEAD', ref)
      if (!base) continue
      return new Set(git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`).split('\n')
        .filter((f) => f.startsWith(DIR + '/') && f.endsWith('.sql')))
    } catch { /* tenta a próxima ref */ }
  }
  return null
}

const novos = arquivosNovosDaPR()
if (novos === null) { console.log('· aviso: sem merge-base com a main — gate de overload não rodou nesta execução'); process.exit(0) }
if (!existsSync(DIR)) { console.log('· sem pasta de migrations'); process.exit(0) }

// aplica todas as migrations em ordem de nome, guardando quais assinaturas de cada função ficam vivas e de que arquivo vieram
const vivos = new Map<string, Map<string, string>>()   // nome -> (sig -> arquivo que a criou)
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
  const { cria, dropa } = eventos(readFileSync(join(DIR, f), 'utf8'), f)
  for (const e of cria) { if (!vivos.has(e.nome)) vivos.set(e.nome, new Map()); vivos.get(e.nome)!.set(e.sig, e.arquivo) }
  for (const e of dropa) vivos.get(e.nome)?.delete(e.sig)
}

let falhas = 0
for (const [nome, sigs] of vivos) {
  if (sigs.size < 2) continue
  // só reprova se ALGUMA das assinaturas vivas foi criada por um arquivo NOVO da PR (dívida histórica intocada não entra)
  const daPR = [...sigs.values()].some((arq) => novos.has(DIR + '/' + arq))
  if (!daPR) continue
  falhas++
  console.error(`✗ public.${nome} ficou com ${sigs.size} assinaturas vivas (overload — PGRST203 ambíguo):`)
  for (const [sig, arq] of sigs) console.error(`    (${sig})  ← ${arq}`)
  console.error(`  → a migration que muda a assinatura precisa DROP FUNCTION IF EXISTS da(s) assinatura(s) antiga(s) na mesma leva.`)
}

if (falhas) { console.error(`\n${falhas} função(ões) com overload introduzido pela PR. Dropar a assinatura antiga (ver incidente #2573).`); process.exit(1) }
console.log('✓ RPC sem overload: nenhuma função public.* da PR ficou com assinatura duplicada')
