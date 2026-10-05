/**
 * Gate de build (CEO 03/10) — migration 20261003107000:
 *  PARTE 1 · fn_atak_status rápida (o briefing passava de 7 s; a API corta em 8 s):
 *    1) fn_atak_status lê ind_atak_status_resumo — não volta a contar ind_atak_fato (600 MB de jsonb) nem a varrer o
 *       erp_sync_log por domínio;
 *    2) a saída por domínio é montada com as MESMAS chaves de antes (dominio/status/linhas/dado_ate/origem/ressalva);
 *    3) a data do negócio é a MESMA expressão da versão antiga, escrita direto na consulta (sem função SQL por linha:
 *       função SQL com SET não é embutida pelo planejador e, chamada 365 mil vezes num agregado, derrubou o banco por
 *       memória na prova de 03/10 13:08);
 *    4) gatilhos por comando (tabela de transição) em inclusão/alteração/exclusão/esvaziamento de ind_atak_fato e na
 *       inclusão do erp_sync_log; os de ind_atak_fato nascem no MESMO bloco DO da carga (db push roda fora de transação);
 *    5) a regra "recalcula a maior data só quando quem a detinha baixou/saiu" é exata — simulação com sorteios abaixo.
 *  PARTE 2 · agency_equipe:
 *    6) anon sem direito; logado lê todas as colunas MENOS custo_hora; policies de leitura (empresa) e de gravação
 *       (só quem vê salário: fn__mao_obra_pode_ver_individual);
 *    7) fn_pm_equipe_custos: SECURITY DEFINER, confere a empresa, só devolve para quem vê salário, registra o acesso,
 *       fechada ao anônimo;
 *    8) as telas do P&M não leem custo_hora nem select('*') de agency_equipe; Equipe/Apontamento/Margem usam a função.
 *   npm run gates -- atak-equipe
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { COLUNAS_EQUIPE } from '../../src/lib/pm/equipeCustos'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(__dirname, '../../supabase/migrations')
const MIG = '20261003107000_atak_status_resumo_e_agency_equipe_rls.sql'
const arqs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const ultimaCom = (marca: string): { nome: string; sql: string } => {
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
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

const mig = readFileSync(join(dir, MIG), 'utf8')
const migSem = semComentario(mig)

// ── PARTE 1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const vigente = ultimaCom('FUNCTION public.fn_atak_status(')
ok(vigente.nome >= MIG, `fn_atak_status vigente vem da ${MIG} ou mais nova (achada: ${vigente.nome})`)
const st = semComentario(corpo(vigente.sql, 'fn_atak_status'))
ok(/ind_atak_status_resumo/.test(st), '1) fn_atak_status lê ind_atak_status_resumo')
ok(!/count\(\*\)\s+FROM\s+ind_atak_fato\s+f\s+WHERE\s+f\.dominio\s*=\s*m\.dominio/i.test(st), '1) não conta ind_atak_fato por domínio')
ok(!/http_response->>'dominio'\s*=\s*m\.dominio/.test(st), '1) não varre erp_sync_log por domínio')

const antiga = semComentario(corpo(readFileSync(join(dir, '20260911220000_atak_status_no_briefing.sql'), 'utf8'), 'fn_atak_status'))
const saida = (s: string) => norm((s.match(/jsonb_agg\(jsonb_strip_nulls\(jsonb_build_object\(([\s\S]*?)\)\)/) ?? [])[1] ?? '')
ok(saida(st) !== '' && saida(st) === saida(antiga), '2) saída por domínio com as mesmas chaves/valores da versão antiga')
const classif = (s: string) => norm((s.match(/CASE\s+WHEN b\.linhas = 0[\s\S]*?END AS status/) ?? [''])[0])
ok(classif(st) !== '' && classif(st) === classif(antiga), '2) mesma classificação VAZIO/PARADO/SUSPEITO/OK')

// a expressão da data do negócio na versão antiga (com o prefixo f.) — a nova usa a mesma, com o prefixo de cada consulta
const exprAntiga = (antiga.match(/max\((left\(COALESCE\(f\.raw->>'DATA_MOVTO'[\s\S]*?,10\))\)/) ?? [])[1] ?? ''
const chaves = [...exprAntiga.matchAll(/raw->>'([^']+)'/g)].map((m) => m[1])
ok(chaves.length === 7, `3) expressão da data antiga encontrada (${chaves.join(', ')})`)
const usos = [...migSem.matchAll(/left\(COALESCE\(((?:\w+\.)?raw->>'[^']+'(?:,\s*(?:\w+\.)?raw->>'[^']+')*)\),\s*10\)/g)]
  .map((m) => [...m[1].matchAll(/raw->>'([^']+)'/g)].map((x) => x[1]).join('|'))
ok(usos.length >= 6 && usos.every((u) => u === chaves.join('|')), `3) mesma expressão (mesmas chaves, mesma ordem) nos ${usos.length} usos da migration`)
ok(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[^;]*LANGUAGE\s+sql[\s\S]{0,80}SET\s+search_path/i.test(migSem.split('-- ─────────────────────────────────────────────── PARTE 2')[0]),
  '3) nenhuma função SQL (não embutível) chamada por linha na Parte 1')

const trg = (evento: string, tabela: string, ref: RegExp) =>
  new RegExp(String.raw`CREATE OR REPLACE TRIGGER \w+ AFTER ${evento} ON public\.${tabela}\s+` + ref.source + String.raw`\s*FOR EACH STATEMENT`, 'i').test(migSem)
ok(trg('INSERT', 'ind_atak_fato', /REFERENCING NEW TABLE AS novas/), '4) gatilho de inclusão em ind_atak_fato (tabela de transição)')
ok(trg('UPDATE', 'ind_atak_fato', /REFERENCING OLD TABLE AS velhas NEW TABLE AS novas/), '4) gatilho de alteração em ind_atak_fato (cobre o ON CONFLICT DO UPDATE)')
ok(trg('DELETE', 'ind_atak_fato', /REFERENCING OLD TABLE AS velhas/), '4) gatilho de exclusão em ind_atak_fato')
ok(trg('TRUNCATE', 'ind_atak_fato', /(?:)/), '4) gatilho de esvaziamento em ind_atak_fato')
ok(trg('INSERT', 'erp_sync_log', /REFERENCING NEW TABLE AS novas/), '4) gatilho de inclusão em erp_sync_log (último ciclo)')
const doCarga = (migSem.match(/DO \$carga\$[\s\S]*?\$carga\$;/) ?? [''])[0]
ok(/AFTER INSERT ON public\.ind_atak_fato/.test(doCarga) && /FROM public\.ind_atak_fato f\s+GROUP BY/.test(doCarga),
  '4) gatilhos de ind_atak_fato e carga inicial no mesmo bloco DO (contagem exata)')
const ciclo = semComentario(corpo(mig, 'fn__atak_resumo_ciclo'))
ok(/trigger_type LIKE 'coletor_atak%'/.test(ciclo) && !/fase/.test(ciclo) && /GREATEST/.test(ciclo),
  '4) último ciclo: coletor_atak%, qualquer fase, só sobe (mesma regra de antes)')
ok(/REVOKE ALL ON TABLE public\.ind_atak_status_resumo FROM PUBLIC, anon, authenticated/.test(migSem) &&
   /ind_atak_status_resumo ENABLE ROW LEVEL SECURITY/.test(migSem), '4) resumo fechado (RLS, sem direito a anon/logado)')

// 5) regra da maior data: sorteios de lotes de alteração/exclusão — o valor guardado é sempre o máximo real
type Linha = { g: number; d: string | null }
let semente = 20261003
const rnd = (n: number) => { semente = (semente * 1103515245 + 12345) % 2 ** 31; return semente % n }
const datas = [null, '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']
const maxDe = (xs: (string | null)[]) => xs.reduce<string | null>((a, b) => (b != null && (a == null || b > a) ? b : a), null)
const maior = (a: string | null, b: string | null) => maxDe([a, b])
let exatas = 0
const RODADAS = 2000
for (let r = 0; r < RODADAS; r++) {
  const linhas: Linha[] = Array.from({ length: 2 + rnd(30) }, () => ({ g: rnd(3), d: datas[rnd(datas.length)] }))
  const guardado = [0, 1, 2].map((g) => ({ n: linhas.filter((l) => l.g === g).length, mx: maxDe(linhas.filter((l) => l.g === g).map((l) => l.d)) }))
  let certo = true
  for (let passo = 0; passo < 6 && linhas.length > 0; passo++) {
    const idx = [...new Set(Array.from({ length: 1 + rnd(4) }, () => rnd(linhas.length)))]
    if (rnd(3) === 0) { // exclusão (fn__atak_resumo_fato_exc)
      const velhas = idx.map((i) => linhas[i])
      for (const i of [...idx].sort((a, b) => b - a)) linhas.splice(i, 1)
      for (const g of [0, 1, 2]) {
        const v = velhas.filter((l) => l.g === g); if (!v.length) continue
        guardado[g].n -= v.length
        const vmx = maxDe(v.map((l) => l.d))
        if (vmx != null && guardado[g].mx != null && vmx >= guardado[g].mx!) guardado[g].mx = maxDe(linhas.filter((l) => l.g === g).map((l) => l.d))
      }
    } else { // alteração (fn__atak_resumo_fato_alt): data e às vezes o grupo mudam
      const velhas = idx.map((i) => ({ ...linhas[i] }))
      for (const i of idx) linhas[i] = { g: rnd(4) === 0 ? rnd(3) : linhas[i].g, d: datas[rnd(datas.length)] }
      const novas = idx.map((i) => linhas[i])
      for (const g of [0, 1, 2]) { // 1º comando: contagem líquida e GREATEST
        const n = novas.filter((l) => l.g === g); const v = velhas.filter((l) => l.g === g)
        guardado[g].n += n.length - v.length
        guardado[g].mx = maior(guardado[g].mx, maxDe(n.map((l) => l.d)))
      }
      for (const g of [0, 1, 2]) { // 2º comando: recalcula só se quem detinha a maior baixou/saiu
        const v = velhas.filter((l) => l.g === g); if (!v.length) continue
        const vmx = maxDe(v.map((l) => l.d)); const nmx = maxDe(novas.filter((l) => l.g === g).map((l) => l.d))
        const st = guardado[g].mx
        if (vmx != null && st != null && vmx >= st && (nmx == null || nmx < st)) guardado[g].mx = maxDe(linhas.filter((l) => l.g === g).map((l) => l.d))
      }
    }
    for (const g of [0, 1, 2]) {
      const real = linhas.filter((l) => l.g === g)
      if (guardado[g].n !== real.length || guardado[g].mx !== maxDe(real.map((l) => l.d))) certo = false
    }
  }
  if (certo) exatas++
}
ok(exatas === RODADAS, `5) linhas e maior data exatas em ${exatas}/${RODADAS} sorteios de alteração/exclusão`)
const alt = norm(semComentario(corpo(mig, 'fn__atak_resumo_fato_alt')))
ok(/v\.mx >= r\.dado_ate AND \(n\.mx IS NULL OR n\.mx < r\.dado_ate\)/.test(alt), '5) a função de alteração aplica a regra simulada')
const exc = norm(semComentario(corpo(mig, 'fn__atak_resumo_fato_exc')))
ok(/WHEN v\.mx >= r\.dado_ate THEN/.test(exc), '5) a função de exclusão aplica a regra simulada')

// ── PARTE 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(/REVOKE ALL ON TABLE public\.agency_equipe FROM anon;/.test(migSem), '6) anon sem nenhum direito em agency_equipe')
ok(/REVOKE ALL ON TABLE public\.agency_equipe FROM authenticated;/.test(migSem), '6) logado perde a leitura da tabela inteira')
const grantCols = ((migSem.match(/GRANT SELECT \(([^)]*)\)\s+ON public\.agency_equipe TO authenticated/) ?? [])[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean)
ok(grantCols.length >= 8 && !grantCols.includes('custo_hora'), `6) leitura por coluna sem custo_hora (${grantCols.join(', ')})`)
ok(COLUNAS_EQUIPE.split(',').map((c) => c.trim()).every((c) => grantCols.includes(c)) && !COLUNAS_EQUIPE.includes('custo_hora'),
  '6) as colunas que a tela pede são as liberadas na migration')
ok(/CREATE POLICY \w+ ON public\.agency_equipe FOR SELECT TO authenticated\s+USING \(company_id IN \(SELECT public\.get_user_company_ids\(\)\) OR public\.is_admin\(\)\)/.test(migSem),
  '6) leitura: quem é da empresa (ou admin)')
for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
  ok(new RegExp(String.raw`CREATE POLICY \w+ ON public\.agency_equipe FOR ${cmd} TO authenticated[^;]*fn__mao_obra_pode_ver_individual\(company_id\)`).test(migSem),
    `6) ${cmd}: só quem vê salário`)
}
const fc = semComentario(corpo(mig, 'fn_pm_equipe_custos'))
const decl = mig.slice(mig.indexOf('FUNCTION public.fn_pm_equipe_custos('), mig.indexOf('$function$', mig.indexOf('FUNCTION public.fn_pm_equipe_custos(')))
ok(/SECURITY DEFINER/.test(decl) && /SET search_path TO 'public'/.test(decl), '7) fn_pm_equipe_custos: SECURITY DEFINER com search_path')
ok(/get_user_company_ids\(\)/.test(fc) && /IF NOT public\.fn__mao_obra_pode_ver_individual\(p_company_id\) THEN\s+RETURN;/.test(fc),
  '7) confere a empresa e só devolve para quem vê salário')
ok(/INSERT INTO pm_equipe_custo_acesso_log/.test(fc), '7) registra o acesso')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_equipe_custos\(uuid\) FROM PUBLIC, anon;/.test(migSem), '7) fechada ao anônimo')

const telas = ['equipe', 'apontamento-horas', 'margem-job', 'servicos'].map((t) => ({ t, src: readFileSync(`src/app/dashboard/pm/${t}/page.tsx`, 'utf8') }))
for (const { t, src } of telas) {
  const selects = [...src.matchAll(/from\('agency_equipe'\)\.select\(([^)]*)\)/g)].map((m) => m[1])
  ok(selects.every((s) => !/custo_hora|\*/.test(s)), `8) ${t}: agency_equipe sem custo_hora nem select('*')`)
}
for (const t of ['equipe', 'apontamento-horas', 'margem-job']) {
  ok(/carregarCustosEquipe\(supabase, empresa\)/.test(telas.find((x) => x.t === t)!.src), `8) ${t}: custo por pessoa via fn_pm_equipe_custos`)
}
const lib = readFileSync('src/lib/pm/equipeCustos.ts', 'utf8')
ok(/rpc\('fn__mao_obra_pode_ver_individual'/.test(lib) && /rpc\('fn_pm_equipe_custos'/.test(lib), '8) helper pergunta se pode ver e pede o custo pela função')

if (falhas) { console.error(`\n[check-atak-equipe] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-atak-equipe] fn_atak_status pelo resumo (exato, mesma saída) e agency_equipe com RLS + custo/hora protegido.')
