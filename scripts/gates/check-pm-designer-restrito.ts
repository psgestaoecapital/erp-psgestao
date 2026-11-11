// Gate (CEO 09/11) — papéis da agência e fluxo do designer. Confere, no código e na migration, o que a regra exige:
// - o designer é pm_producao e a regra vale só para quem tem SÓ esse papel (sem gestão e sem administração);
// - o gatilho na tabela (cobre a tela, a RPC e a edição em massa) e as duas policies restritivas;
// - a comissão continua saindo só em 'publicado' (fn_pm_job_mover_status intacta);
// - o dropdown da agência usa a lista da agência, e a indústria continua com a dela.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const mig = ler('supabase/migrations/20261111170010_pm_designer_pauta_restrito.sql')
ok(/papel_slug = 'pm_producao'/.test(mig), 'designer é o papel pm_producao (existente em rbac_papel)')
ok(/tur\.role IN \('CLIENT_OWNER', 'CLIENT_MANAGER'\)/.test(mig) && /u\.system_role IN \('PS_ADMIN', 'PS_ADMIN_CVM', 'PS_SUPPORT'\)/.test(mig),
  'a regra não vale para gestão nem para administração')
ok(/BEFORE UPDATE OF status ON public\.agency_jobs/.test(mig) && /IF OLD\.responsavel_id IS DISTINCT FROM auth\.uid\(\)/.test(mig),
  'gatilho na tabela: só o responsável move o job')
ok(/OLD\.status = 'nao_iniciada' AND NEW\.status = 'em_producao'/.test(mig) && /OLD\.status = 'em_producao' AND NEW\.status = 'em_aprovacao'/.test(mig),
  'gatilho: só as duas transições do designer')
ok(/AS RESTRICTIVE FOR SELECT/.test(mig) && /AS RESTRICTIVE FOR UPDATE/.test(mig), 'visibilidade e edição por policies RESTRICTIVE')
const migCodigo = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
ok(!/fn_agency_comissao_criar|CREATE OR REPLACE FUNCTION public\.fn_pm_job_mover_status/.test(migCodigo),
  'a migration NÃO mexe na comissão nem em fn_pm_job_mover_status')

const acessos = ler('src/app/dashboard/admin/acessos/page.tsx')
ok(/const ehAgencia = \(areas: \{ slug: string \}\[\]\) => areas\.some\(\(a\) => a\.slug === "pm"\) && !areas\.some\(\(a\) => a\.slug === "industrial"\)/.test(acessos),
  'agência = pm contratado e industrial não contratada')
ok(!/PAPEIS\.map\(\(r\) => <option/.test(acessos) || /papeisDaEmpresa\(areasContratadas\)\.map/.test(acessos),
  'nenhum dropdown de papel usa a lista fixa da indústria direto')
ok(!/PAPEIS_AGENCIA[\s\S]{0,400}gerente_planta/.test(acessos), 'lista da agência não tem Gerente de Planta, RH Industrial nem SST')

const jf = ler('src/components/pm/JobFluxo.tsx')
ok(/fn_pm_job_mover_status/.test(jf) && /p_status: "em_producao"/.test(jf) && /p_status: "em_aprovacao"/.test(jf),
  'tela do job: botões Começar produção e Finalizar / Enviar p/ aprovação')

if (falhas) { console.error(`\ncheck-pm-designer-restrito: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPapéis da agência e fluxo do designer: ok')
