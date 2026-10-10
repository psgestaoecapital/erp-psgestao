// Gate do chamado #776: flag "Isento de inscrição estadual" da empresa (migration + tela + wizard + aviso da NF-e).
import { readFileSync, readdirSync } from 'node:fs'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (c) console.log('✓ ' + m); else { falhas.push(m); console.log('✗ ' + m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

const mig = readdirSync('supabase/migrations').find((f) => f.endsWith('_companies_ie_isento.sql'))
const sql = mig ? ler('supabase/migrations/' + mig) : ''
ok(!!mig && /^\d{12}30_/.test(mig), 'migration da flag existe com os segundos 30 (faixa rodrigo-code)')
ok(/ADD COLUMN IF NOT EXISTS ie_isento boolean NOT NULL DEFAULT false/.test(sql), 'coluna companies.ie_isento boolean NOT NULL DEFAULT false')
ok(/get_user_company_ids/.test(sql) && /REVOKE ALL ON FUNCTION public\.fn_empresa_salvar_ie_isento/.test(sql), 'RPC de gravação checa a empresa do usuário e revoga anon')
ok(/empresa\.dados\.ie_isento/.test(sql), '"?" cadastrado em erp_ajuda_campo')

const pg = ler('src/app/dashboard/configuracoes/empresa/page.tsx')
ok(/disabled=\{ieIsento\}/.test(pg) && /type="checkbox"/.test(pg), 'tela da empresa: checkbox desabilita o campo IE')
ok(/fn_empresa_salvar_ie_isento/.test(pg) && /fn_empresa_obter_ie_isento/.test(pg), 'tela da empresa lê e grava a flag por RPC')
ok(/AjudaCampo chave="empresa\.dados\.ie_isento"/.test(pg), 'tela da empresa: checkbox com "?" (RD-95)')

const wz = ler('src/app/dashboard/admin/acessos/_components/NovaEmpresaWizard.tsx')
ok(/disabled=\{ieIsento\}/.test(wz) && /fn_empresa_salvar_ie_isento/.test(wz), 'wizard Nova empresa: nasce isenta')

const nb = ler('src/lib/fiscal/nfe-builder.ts')
ok(/ie_isento/.test(nb) && /Inscricao Estadual obrigatoria pra NFe/.test(nb), 'NF-e: continua exigindo IE e avisa claramente quando a empresa é isenta')

if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1) }
console.log('IE isento da empresa: ok')
