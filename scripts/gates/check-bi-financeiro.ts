// Gate · Indústria › BI Financeiro da Diretoria (Spec BIs da Indústria, 25/11/2026). Sem rede. Confere:
//  1) genérico: nenhuma empresa fixa na migration nem na tela; a tela lê só a fn_bi_financeiro_painel;
//  2) tradutor e montagem fora do alcance da tela (REVOKE de authenticated); porta fechada para anônimo;
//  3) a porta exige usuário logado + empresa do usuário e restringe à DIREÇÃO (sem gerente/diretor de área);
//  4) regime exposto com as duas visões; impostos por classificação parametrizável (tabela com RLS), nascendo 'proposta';
//  5) fronteira: só leitura do dado importado (nada gravado no ERP de origem, nada apagado, não usa contabil_dre);
//     a tela marca a visão como gerencial (não é o DRE);
//  6) "?" (RD-95) em todo indicador/filtro com a chave cadastrada; tela registrada em system_screens.
import { readFileSync, readdirSync } from 'node:fs'
import { fraseResumo, leituras, situacaoInadimplencia, situacaoMargem, type PainelFin } from '../../src/app/dashboard/inteligencia/financeiro/leitura'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_bi_financeiro_diretoria.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_bi_financeiro_diretoria.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/inteligencia/financeiro/page.tsx', 'utf8')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
ok(!UUID.test(sql.replace(/'00000000-0000-0000-0000-000000000000'/g, '')) && !UUID.test(tela), 'nenhuma empresa fixa (genérico)')
ok(/rpc\('fn_bi_financeiro_painel'/.test(tela) && !/\.from\(/.test(tela) && (tela.match(/\.rpc\(/g) || []).length === 1, 'tela lê só a fn_bi_financeiro_painel')

ok(/REVOKE ALL ON FUNCTION public\.fn_ind_fin_titulo\(uuid, text\) FROM PUBLIC, anon, authenticated/.test(sql), 'tradutor fora do alcance da tela')
ok(/REVOKE ALL ON FUNCTION public\.fn_bi_financeiro_montar\(uuid, date, date, text\) FROM PUBLIC, anon, authenticated/.test(sql), 'montagem fora do alcance da tela')
ok(/REVOKE ALL ON FUNCTION public\.fn_bi_financeiro_painel\(uuid, date, date, text\) FROM PUBLIC, anon;/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.fn_bi_financeiro_painel\(uuid, date, date, text\) TO authenticated/.test(sql), 'porta: anônimo fora, logado dentro')
const porta = sql.slice(sql.indexOf('FUNCTION public.fn_bi_financeiro_painel'))
ok(/SECURITY DEFINER/.test(porta.slice(0, 400)), 'porta SECURITY DEFINER')
ok(/IF v_uid IS NULL THEN RAISE EXCEPTION/.test(porta), 'exige usuário logado')
ok(/p_company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(porta), 'exige empresa do usuário')
ok(/'sem_acesso_financeiro'/.test(porta) && /v_role IN \('owner','socio','acesso_total','adm','admin','diretor'\)/.test(porta) && !/'gerente'|'diretor_area'/.test(porta.slice(0, porta.indexOf('RETURN public.fn_bi_financeiro_montar'))), 'restrito à direção (sem gerente/diretor de área)')
ok(/WHEN 'caixa' THEN 'caixa' ELSE 'competencia'/.test(porta), 'parâmetro regime: competência (padrão) ou caixa')
ok(/'receita_emissao'[\s\S]*'receita_caixa'/.test(sql), 'série mensal com as duas visões')

ok(/CREATE TABLE IF NOT EXISTS public\.ind_fin_classificacao/.test(sql) && /ALTER TABLE public\.ind_fin_classificacao ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON public\.ind_fin_classificacao FROM anon/.test(sql), 'classificação parametrizável com RLS e sem anônimo')
ok(/regra\s+text NOT NULL CHECK \(regra IN \('natureza', 'imposto'\)\)/.test(sql) && /status\s+text NOT NULL DEFAULT 'proposta'/.test(sql), 'slot de impostos nasce em proposta')
ok(/ORDER BY \(r\.company_id IS NULL\), r\.ordem/.test(sql), 'regra da empresa tem precedência sobre a padrão')

ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado')
ok(!/(INSERT INTO|UPDATE)\s+public\.ind_atak_fato/i.test(sql), 'não grava no dado do ERP de origem')
ok(!/contabil_dre/i.test(sql), 'não depende do contabil_dre')
ok(/Visão gerencial dos títulos — não é o DRE contábil/.test(tela), 'tela marca a visão como gerencial')

const chaves = new Set([...tela.matchAll(/(?:AjudaCampo chave|ajuda)="([^"]+)"/g)].map((m) => m[1]))
for (const m of tela.matchAll(/kpi\('[^']+', '([^']+)'/g)) chaves.add(m[1])
ok(chaves.size >= 15, `"?" na tela (${chaves.size} chaves)`)
for (const k of chaves) ok(mig.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
ok(/system_screens[\s\S]*'\/dashboard\/inteligencia\/financeiro'/.test(sql), 'tela registrada em system_screens')

// leituras: função pura com um painel mínimo
const base: PainelFin = {
  ok: true, visao: 'gerencial', aviso: '', regime: 'competencia', periodo: { de: '2026-01-01', ate: '2026-03-31', dias: 90 },
  resumo: { receita: 1000, despesa: 900, resultado: 100, margem_pct: 10, impostos: 0, titulos_receber: 3, titulos_pagar: 3 },
  anterior: { de: '2025-10-03', ate: '2025-12-31', receita: 900, despesa: 850, resultado: 50 },
  outro_regime: { regime: 'caixa', receita: 950, despesa: 900, resultado: 50 },
  meses: ['2026-01', '2026-02', '2026-03'].map((mes, i) => ({ mes, receita_emissao: 300 + i, despesa_emissao: 280, resultado_emissao: 20 + i, receita_caixa: 300, despesa_caixa: 290, resultado_caixa: 10, impostos: 0 })),
  aberto: { receber: { saldo: 500, vencido: 50, vencido_30: 20, titulos: 4, clientes_vencidos: 1 }, pagar: { saldo: 300, vencido: 0, vencido_30: 0, titulos: 2 }, inadimplencia_pct: 10, inadimplencia_30_pct: 4, adiantamentos: { clientes: 0, fornecedores: 0 }, data_base: '2026-03-31' },
  aging: [], devedores: [{ cliente: 'X', vencido: 50, titulos: 1, maior_atraso: 40 }],
  fluxo: { vencidos: { entradas: 50, saidas: 0 }, semanas: [{ semana: '2026-03-30', entradas: 10, saidas: 30, liquido: -20, acumulado: -20 }], depois: { entradas: 0, saidas: 0 } },
  impostos: { total: 0, pct_despesa: 0, por_tipo: [], credores: [], status: 'proposta', regras: [] },
  despesa_natureza: [{ natureza: 'Gado', valor: 600, titulos: 2, pct: 66.7 }], despesa_forma: [], despesa_fornecedor: [], receita_cliente: [], receita_grupo: [],
  concentracao: { top10_clientes_pct: 30, top10_fornecedores_pct: 30, receita_com_grupo_pct: 0 },
  fora_resultado: { adiant_clientes: 0, adiant_fornecedores: 0 },
  qualidade: { titulos: 6, cancelados: 0, cancelados_valor: 0, sem_classificacao: 0, ultima_importacao: null, primeira_emissao: null },
}
const ls = leituras(base)
ok(/^Resultado gerencial positivo/.test(fraseResumo(base)), 'frase-resumo diz que é gerencial')
ok(ls.length >= 4 && ls.length <= 6, `leituras para a decisão (${ls.length})`)
ok(ls.some((t) => /inadimpl|vencido/i.test(t)) && ls.some((t) => /4 semanas/.test(t)), 'leituras cobrem inadimplência e caixa')
ok(leituras({ ...base, anterior: { ...base.anterior, receita: 10 } }).some((t) => /histórico incompleto/.test(t)), 'não compara com período anterior incompleto')
ok(situacaoMargem(-1) === 'ruim' && situacaoMargem(5) === 'atencao' && situacaoMargem(10) === 'ok', 'situação da margem')
ok(situacaoInadimplencia(3) === 'ok' && situacaoInadimplencia(20) === 'ruim', 'situação da inadimplência')

if (falhas) { console.error(`\n${falhas} falha(s) — BI Financeiro da Diretoria`); process.exit(1) }
console.log('\nBI Financeiro da Diretoria ok')
