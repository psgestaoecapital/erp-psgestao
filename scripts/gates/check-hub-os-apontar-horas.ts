// Gate (HB0 · HBF-0.5) — a OS de obra aponta horas da equipe. O auditor PDCA (24/10) deu funcional 20 em
// /dashboard/projetos/obras/os por faltar "apontamento de mão de obra na OS". As horas entram na MESMA tabela de custo
// de MO da obra (fonte única do Resultado por obra), ligadas à OS por os_id. Sem rede: lê a migration e a tela.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024180000_hb0_os_obra_apontar_horas.sql', 'utf8')
const corpo = mig.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/projetos/obras/os/page.tsx', 'utf8')

// migration aditiva: coluna nova nullable, função nova, sem mexer em dado
ok(/ADD COLUMN IF NOT EXISTS os_id uuid REFERENCES public\.projetos_obra_os\(id\)/.test(corpo), 'os_id novo, nullable, com FK para a OS')
ok(!/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/i.test(corpo), 'sem DELETE/TRUNCATE/DROP/UPDATE — lançamentos existentes intactos')
ok((corpo.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 1 && corpo.includes('FUNCTION public.fn_obra_os_apontar_horas(p_os_id uuid, p_dados jsonb)'), 'só uma função, e nova')
ok(corpo.includes('PERFORM public.fn__guarda_empresa(v_company)'), 'guarda de empresa pela empresa da OS')
ok(/REVOKE ALL ON FUNCTION public\.fn_obra_os_apontar_horas\(uuid, jsonb\) FROM PUBLIC, anon/.test(corpo), 'anon sem EXECUTE')
ok(/v_status NOT IN \('aberta', 'em_execucao'\)/.test(corpo), 'só OS aberta ou em execução recebe horas')
ok(/v_horas IS NULL OR v_horas <= 0/.test(corpo) && /v_custo IS NULL OR v_custo < 0/.test(corpo), 'horas > 0 e custo da hora >= 0')
ok(/erp_funcao_mao_obra\s+WHERE id = v_funcao AND company_id = v_company/.test(corpo), 'função tem de ser da mesma empresa')
ok(/INSERT INTO public\.projetos_obra_mao_obra_apontamento\s*\(company_id, obra_id, os_id,/.test(corpo) && /VALUES \(v_company, v_obra, p_os_id/.test(corpo),
  'grava na tabela de custo de MO da OBRA da OS (fonte única do Resultado)')
ok(!/\bvalor\b\s*,/.test(corpo.split('INSERT INTO public.projetos_obra_mao_obra_apontamento')[1]?.split('RETURNING')[0] ?? ''), 'valor não é gravado à mão (coluna gerada horas × custo)')

// RD-95: cada "?" da tela tem chave na migration (ou na da OS de obra)
const base = ['20261023180535_hub_os_obra.sql', '20261024190000_hb0_os_obra_rdo.sql',
  // HB4 (quantidade do diário) lida pelo sufixo: a fila pode renumerar a versão
  ...readdirSync('supabase/migrations').filter(f => f.endsWith('_hb4_rdo_quantidade_avanco.sql')),
  // filtro por responsável (migration posterior ao HB0): mesma leitura por sufixo (renomeável pela fila)
  ...readdirSync('supabase/migrations').filter(f => f.endsWith('_hub_os_obra_ajuda_filtro_responsavel.sql'))]
  .map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const chaves = [...tela.matchAll(/AjudaCampo chave="([^"]+)"/g)].map(m => m[1])
const novas = ['apontar', 'horas_apontadas', 'apontar_data', 'apontar_funcao', 'apontar_horas', 'apontar_custo_hora', 'apontar_lancar'].map(c => `projetos.os_obra.${c}`)
for (const c of novas) ok(chaves.includes(c) && corpo.includes(`'${c}'`), `"?" ${c} na tela e no banco`)
ok(chaves.every(c => corpo.includes(`'${c}'`) || base.includes(`'${c}'`)), 'todo "?" da tela tem chave em migration')

// tela: chama a função nova, só nas OS ativas, soma as horas por OS
ok(tela.includes("rpc('fn_obra_os_apontar_horas'"), 'tela grava pela função com guarda')
ok(/o\.status === 'aberta' \|\| o\.status === 'em_execucao'\) && <span style=\{rot\}><button[^\n]*abrirHoras\(o\)/.test(tela), 'botão Apontar horas só em OS ativa')
ok(tela.includes(".not('os_id', 'is', null).is('excluido_em', null)"), 'total por OS ignora excluídos e lançamentos sem OS')
ok(tela.includes("horas: t.horas + Number(r.horas), valor: t.valor + Number(r.valor)"), 'total = soma de horas e de valor (coluna gerada)')

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-os-apontar-horas`); process.exit(1) }
console.log('\ncheck-hub-os-apontar-horas: verde')
