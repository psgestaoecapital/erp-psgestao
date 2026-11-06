// Gate (Hub · semente da Construtora DEMO — lançar as viagens fechadas no GE, 25/10). Sem rede. Garante que a semente
// que leva as viagens fechadas da demo ao contas a pagar (centro de custo = obra):
//  · só age na empresa demo do Hub (…0006) e só se is_demo; sem GRANT a usuário (só service_role);
//  · no 'limpar', tira o vínculo (erp_viagem_ge_titulo) ANTES do título (erp_pagar), e só os títulos de viagem da demo;
//  · no 'semear', reaproveita a função canônica fn_viagem_lancar_ge (não duplica a criação de título) e não derruba o
//    reset se uma viagem falhar (cada lançamento num bloco com EXCEPTION);
//  · liga no fn_demo_seed_construtora por âncora (aborta se a âncora sumir).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = 'supabase/migrations/20261026170052_demo_seed_construtora_viagem_ge.sql'
const mig = readFileSync(arq, 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_viagem_ge'),
  mig.indexOf('REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_viagem_ge'))

ok(/c constant uuid := 'b0700000-0000-4000-a000-000000000006'/.test(fn), 'semente fixa na empresa demo do Hub')
ok(/p_company_id IS DISTINCT FROM c/.test(fn) && /is_demo IS TRUE/.test(fn), 'só age na 006 e só se for demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_viagem_ge\(uuid, text\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_demo_seed_construtora_viagem_ge\(uuid, text\) TO service_role/.test(mig)
  && !/GRANT EXECUTE[^;]*(authenticated|anon)/.test(mig), 'GRANT só a service_role')

// 'limpar': vínculo antes do título; erp_pagar escopado por company_id + ref_externa_sistema='viagem'
const limpar = fn.slice(fn.indexOf("p_etapa = 'limpar'"), fn.indexOf("p_etapa IS DISTINCT FROM 'semear'"))
const iGe = limpar.indexOf('DELETE FROM erp_viagem_ge_titulo')
const iPg = limpar.indexOf('DELETE FROM erp_pagar')
ok(iGe >= 0 && iPg >= 0 && iGe < iPg, "'limpar' apaga o vínculo (erp_viagem_ge_titulo) antes do título (erp_pagar)")
ok(/DELETE FROM erp_viagem_ge_titulo WHERE company_id = c;/.test(limpar), 'vínculo apagado só da empresa demo')
ok(/DELETE FROM erp_pagar WHERE company_id = c AND ref_externa_sistema = 'viagem';/.test(limpar), 'título apagado só os de viagem da empresa demo')
const delsLimpar = [...limpar.matchAll(/DELETE FROM (\w+)/g)].map((m) => m[1])
ok(delsLimpar.length === 2 && delsLimpar[0] === 'erp_viagem_ge_titulo' && delsLimpar[1] === 'erp_pagar', "'limpar' só apaga essas duas tabelas")

// 'semear': reaproveita fn_viagem_lancar_ge, impersona e não derruba o reset
const semear = fn.slice(fn.indexOf("p_etapa IS DISTINCT FROM 'semear'"))
ok(/set_config\('request\.jwt\.claim\.sub'/.test(semear) && /set_config\('request\.jwt\.claims'/.test(semear), 'impersona um usuário da demo para lançar')
ok(/public\.fn_viagem_lancar_ge\(r\.id\)/.test(semear), 'reaproveita a função canônica fn_viagem_lancar_ge')
ok(!/INSERT INTO erp_pagar/.test(fn), 'não duplica a criação de título (nenhum INSERT INTO erp_pagar na semente)')
ok(/BEGIN[\s\S]*?EXCEPTION WHEN OTHERS THEN[\s\S]*?END;/.test(semear), 'cada lançamento num bloco com EXCEPTION (falha de uma não derruba o reset)')
ok(/status = 'fechada'/.test(semear) && /NOT EXISTS \(SELECT 1 FROM public\.erp_viagem_ge_titulo/.test(semear), 'só lança viagem fechada ainda não lançada (idempotente)')

// patch por âncora no fn_demo_seed_construtora
const patch = mig.slice(mig.indexOf('DO $do$'))
ok(/pg_get_functiondef\('public\.fn_demo_seed_construtora\(uuid\)'::regprocedure\)/.test(patch)
  && (patch.match(/IF v_new = v_def THEN RAISE EXCEPTION/g) ?? []).length === 2, 'patch por âncora no fn_demo_seed_construtora (aborta se a âncora sumir)')
ok(/fn_demo_seed_construtora_viagem_ge\(c, ''limpar''\);\\n  PERFORM fn_demo_seed_construtora_fc\(c, ''limpar''\)/.test(patch), "limpa os títulos junto com os demais 'limpar'")
ok(/fn_demo_seed_construtora_viagem_ge\(c, ''semear''\);\\n  RETURN/.test(patch), 'semeia os títulos logo antes do RETURN (depois das viagens existirem)')

if (falhas) { console.error(`\n${falhas} falha(s) na semente de GE das viagens da Construtora DEMO`); process.exit(1) }
console.log('\nSemente de GE das viagens da Construtora DEMO: ok')
