// Gate (chamado #5622 Alliance): o Perfil fiscal da revenda tem o campo "NCM padrão" e a função de salvar o grava.
// A migration mais recente que redefine fn_veic_perfil_fiscal_salvar tem de gravar ncm_padrao (só dígitos) e a tela
// tem de ter o campo. Roda no build. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const dir = 'supabase/migrations'
const ultima = readdirSync(dir).filter((f) => f.endsWith('.sql') && readFileSync(`${dir}/${f}`, 'utf8').includes('CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_salvar')).sort().pop() ?? ''
const sql = readFileSync(`${dir}/${ultima}`, 'utf8')
ok(sql.includes("ncm_padrao = CASE WHEN p_dados ? 'ncm_padrao'"), `a função grava ncm_padrao (${ultima})`)
ok(sql.includes("regexp_replace(p_dados->>'ncm_padrao','[^0-9]','','g')"), 'NCM guardado só com dígitos')
ok(sql.includes("NULLIF(p_dados->>'regime','')"), 'mantém o tratamento de "" da #5616')

const tela = readFileSync('src/app/dashboard/revenda/fiscal/page.tsx', 'utf8')
ok(tela.includes("set('ncm_padrao', x)"), 'a tela tem o campo NCM padrão')
ok(tela.includes(".select('ncm_padrao')"), 'a tela reabre com o NCM gravado')

if (falhas) process.exit(1)
