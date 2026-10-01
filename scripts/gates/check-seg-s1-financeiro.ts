// Gate (CEO 01/10 · segurança lote 1 · S1 Financeiro e banco): as funções que gravavam em qualquer empresa pelo id
// conferem a empresa DO REGISTRO antes de gravar, e a autoria vem da sessão. A régua para função nova (regra 4) fica
// em scripts/check-fn-guards.ts — aqui conferimos que ela existe. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261001180000_seg_s1_financeiro_guarda_empresa.sql', 'utf8')
const corpoDe = (fn: string): string => {
  const i = mig.search(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.` + fn + String.raw`\(`))
  if (i < 0) return ''
  const fim = mig.indexOf('$function$;', i)
  return mig.slice(i, fim < 0 ? undefined : fim).replace(/--[^\n]*/g, '')
}

ok(/IF auth\.uid\(\) IS NULL OR public\.is_admin\(\) THEN RETURN; END IF;/.test(corpoDe('fn__guarda_empresa'))
  && /NOT IN \(SELECT public\.get_user_company_ids\(\)\)/.test(corpoDe('fn__guarda_empresa'))
  && corpoDe('fn__guarda_empresa').includes("ERRCODE = '42501'"), 'conferidor: serviço e equipe PS passam; empresa alheia → 42501')

const pelaEmpresaDoRegistro: Array<[string, string]> = [
  ['fn_compra_gerar_titulos', 'v_compra.company_id'],
  ['fn_pedido_salvar_parcelas', 'v_company'],
  ['fn_cotacao_proposta_salvar', 'v_cf.company_id'],
  ['fn_dre_vincular_categoria_linha', 'v_company_id'],
  ['fn_bpo_fechamento_marcar_enviado', 'v_company'],
]
for (const [fn, alvo] of pelaEmpresaDoRegistro) {
  const c = corpoDe(fn)
  const iGuarda = c.indexOf(`PERFORM public.fn__guarda_empresa(${alvo})`)
  const iGrava = c.search(/\b(INSERT INTO|UPDATE [a-z_.]+\s+SET|DELETE FROM)\b/)
  ok(iGuarda > 0 && (iGrava < 0 || iGuarda < iGrava), `${fn}: confere a empresa do registro ANTES de gravar`)
}
for (const fn of ['sp_pluggy_register_item', 'sp_pluggy_dispatch_sync']) {
  const c = corpoDe(fn)
  const iGuarda = c.indexOf('fn_wealth_user_eh_operador(')
  const iGrava = c.search(/\bINSERT INTO\b/)
  ok(iGuarda > 0 && iGuarda < iGrava && c.includes("ERRCODE = '42501'"), `${fn}: mesma regra da RLS do Wealth, antes de gravar`)
}
const lote = corpoDe('fn_bpo_fechamento_executar_lote')
ok(/IF auth\.uid\(\) IS NOT NULL AND NOT \(public\.is_admin\(\)/.test(lote) && lote.indexOf('42501') < lote.indexOf('FOR v_company IN'),
  'fechamento em lote (todas as empresas): só equipe PS ou serviço, antes do laço')

// autoria da sessão
ok(lote.includes('COALESCE(auth.uid(), p_user_id)') && !/link_token,\s*p_user_id\s*\)/.test(lote), 'lote: gerado_por da sessão')
ok((corpoDe('fn_bpo_fechamento_marcar_enviado').match(/enviado_por = COALESCE\(enviado_por, auth\.uid\(\), p_user_id\)/g) ?? []).length === 2, 'enviado_por da sessão')
ok(corpoDe('fn_veic_custo_gerar_pagar').includes('COALESCE(auth.uid(), p_user)') && corpoDe('fn_veic_custo_gerar_pagar').includes('fn_veic_acesso('), 'veículo: acesso conferido e evento com autoria da sessão')

// nenhuma volta a ficar aberta a quem não está logado
for (const fn of ['fn__guarda_empresa', 'fn_compra_gerar_titulos', 'fn_pedido_salvar_parcelas', 'fn_cotacao_proposta_salvar', 'fn_dre_vincular_categoria_linha',
  'sp_pluggy_register_item', 'sp_pluggy_dispatch_sync', 'fn_bpo_fechamento_executar_lote', 'fn_bpo_fechamento_marcar_enviado', 'fn_veic_custo_gerar_pagar']) {
  ok(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.` + fn + String.raw`\([^)]*\) FROM PUBLIC, anon;`).test(mig), `${fn}: fechada a quem não está logado`)
}

// régua para função nova (regra 4)
const guards = readFileSync('scripts/check-fn-guards.ts', 'utf8')
ok(guards.includes("regra: 'grava_sem_guarda_empresa'") && guards.includes("CUTOFF_EMPRESA = '20261001180000'"), 'check_fn_guards barra função nova que grava sem conferir a empresa')

if (falhas) { console.error(`\ncheck-seg-s1-financeiro: ${falhas} falha(s)`); process.exit(1) }
console.log('\nSegurança S1 · financeiro: ok')
