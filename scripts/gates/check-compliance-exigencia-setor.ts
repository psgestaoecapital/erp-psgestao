/**
 * Gate de build · Chamado #42 (Frioeste): treinamentos exigidos por SETOR, em união aditiva (RD-55) e fonte única (RD-65).
 *   tsx scripts/gates/check-compliance-exigencia-setor.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const mig = readFileSync('supabase/migrations/20261005130000_compliance_exigencia_setor.sql', 'utf8')
const view = mig.slice(mig.indexOf('CREATE OR REPLACE VIEW public.v_compliance_matriz_funcionarios'), mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_docs'))
const fnDocs = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_docs'), mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_compliance_setor_exigencias_listar'))

ok(/CREATE TABLE IF NOT EXISTS public\.compliance_exigencia_setor/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig), 'tabela nova com RLS')
ok(/UNIQUE INDEX IF NOT EXISTS uq_exig_setor/.test(mig), 'uma marca por setor × exigido')
ok(!/DROP |DELETE FROM|TRUNCATE/i.test(mig.replace(/ON DELETE CASCADE/g, '')), 'migration aditiva: nada é apagado (RD-55)')
// fonte única: a view da matriz e a função da aba Documentos leem a MESMA tabela
ok(/FROM compliance_exigencia_setor es/.test(view), 'a matriz lê a exigência por setor')
ok(/FROM public\.compliance_exigencia_setor es/.test(fnDocs), 'a aba Documentos do funcionário lê a mesma tabela')
// união: o escopo atual (cargo/setor) e a marcação da pessoa continuam na view
ok(/ex\.funcao IS NULL OR/.test(view) && /ex\.setor_id IS NULL OR ex\.setor_id = f\.setor_id/.test(view) && /compliance_exigencia_pessoa ip/.test(view), 'view mantém escopo atual e marcação da pessoa (só acrescenta)')
ok(/\(d\.em_escopo OR d\.por_setor OR d\.incluido\) AND NOT d\.dispensado/.test(fnDocs), 'função: aplica = escopo OU setor OU pessoa, e dispensa continua valendo')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_compliance_setor_exigencias_salvar/.test(mig) && /fn_compliance_assert\(p_company_id\)/.test(mig), 'RPCs com guarda de empresa')

const tela = readFileSync('src/app/dashboard/compliance/treinamentos-por-setor/page.tsx', 'utf8')
ok(/fn_compliance_setor_exigencias_listar/.test(tela) && /fn_compliance_setor_exigencias_salvar/.test(tela), 'tela: setor → marcar treinamentos → salvar')
ok(/data-testid="setor-select"/.test(tela) && /data-testid="setor-salvar"/.test(tela), 'tela tem o seletor de setor e o botão Salvar')
ok(/link-treinamentos-por-setor/.test(readFileSync('src/app/dashboard/compliance/documentos-exigidos/page.tsx', 'utf8')), 'Documentos exigidos aponta para a tela por setor')

if (falhas > 0) { console.error(`\n[check-compliance-exigencia-setor] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compliance-exigencia-setor] treinamentos por setor conferidos.')
