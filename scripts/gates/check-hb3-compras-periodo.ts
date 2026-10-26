// Gate (HB3 fatia 10 · compras do período no cronograma). Sem rede. Confere a migration (só objetos novos, RLS, anon
// fechado, guarda nas duas funções, CASCADE para o reset da demo, fórmula e caso conhecido documentados) e que a tela
// mostra o quadro e o campo de itens com os "?" semeados. A conta foi provada em Postgres local 2× (caso conhecido 145,956).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024210000_hb3_cronograma_necessidades_periodo.sql', 'utf8')
const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const corpo = mig.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

ok(/CREATE TABLE IF NOT EXISTS public\.projetos_obra_tarefa_item/.test(corpo), 'tabela nova do vínculo tarefa → item')
ok((corpo.match(/ON DELETE CASCADE/g) ?? []).length >= 3, 'FKs com CASCADE: o reset da demo apaga tarefas/itens sem travar')
ok(/ENABLE ROW LEVEL SECURITY/.test(corpo) && /FOR SELECT TO authenticated/.test(corpo) && !/FOR (INSERT|UPDATE|DELETE|ALL)/.test(corpo), 'RLS por empresa só de leitura')
ok(/REVOKE ALL ON public\.projetos_obra_tarefa_item FROM PUBLIC, anon/.test(corpo), 'tabela sem acesso anon')
for (const fn of ['fn_obra_tarefa_itens_salvar(uuid, jsonb)', 'fn_obra_necessidades_periodo(uuid, date, date)'])
  ok(corpo.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon`), `${fn} sem EXECUTE para anon`)
ok((corpo.match(/PERFORM public\.fn__guarda_empresa\(v_company\)/g) ?? []).length === 2, 'guarda de empresa nas duas funções')
ok(/passaria de 100%%/.test(corpo), 'soma da participação do item limitada a 100%')
ok(/\(1 - t\.percentual \/ 100\)/.test(corpo) && /1 \+ COALESCE\(b\.perda_pct, 0\) \/ 100/.test(corpo), 'fórmula: só o que falta executar, com a perda')
ok(/WHEN v\.fim < p_de THEN 1::numeric/.test(corpo), 'tarefa atrasada entra inteira')
ok(/b\.tipo = 'insumo'/.test(corpo), 'só insumos da composição (mão de obra fica fora da compra)')
ok(mig.includes('145,956'), 'caso conhecido documentado na migration')
ok(/c\.is_demo IS TRUE/.test(corpo) && corpo.includes("'b0700000-0000-4000-a000-000000000006'"), 'vínculo inicial só na empresa DEMO')
ok(!/DELETE FROM|UPDATE public\.(?!projetos_obra_tarefa_item)|DROP (TABLE|FUNCTION|VIEW)/i.test(corpo), 'migration só aditiva')

for (const fn of ['fn_obra_tarefa_itens_salvar', 'fn_obra_necessidades_periodo']) ok(tela.includes(`'${fn}'`), `a tela chama ${fn}`)
for (const k of ['projetos.cronograma.compras', 'projetos.cronograma.compras_custo', 'projetos.cronograma.itens_tarefa', 'projetos.cronograma.participacao_item']) {
  ok(tela.includes(`"${k}"`), `a tela mostra o "?" ${k}`)
  ok(mig.includes(`'${k}'`), `chave ${k} semeada na migration`)
}
ok(tela.includes('p_ate: prox.ate'), 'compras usam o mesmo período do quadro "Próximas semanas"')

if (falhas) { console.error(`\n${falhas} falha(s) nas compras do período`); process.exit(1) }
console.log('\nCompras do período do cronograma: ok')
