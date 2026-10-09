// Gate (chamado #1673 · banco responsável pelos boletos). Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261009120030_banco_responsavel_boleto_1673.sql', 'utf8')
ok(/ADD COLUMN IF NOT EXISTS boleto_responsavel boolean NOT NULL DEFAULT false/.test(mig), 'coluna boleto_responsavel')
ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_provider_config_boleto_responsavel[\s\S]*WHERE boleto_responsavel/.test(mig), 'um responsável por empresa (índice único parcial)')
ok(/auth\.uid\(\)/.test(mig) && /user_companies/.test(mig), 'função exige usuário logado da empresa')
ok(/cap_boleto/.test(mig) && /conexao inativa/.test(mig), 'responsável precisa estar ativo e com boleto ligado')
ok(/REVOKE ALL ON FUNCTION public\.fn_banco_definir_responsavel_boleto\(uuid, uuid\) FROM PUBLIC, anon/.test(mig), 'REVOKE de anon')
ok(/banco\.responsavel_boleto/.test(mig), 'texto do "?" (RD-95) no banco')

const pg = readFileSync('src/app/dashboard/financeiro/conexoes-bancarias/page.tsx', 'utf8')
ok(pg.includes("fn_banco_definir_responsavel_boleto") && pg.includes('<AjudaCampo chave="banco.responsavel_boleto" />'), 'tela: botão com "?"')

const lib = readFileSync('src/lib/banco/providersBoleto.ts', 'utf8')
ok(/responsavelDaEmpresa\.get\(companyId\)/.test(lib), 'emissão prefere o banco responsável à escolha lembrada')

if (falhas) { console.error(`check-banco-responsavel-boleto: ${falhas} falha(s)`); process.exit(1) }
console.log('check-banco-responsavel-boleto: ok')
