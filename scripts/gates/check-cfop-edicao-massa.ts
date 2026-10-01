// Gate (CEO 01/10 · parte A da #1937, SEM trava): CFOP de venda dentro (cfop_venda) e fora do estado
// (cfop_venda_interestadual) no cadastro e na edição fiscal em massa. A trava na emissão (sem "5102 automático") é a
// parte B, com gate próprio (check-cfop-trava-emissao). Roda no build, sem rede.
import { readFileSync } from 'node:fs'
import { erroDoValor, rotuloCampo, CAMPOS_FISCAIS } from '../../src/lib/produtos/fiscalMassa'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// regras da edição em massa (iguais às da função do banco)
ok(CAMPOS_FISCAIS.includes('cfop_venda') && CAMPOS_FISCAIS.includes('cfop_venda_interestadual'), 'edição em massa tem os 2 CFOPs')
ok(erroDoValor('cfop_venda', '5405', true) === null && erroDoValor('cfop_venda', '6102', true) !== null, 'dentro do estado: 5xxx')
ok(erroDoValor('cfop_venda_interestadual', '6404', true) === null && erroDoValor('cfop_venda_interestadual', '5102', true) !== null, 'fora do estado: 6xxx')
ok(rotuloCampo('cfop_venda_interestadual', true) === 'CFOP de venda fora do estado', 'rótulo')

const mig = readFileSync('supabase/migrations/20261001130000_produtos_cfop_venda.sql', 'utf8')
ok(mig.includes("v_cfop !~ '^5\\d{3}$'") && mig.includes("v_cfop_fora !~ '^6\\d{3}$'"), 'banco valida 5xxx/6xxx igual à tela')
ok(mig.includes('ADD COLUMN IF NOT EXISTS cfop_venda_interestadual text'), 'coluna CFOP fora do estado')
ok(mig.includes("'cfop_venda','cfop_venda_interestadual'));"), 'registro de alteração aceita os CFOPs')
ok(mig.includes("v_icms_igual IS NULL OR btrim(COALESCE(p.cst_icms,'')) = v_icms_igual"), 'filtro por CSOSN/CST (ex.: 500 → 5405/6404)')
ok((mig.match(/UPDATE public\.erp_produtos/g) ?? []).length === 1, 'migration não altera produto fora da função')
ok(/REVOKE ALL ON FUNCTION public\.fn_produtos_fiscal_massa\(uuid, jsonb, jsonb, boolean, boolean, text\) FROM PUBLIC, anon/.test(mig), 'edição em massa fechada ao anon')

// a ficha tem os 2 CFOPs, sem supor 5102, e mantém os campos da etiqueta (#1949)
const form = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
ok(!form.includes("cfop_venda ?? '5102'") && form.includes('cfop_venda_interestadual'), "ficha sem '5102' padrão e com CFOP fora do estado")
ok(form.includes('produto-localizacao') && form.includes('codigo_barras'), 'ficha mantém local de armazenagem e código de barras (etiquetas)')

// A trava na emissão (parte B) é conferida por scripts/gates/check-cfop-trava-emissao.ts

if (falhas) { console.error(`\ncheck-cfop-edicao-massa: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-cfop-edicao-massa: ok')
