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
 * contador) libera a regra 1 para aquele arquivo — SÓ para funções da lista aprovada (anon-funcoes-aprovadas.ts).
 *
 * Regra 3 (CEO 30/09): GRANT de função a anon ou PUBLIC só para a lista aprovada pelo CEO (26 funções). Função nova
 * aberta a quem não está logado, fora da lista, reprova o PR — com ou sem SECURITY DEFINER.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANON_APROVADAS } from './anon-funcoes-aprovadas'

const MIG_DIR = join(process.cwd(), 'supabase', 'migrations')
// Migrations a partir deste timestamp são obrigadas a cumprir a régua (o saneamento é a primeira).
const CUTOFF = '20260922130000'
// Regra 3 (GRANT a anon/PUBLIC fora da lista aprovada) vale a partir da migration que fechou a lista em 26 (30/09).
// As anteriores foram saneadas pelo REVOKE em massa da PR A (20260928180000) — não reabrem nada hoje.
const CUTOFF_ANON = '20260930140000'

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
  // Regra 1 testa SEM comentarios: em 26/09 a palavra "REVOKE" de um comentario (linha 6 do 20260926120000)
  // casou o regex antigo e "cobriu" fn_seguranca_rls_auditar, que nao tinha REVOKE nenhum (PR #1810).
  const sqlSemComentarios = sql.replace(/--[^\n]*/g, '')
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

    // Regra 1 · REVOKE anon (ou escape consciente) — ANCORADO NA MESMA INSTRUCAO:
    // "REVOKE ALL|EXECUTE ON FUNCTION <fn>(<args>) FROM ... anon" sem atravessar ";" nem outras instrucoes.
    const revogaAnon = new RegExp(
      String.raw`\bREVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?` + nome +
        String.raw`\s*\([^)]*\)\s+FROM\s+[^;]*\banon\b`,
      'i',
    ).test(sqlSemComentarios)
    if (!revogaAnon && !(permiteAnon && ANON_APROVADAS.includes(nome))) {
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
  // Regra 3 · GRANT a anon/PUBLIC fora da lista aprovada (qualquer função, definer ou não)
  const versao = versaoDoArquivo(arquivo)
  if (versao !== null && versao < CUTOFF_ANON) return v
  const grantRe = /\bGRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s+TO\s+([^;]*)/gi
  let g: RegExpExecArray | null
  while ((g = grantRe.exec(sqlSemComentariosGlobal(sql))) !== null) {
    const nomeG = g[1]
    const destinos = g[2].toLowerCase()
    if (/\b(anon|public)\b/.test(destinos) && !ANON_APROVADAS.includes(nomeG)) {
      v.push({ arquivo, fn: nomeG, regra: 'grant_anon_sem_aprovacao',
        detalhe: `GRANT a anon/PUBLIC em função fora da lista aprovada pelo CEO (scripts/anon-funcoes-aprovadas.ts)` })
    }
  }
  return v
}

function sqlSemComentariosGlobal(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

// Autoteste (CEO 30/09): a régua tem de barrar função nova aberta ao anon fora da lista, e deixar passar a aprovada.
function autoteste(): void {
  const ruim = analisar('20991231000000_teste.sql', 'CREATE OR REPLACE FUNCTION public.fn_x_nova(p uuid) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;\nGRANT EXECUTE ON FUNCTION public.fn_x_nova(uuid) TO anon, authenticated;')
  const boa = analisar('20991231000000_teste.sql', 'GRANT EXECUTE ON FUNCTION public.fn_convite_ler(text) TO anon;')
  const escape = analisar('20991231000000_teste.sql', '-- ci-allow-anon: teste\nCREATE OR REPLACE FUNCTION public.fn_y_nova() RETURNS int LANGUAGE sql SECURITY DEFINER AS $f$ SELECT 1 $f$;')
  const falhou = [
    ruim.some((x) => x.regra === 'grant_anon_sem_aprovacao') ? null : 'não barrou GRANT a anon fora da lista',
    boa.length === 0 ? null : 'barrou função da lista aprovada',
    escape.some((x) => x.regra === 'revoke_anon') ? null : 'o comentário ci-allow-anon liberou função fora da lista',
  ].filter(Boolean)
  if (falhou.length) { console.error('✗ check:fn-guards — autoteste falhou: ' + falhou.join('; ')); process.exit(1) }
}

function main() {
  autoteste()
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
  console.error('  3) função aberta a quem não está logado (GRANT ... TO anon/PUBLIC) só com aprovação do CEO e o nome em scripts/anon-funcoes-aprovadas.ts.')
  process.exit(1)
}

main()
