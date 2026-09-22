/**
 * Trava de CI (item 3 · 22/09/2026) — guarda das funções do banco em migrations NOVAS.
 *
 * Defeito recorrente (4ª vez: perfil fiscal, recusa de item, lote de preços, fn_veic_atualizar_dados):
 *   (1) função SECURITY DEFINER aberta ao anon (sem REVOKE) → IDOR por chamada RPC direta;
 *   (2) autoria (created_by/updated_by/*_por/autor/usuario_id) gravada a partir de um parâmetro do
 *       CLIENTE (p_user/p_usuario/p_autor/p_operador) em vez de auth.uid() → autoria forjável.
 *
 * Este check varre supabase/migrations/*.sql com timestamp >= CUTOFF e reprova o PR nesses dois casos.
 * O passado fica "grandfathered" (o saneamento corrige os existentes por lotes) — só migration nova entra
 * na régua. Escape consciente: comentário `-- ci-allow-anon: <motivo>` no arquivo (ex.: rota pública do
 * contador) libera a regra 1 para aquele arquivo.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIG_DIR = join(process.cwd(), 'supabase', 'migrations')
// Migrations a partir deste timestamp são obrigadas a cumprir a régua (o saneamento é a primeira).
const CUTOFF = '20260922130000'

type Violacao = { arquivo: string; fn: string; regra: string; detalhe: string }

// colunas de autoria e parâmetros de usuário vindos do cliente
const AUTORIA_COL = String.raw`(?:created_by|updated_by|usuario_id|operador_id|autor|[a-z_]*_por)`
const PARAM_USER = String.raw`p_(?:user|usuario|autor|operador)(?:_id)?`
const autoriaPorParamRe = new RegExp(
  String.raw`(?:^|[\s,(])(` + AUTORIA_COL + String.raw`)\s*(?::=|=)\s*(` + PARAM_USER + String.raw`)\b`,
  'gim',
)

// blocos de função: CREATE [OR REPLACE] FUNCTION <nome>(<args>) ... AS $tag$ <corpo> $tag$
const fnHeaderRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\bAS\s+(\$[a-zA-Z0-9_]*\$)/gi

function versaoDoArquivo(nome: string): string | null {
  const m = nome.match(/^(\d{14})_/)
  return m ? m[1] : null
}

function analisar(arquivo: string, sql: string): Violacao[] {
  const v: Violacao[] = []
  const permiteAnon = /--\s*ci-allow-anon:/i.test(sql)
  let m: RegExpExecArray | null
  fnHeaderRe.lastIndex = 0
  while ((m = fnHeaderRe.exec(sql)) !== null) {
    const nome = m[1]
    const tag = m[3]
    const cabecalhoAteAS = sql.slice(m.index, m.index + m[0].length)
    const secdef = /SECURITY\s+DEFINER/i.test(cabecalhoAteAS)
    if (!secdef) continue
    // corpo: do fim do "AS $tag$" até o próximo fechamento do mesmo tag
    const inicioCorpo = m.index + m[0].length
    const fim = sql.indexOf(tag, inicioCorpo)
    const corpo = fim === -1 ? sql.slice(inicioCorpo) : sql.slice(inicioCorpo, fim)

    // Regra 1 · REVOKE anon (ou escape consciente)
    const revogaAnon = new RegExp(
      String.raw`REVOKE[\s\S]*?FUNCTION\s+(?:public\.)?` + nome + String.raw`\s*\([\s\S]*?\bFROM\b[\s\S]*?\banon\b`,
      'i',
    ).test(sql)
    if (!revogaAnon && !permiteAnon) {
      v.push({ arquivo, fn: nome, regra: 'revoke_anon',
        detalhe: `função SECURITY DEFINER sem "REVOKE ALL ON FUNCTION public.${nome}(...) FROM anon" (nem "-- ci-allow-anon: <motivo>")` })
    }

    // Regra 2 · autoria por parâmetro do cliente (sem auth.uid() na mesma atribuição)
    let a: RegExpExecArray | null
    autoriaPorParamRe.lastIndex = 0
    while ((a = autoriaPorParamRe.exec(corpo)) !== null) {
      // linha da atribuição — se citar auth.uid(), está ok (ex.: COALESCE(auth.uid(), p_user))
      const linha = corpo.slice(Math.max(0, a.index - 2), a.index + a[0].length + 40)
      if (/auth\.uid\(\)/i.test(linha)) continue
      v.push({ arquivo, fn: nome, regra: 'autoria_por_param',
        detalhe: `autoria "${a[1]}" gravada de "${a[2]}" (cliente) — use auth.uid()` })
    }
  }
  return v
}

function main() {
  let arquivos: string[]
  try { arquivos = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')) } catch { arquivos = [] }
  const alvo = arquivos.filter((f) => { const vv = versaoDoArquivo(f); return vv !== null && vv >= CUTOFF })
  const violacoes: Violacao[] = []
  for (const f of alvo) {
    try { violacoes.push(...analisar(f, readFileSync(join(MIG_DIR, f), 'utf8'))) } catch { /* ignora leitura */ }
  }
  if (violacoes.length === 0) {
    console.log(`✓ check:fn-guards — ${alvo.length} migration(s) desde ${CUTOFF} OK (REVOKE anon + autoria por auth.uid()).`)
    process.exit(0)
  }
  console.error(`✗ check:fn-guards — ${violacoes.length} violação(ões) em migrations >= ${CUTOFF}:\n`)
  for (const x of violacoes) console.error(`  · ${x.arquivo} · ${x.fn} · [${x.regra}] ${x.detalhe}`)
  console.error('\nComo corrigir:')
  console.error('  1) toda função SECURITY DEFINER: REVOKE ALL ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated, service_role;')
  console.error('     (rota pública legítima → comentar "-- ci-allow-anon: <motivo>")')
  console.error('  2) autoria (created_by/updated_by/*_por/usuario_id): usar auth.uid() (sem sessão → service_role grava sistema), nunca o p_user do cliente.')
  process.exit(1)
}

main()
