// Gate (HB3 fatia 10 · o que comprar no período do cronograma). Sem rede. Confere a migration: tabela nova com RLS e
// REVOKE anon, gravação só pelas funções com guarda de empresa, item da MESMA obra, cálculo pela composição (insumo ×
// perda × o que falta da tarefa) e os "?" semeados; e que a tela mostra o quadro e o vínculo com os "?".
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024220000_hb3_cronograma_fatia10_necessidades_periodo.sql', 'utf8')
const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')

ok(/CREATE TABLE IF NOT EXISTS public\.projetos_obra_tarefa_item/.test(mig), 'tabela nova projetos_obra_tarefa_item')
ok(/ALTER TABLE public\.projetos_obra_tarefa_item ENABLE ROW LEVEL SECURITY/.test(mig), 'RLS ligada')
ok(/REVOKE ALL ON public\.projetos_obra_tarefa_item FROM PUBLIC, anon/.test(mig), 'REVOKE anon na tabela')
ok(/FOR SELECT TO authenticated\s+USING \(public\.is_admin\(\) OR company_id IN \(SELECT public\.get_user_company_ids\(\)\)\)/.test(mig), 'policy só de leitura, por empresa')
ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)/i.test(mig), 'sem grant de escrita direta')

const fns = ['fn_obra_tarefa_item_salvar', 'fn_obra_tarefa_item_excluir', 'fn_obra_necessidades_periodo']
for (const fn of fns) {
  const corpo = mig.split(`CREATE OR REPLACE FUNCTION public.${fn}(`)[1]?.split('END $$;')[0] ?? ''
  ok(corpo.length > 0, `${fn} criada`)
  ok(/SECURITY DEFINER SET search_path TO 'public'/.test(corpo), `${fn}: SECURITY DEFINER com search_path`)
  ok(corpo.includes('PERFORM public.fn__guarda_empresa('), `${fn}: guarda de empresa`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`).test(mig), `${fn}: REVOKE anon`)
}
const salvar = mig.split('FUNCTION public.fn_obra_tarefa_item_salvar(')[1].split('END $$;')[0]
ok(/obra_id = v_obra AND company_id = v_company/.test(salvar), 'vínculo só com item da MESMA obra e empresa')
const calc = mig.split('FUNCTION public.fn_obra_necessidades_periodo(')[1].split('END $$;')[0]
ok(/STABLE/.test(mig.split('FUNCTION public.fn_obra_necessidades_periodo(')[1].slice(0, 200)), 'cálculo é só leitura (STABLE)')
ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(calc), 'cálculo não grava')
ok(calc.includes("b.tipo = 'insumo'") && calc.includes('(1 + COALESCE(b.perda_pct, 0) / 100.0)') && calc.includes('(1 - tar.percentual / 100.0)')
  && calc.includes('ti.percentual / 100.0'), 'quantidade = contratada × parte × consumo × (1 + perda) × o que falta')
ok(calc.includes('t.percentual < 100'), 'tarefa concluída fica fora')
ok(!/\bDELETE FROM\b|\bDROP (TABLE|FUNCTION|VIEW)\b/i.test(mig), 'migration só aditiva (sem DELETE/DROP)')
ok(!/UPDATE public\.(?!projetos_obra_tarefa_item\b)/.test(mig), 'só atualiza a tabela nova (exclusão lógica)')

const chaves = ['projetos.cronograma.necessidades', 'projetos.cronograma.itens_tarefa', 'projetos.cronograma.itens_tarefa_parte']
for (const k of chaves) {
  ok(mig.includes(`'${k}'`), `chave ${k} semeada na migration`)
  ok(tela.includes(`"${k}"`), `a tela mostra o "?" ${k}`)
}
for (const fn of fns) ok(tela.includes(`'${fn}'`), `a tela chama ${fn}`)

if (falhas) { console.error(`\n${falhas} falha(s) no "o que comprar no período"`); process.exit(1) }
console.log('\nO que comprar no período (cronograma): ok')
