// Gate (chamado #5616 Alliance): salvar o rascunho do perfil fiscal com select em branco ("") não pode falhar nos CHECKs de lista.
// A migration mais recente que redefine fn_veic_perfil_fiscal_salvar tem de tratar "" como NULL nos 4 campos com CHECK, e a tela
// mostra o motivo da falha. Roda no build. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const dir = 'supabase/migrations'
const ultima = readdirSync(dir).filter((f) => f.endsWith('.sql') && readFileSync(`${dir}/${f}`, 'utf8').includes('CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_salvar')).sort().pop() ?? ''
const sql = readFileSync(`${dir}/${ultima}`, 'utf8')
for (const c of ['regime', 'icms_saida_regra', 'troca_valor_base', 'comissao_base'])
  ok(sql.includes(`${c} = NULLIF(p_dados->>'${c}','')`), `${c}: "" vira NULL (${ultima})`)

const tela = readFileSync('src/app/dashboard/revenda/fiscal/page.tsx', 'utf8')
ok(tela.includes('Falha ao salvar: ${rpcErro.message}'), 'a tela mostra o motivo da falha ao salvar')

if (falhas) process.exit(1)
