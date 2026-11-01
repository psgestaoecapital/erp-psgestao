// Gate do chamado #3963 — conciliação AGRUPADA "vazia" (conciliado, sem vínculo, sem título e sem baixa).
// 1) "Desvincular" pelo movimento libera o vazio (volta para Pendentes) sem estornar nada;
// 2) desvincular pelo TÍTULO não deixa a fatura agrupada conciliada sem nenhum título (causa-raiz);
// 3) a tela mostra a recusa do "Desvincular" (antes o aviso ficava no topo da página, fora da vista).
// A migration é achada pelo sufixo (a fila de merge pode renumerar a versão).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_conciliacao_agrupado_sem_vinculo_desvincular.sql'))
ok(!!arq, 'migration do #3963 existe')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

const mov = sql.split('CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_movimento')[1]?.split('$function$;')[0] ?? ''
ok(/'liberado_sem_vinculo', true/.test(mov), 'desvincular_movimento: conciliado sem vínculo volta para pendente')
ok(/v_mov\.status = 'conciliado' AND v_mov\.lancamento_id IS NULL/.test(mov), 'desvincular_movimento: só libera agrupado conciliado (lancamento_id nulo)')
for (const t of ['erp_pagar_baixa', 'erp_receber_baixa', 'erp_pagar ', 'erp_receber ']) {
  ok(mov.includes(`FROM public.${t}`), `desvincular_movimento: confere que nenhuma linha de ${t.trim()} aponta para o movimento`)
}
ok(/'baixa_ligada_sem_vinculo'/.test(mov), 'desvincular_movimento: com baixa ligada recusa com mensagem (não estorna nada)')
ok(/get_user_company_ids\(\)\) OR public\.is_admin\(\)/.test(mov), 'desvincular_movimento: guarda de empresa mantida')

const tit = sql.split('CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular(')[1]?.split('$function$;')[0] ?? ''
ok(/RETURNING movimento_id/.test(tit), 'desvincular (título): guarda os movimentos dos vínculos apagados')
ok(/m\.id = ANY \(v_movs_agrup\)[\s\S]*NOT EXISTS \(SELECT 1 FROM public\.conciliacao_vinculo v WHERE v\.movimento_id = m\.id\)/.test(tit),
  'desvincular (título): fatura agrupada que ficou sem título volta para pendente')
ok(/company_id IN \(SELECT get_user_company_ids\(\)\)/.test(tit), 'desvincular (título): guarda de empresa mantida')

ok(/REVOKE EXECUTE ON FUNCTION public\.fn_conciliacao_desvincular_movimento\(uuid, uuid\) FROM anon/.test(sql)
  && /REVOKE EXECUTE ON FUNCTION public\.fn_conciliacao_desvincular\(uuid, text\) FROM anon/.test(sql), 'anon sem EXECUTE nas duas funções')

ok(/rls2_backup\.conciliacao_movimento_bkp_c3963_20261021/.test(sql), 'dado: backup dos movimentos antes de liberar')
ok((sql.match(/'[0-9a-f-]{36}', '(36b69d77-b4ea-414b-8519-2ff6621c8de7|a462e13f-0f51-4c54-abe8-4474b591633b)'\)/g) || []).length === 11,
  'dado: exatamente os 11 movimentos do chamado (Pdois 6 + Gean 5)')
ok(!/UPDATE public\.erp_(pagar|receber)(_baixa)? /.test(sql.split('-- 3) Dado')[1] ?? 'x'), 'dado: não mexe em título nem em baixa')

const tela = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
const fn = tela.split('async function desvincularConciliado')[1]?.split('\n  }\n')[0] ?? ''
ok(/alert\(msg\)/.test(fn), 'tela: recusa do "Desvincular" aparece para o usuário (alert), não só no topo da página')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — conciliação agrupada vazia (#3963)`); process.exit(1) }
console.log('\ncheck-conciliacao-agrupado-vazio: ok')
