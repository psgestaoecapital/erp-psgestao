// Gate (chamado #573 · KGF): na conferência da nota recebida, ao lado do fator de conversão, a unidade de estoque do
// produto (litro, metro, pacote…) e o fator JÁ APRENDIDO deste fornecedor (antes o campo sempre mostrava 1). Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const f = readFileSync('src/app/dashboard/compras/documentos-recebidos/_components/ItensNfeRecebida.tsx', 'utf8')

const un = readFileSync('src/lib/produtos/unidades.ts', 'utf8')
ok(/export const UNIDADES_ESTOQUE/.test(un) && /'LT · litro'/.test(un) && /'M · metro'/.test(un) && /'PCT · pacote'/.test(un) && /UNIDADES_ESTOQUE/.test(f), 'lista de unidades com litro, metro e pacote')
ok(/data-testid=\{`nfe-unidade-\$\{it\.item_id\}`\}/.test(f), 'seletor de unidade ao lado do fator')
ok(/from\('erp_produto_depara_fornecedor'\)\.select\('produto_id, fator_conversao, fornecedor_cnpj'\)/.test(f), 'carrega o fator aprendido deste fornecedor')
ok(/defaultValue=\{fatorSalvo\[it\.produto_id \?\? ''\] \?\? 1\}/.test(f) && !/defaultValue=\{1\} title="Quantas/.test(f), 'campo do fator mostra o fator salvo (não volta para 1)')
ok(/from\('erp_produtos'\)\.update\(\{ unidade \}\)\.eq\('id', produtoId\)\.eq\('company_id', companyId\)/.test(f), 'unidade grava no produto da própria empresa')
ok(/window\.confirm\(`A unidade de estoque de/.test(f), 'mudar a unidade do produto pede confirmação')
ok(/disabled=\{!it\.produto_id\}/.test(f), 'sem produto vinculado, não escolhe unidade')

if (falhas) { console.error(`\n${falhas} falha(s) na unidade de estoque (#573)`); process.exit(1) }
console.log('\nUnidade de estoque na conferência (#573): ok')
