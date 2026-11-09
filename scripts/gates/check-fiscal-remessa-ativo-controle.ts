// Gate #5167 etapa (b): controle "em remessa" de ativo imobilizado + registro de retorno (CFOP 1554/2554). Estático.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const migs = readdirSync('supabase/migrations').filter((f) => f.includes('fiscal_remessa_ativo_retorno_controle'))
ok(migs.length === 1, 'migration do #5167 etapa (b) existe')
const sql = migs.length ? readFileSync(`supabase/migrations/${migs[0]}`, 'utf8') : ''

// Tabela nova com RLS por empresa, sem policy permissiva, REVOKE anon
ok(/CREATE TABLE IF NOT EXISTS public\.erp_fiscal_remessa_ativo_retorno/.test(sql), 'cria tabela erp_fiscal_remessa_ativo_retorno')
ok(/ALTER TABLE public\.erp_fiscal_remessa_ativo_retorno ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada na tabela')
ok(/get_user_company_ids\(\)/.test(sql) && /is_admin\(\)/.test(sql), 'policy usa guarda por empresa (get_user_company_ids/is_admin)')
const sqlSemComentarios = sql.replace(/--[^\n]*/g, '')
ok(!/USING\s*\(\s*true\s*\)/i.test(sqlSemComentarios) && !/\bqual\s*=\s*true\b/i.test(sqlSemComentarios), 'sem policy permissiva (USING true)')
ok(/REVOKE ALL ON public\.erp_fiscal_remessa_ativo_retorno FROM anon/.test(sql), 'REVOKE anon na tabela')

// CHECK dos CFOP de retorno (entrada)
ok(/CHECK \(retorno_cfop IN \('1554', ?'2554'\)\)/.test(sql), 'retorno_cfop restrito a 1554/2554 por CHECK')

// Duas RPCs SECURITY DEFINER com guarda fail-closed e search_path fixo
for (const fn of ['fn_fiscal_remessa_ativo_em_aberto', 'fn_fiscal_remessa_ativo_retorno_registrar']) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`)
  const m = sql.match(re)
  ok(!!m, `função ${fn} definida`)
  const corpo = m ? m[1] : ''
  ok(/SECURITY DEFINER/.test(sql.split(fn)[1] ?? ''), `${fn} é SECURITY DEFINER`)
  ok(/auth\.role\(\) <> 'service_role'[\s\S]*user_companies[\s\S]*'sem_acesso'/.test(corpo), `${fn} tem guarda fail-closed (sem_acesso)`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*anon`).test(sql), `${fn} sem EXECUTE para anon`)
}
// registrar valida CFOP de retorno no corpo
ok(/cfop_retorno_invalido/.test(sql), 'registrar recusa CFOP de retorno inválido')

// Sem campos de custo/margem na tabela (PILAR 2)
ok(!/\b(custo|margem|preco_custo|preço de custo)\b/i.test(sql.split('CREATE TABLE')[1]?.split(');')[0] ?? ''), 'tabela sem custo/margem')

// ADITIVA: não apaga/altera dado de cliente
ok(!/\b(DROP TABLE|TRUNCATE)\b/i.test(sql), 'não há DROP/TRUNCATE de tabela')
ok(!/\bDELETE FROM public\.erp_nfe_emitidas\b/i.test(sql), 'não apaga nota emitida de cliente')

// Seed: REMOVIDO de propósito (conserto-main, gilberto-esteira 07/11). O guard fiscal fn_bloqueia_emissao_nao_produtiva
// barra NF-e emitida em empresa DEMO/auditoria e o seed derrubava o deploy-migrations. Regra (mais forte que a antiga
// "seed só em DEMO"): a migration não semeia NF-e emitida em empresa nenhuma.
ok(!/INSERT INTO public\.erp_nfe_emitidas/i.test(sqlSemComentarios), 'migration não semeia NF-e emitida (guard fiscal barra DEMO; derrubava o deploy)')

// Ajuda RD-95 das novas chaves
ok(/erp_ajuda_campo/.test(sql) && /fiscal\.remessa_ativo\.painel/.test(sql), 'ajuda RD-95 das chaves do controle')

// Tela de Notas Emitidas monta o controle
const lista = readFileSync('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', 'utf8')
ok(/RemessaAtivoControle/.test(lista), 'Notas Emitidas monta o controle de remessa de ativo')
const comp = readFileSync('src/app/dashboard/fiscal/nfe/RemessaAtivoControle.tsx', 'utf8')
ok(comp.includes("fn_fiscal_remessa_ativo_em_aberto"), 'componente lê o controle pela RPC guardada')
ok(comp.includes("fn_fiscal_remessa_ativo_retorno_registrar"), 'componente registra retorno pela RPC guardada')
ok(/chave="fiscal\.remessa_ativo\./.test(comp), 'componente usa AjudaCampo (RD-95) nos indicadores/ações')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do controle de remessa de ativo imobilizado`); process.exit(1) }
console.log('\nOK · controle de remessa de ativo imobilizado (#5167 etapa b)')
