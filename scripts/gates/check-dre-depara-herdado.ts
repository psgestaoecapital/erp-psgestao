// Gate (Eng. Chefe 07/10 · DRE): conta nova do plano sem de-para herda o da conta pai; aviso na tela. Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261007181000_dre_depara_herdado_pai.sql', 'utf8')
ok(/c\.codigo LIKE pd\.origem_codigo \|\| '\.%'/.test(mig), 'herança por prefixo pontuado (2.02.04 → 2.02)')
ok(/length\(pd\.origem_codigo\) DESC/.test(mig), 'vale o ancestral mais próximo')
ok(/WHEN epc\.tipo = 'custo' THEN '4\.1'/.test(mig), 'sem pai mapeado: custo → CMV (4.1)')
ok(/'investimento' THEN COALESCE\(dp\.psgc_codigo, '9\.3'\)/.test(mig), 'investimento segue em 9.3')
ok(/REVOKE ALL ON FUNCTION public\.fn_psgc_depara_herdado\(uuid\) FROM PUBLIC, anon/.test(mig), 'helper sem EXECUTE para anon')
ok(/REVOKE ALL ON FUNCTION public\.fn_psgc_contas_sem_vinculo\(uuid\) FROM PUBLIC, anon/.test(mig), 'aviso sem EXECUTE para anon')
ok(!/\bDELETE\b|\bUPDATE\b/.test(mig.replace(/--.*$/gm, '')), 'migration sem UPDATE/DELETE em dado')

const tela = readFileSync('src/app/dashboard/dre-divisional/page.tsx', 'utf8')
// O aviso precisa existir (fn + testid) E ter um link de AÇÃO para resolver o vínculo.
// O rótulo do CTA evoluiu de "Configurar DRE" para "Vincular contas agora →" (#4787),
// apontando para o Plano de Contas da DRE — conferimos o destino + um CTA de vínculo,
// não o texto exato antigo.
ok(tela.includes("fn_psgc_contas_sem_vinculo") && tela.includes('dre-aviso-sem-vinculo')
    && tela.includes('/dashboard/dre-divisional/plano-contas') && /Vincular contas/.test(tela),
  'tela DRE avisa "N contas sem vínculo" com link para resolver o vínculo')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
