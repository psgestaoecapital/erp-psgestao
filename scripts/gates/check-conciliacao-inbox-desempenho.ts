/**
 * Gate de build (Jordana/BPO · Gean, 02/10): o inbox da conciliação dava 500 por statement timeout (>55 s na maior
 * empresa). A migration 20261003100000 calcula as sugestões de todos os movimentos numa consulta só. Este gate segura:
 *   1) o inbox não volta a chamar a sugestão / a contagem UMA VEZ POR MOVIMENTO;
 *   2) a sugestão em lote não volta a chamar fn_pagar/receber_valor_referencia por título (consulta por par);
 *   3) o par movimento × título sai por igualdade de data (junção por hash), não por faixa;
 *   4) os descartes antes do texto continuam EXATOS: dependem de o texto valer no máximo 20 pontos e de a nota mínima
 *      ser 30 — a simulação abaixo prova que o top-k com descarte é o mesmo de sem descarte;
 *   5) nada de SECURITY DEFINER e nada aberto ao anônimo nas funções novas.
 *   npm run gates -- conciliacao-inbox
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(__dirname, '../../supabase/migrations')
// a versão vigente é a da migration mais nova que (re)cria cada função
const ultimaCom = (marca: string): { nome: string; sql: string } => {
  const arqs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (let i = arqs.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(dir, arqs[i]), 'utf8')
    if (sql.includes(marca)) return { nome: arqs[i], sql }
  }
  return { nome: '', sql: '' }
}
const corpo = (sql: string, fn: string): string => {
  const i = sql.indexOf(`FUNCTION public.${fn}(`)
  if (i < 0) return ''
  const a = sql.indexOf('$function$', i)
  const b = sql.indexOf('$function$', a + 10)
  return a < 0 || b < 0 ? '' : sql.slice(a, b)
}
const semComentario = (s: string) => s.replace(/--[^\n]*/g, '')

const lote = ultimaCom('FUNCTION public.fn_conciliacao_sugerir_match_lote(')
const inbox = ultimaCom('FUNCTION public.fn_conciliacao_inbox(')
const fLote = semComentario(corpo(lote.sql, 'fn_conciliacao_sugerir_match_lote'))
const fInbox = semComentario(corpo(inbox.sql, 'fn_conciliacao_inbox'))
ok(fLote.length > 0, `sugestão em lote encontrada (${lote.nome})`)
ok(fInbox.length > 0, `inbox encontrado (${inbox.nome})`)

// 1) inbox: uma consulta para o lote inteiro
ok(/fn_conciliacao_sugerir_match_lote\s*\(\s*v_ids/.test(fInbox), 'inbox pede as sugestões do lote inteiro de uma vez')
ok(/fn_conciliacao_qtd_candidatos_lote\s*\(\s*v_ids/.test(fInbox), 'inbox conta os candidatos do lote inteiro de uma vez')
ok(!/fn_conciliacao_sugerir_match\s*\(\s*m\./.test(fInbox) && !/fn_conciliacao_qtd_candidatos\s*\(\s*m\./.test(fInbox),
  'inbox não chama sugestão/contagem por movimento')

// 2) sem consulta por título
ok(!/fn_(pagar|receber)_valor_referencia/.test(fLote), 'valor de referência calculado dentro da consulta (sem função por título)')

// 3) junção por igualdade de data
ok(/generate_series\s*\(\s*-15\s*,\s*15\s*\)/.test(fLote) && /t\.venc\s*=\s*mv\.venc_alvo/.test(fLote),
  'par movimento × título por igualdade de data (31 dias da janela de ±15)')

// 4) premissas dos descartes exatos
const bonus = [...fLote.matchAll(/ts\.sim\s*>=\s*[\d.]+\s+THEN\s+(\d+)/g)].map((m) => Number(m[1]))
const MAX_TEXTO = Math.max(0, ...bonus)
ok(bonus.length === 3 && MAX_TEXTO === 20, `semelhança de texto vale no máximo 20 pontos (achado: ${bonus.join('/') || '—'})`)
ok(/score\s*>\s*30/.test(fLote), 'sugestão exige nota > 30')
ok(/nota_base\s*>\s*10/.test(fLote), 'descarte 1: nota sem texto <= 10 (30 − 20) fica de fora')
ok(/nota_base\s*\+\s*20\s*>=\s*c\.kth/.test(fLote), 'descarte 2: nota sem texto + 20 abaixo da k-ésima fica de fora')

// simulação: top-k com e sem descarte (mesma ordem de desempate da função: nota, vencimento, id)
type Par = { id: number; venc: number; base: number; texto: number }
let semente = 20261003
const rnd = (n: number) => { semente = (semente * 1103515245 + 12345) % 2 ** 31; return semente % n }
const BASES = [0, 10, 15, 25, 30, 40, 45, 50, 55, 65, 70, 75, 80, 95, 105, 120, 150]
const TEXTOS = [0, 5, 10, 20]
const topk = (pares: Par[], k: number) => pares
  .map((p) => ({ ...p, score: p.base + p.texto })).filter((p) => p.score > 30)
  .sort((a, b) => b.score - a.score || a.venc - b.venc || a.id - b.id).slice(0, k).map((p) => `${p.id}:${p.score}`).join(',')
let iguais = 0
const RODADAS = 3000
for (let r = 0; r < RODADAS; r++) {
  const k = 1 + rnd(5)
  const pares: Par[] = Array.from({ length: 1 + rnd(40) }, (_, id) => ({ id, venc: rnd(31), base: BASES[rnd(BASES.length)], texto: TEXTOS[rnd(TEXTOS.length)] }))
  const vivos = pares.filter((p) => p.base > 30 - MAX_TEXTO)
  const ord = [...vivos].sort((a, b) => b.base - a.base)
  const kth = ord.length >= k ? ord[k - 1].base : null
  const podados = vivos.filter((p) => kth === null || p.base + MAX_TEXTO >= kth)
  if (topk(pares, k) === topk(podados, k)) iguais++
}
ok(iguais === RODADAS, `descartes exatos: top-k igual com e sem descarte em ${iguais}/${RODADAS} sorteios`)

// 5) segurança
for (const fn of ['fn_conciliacao_sugerir_match_lote', 'fn_conciliacao_qtd_candidatos_lote']) {
  const m = ultimaCom(`FUNCTION public.${fn}(`)
  const decl = m.sql.slice(m.sql.indexOf(`FUNCTION public.${fn}(`), m.sql.indexOf('$function$', m.sql.indexOf(`FUNCTION public.${fn}(`)))
  ok(!/SECURITY\s+DEFINER/i.test(decl), `${fn}: SECURITY INVOKER (a RLS do usuário vale)`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`).test(m.sql), `${fn}: fechada ao anônimo`)
}

if (falhas) { console.error(`\n[check-conciliacao-inbox-desempenho] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-conciliacao-inbox-desempenho] inbox da conciliação em lote, sem consulta por movimento/título, descartes exatos.')
