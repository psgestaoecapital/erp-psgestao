// Gate (chamado #2710 FCR · caixa jordana-code a155726a, última parte): na entrada da nota de compra o produto vinculado
// mostra o preço de venda sugerido pelo markup padrão (do produto, ou o geral) sobre o custo da nota ÷ fator, editável,
// e grava pela MESMA função da Precificação (fn_produto_preco_aplicar). Conta pura + ligação na tela + "?" (RD-95).
// Roda no build. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { custoProdutoDaNota, lerPreco, precoPorMarkup } from '../../src/lib/precificacao/entradaNota'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) critério da Jordana: 40% no produto, 30% geral, custo R$ 10,00
ok(precoPorMarkup(10, 40) === 14 && precoPorMarkup(10, 30) === 13, 'custo 10 → 14,00 com 40% (produto) e 13,00 com 30% (geral)')
ok(precoPorMarkup(7.33, 35) === 9.9, 'arredonda em 2 casas como o fn_preco_markup_efetivo (7,33 × 1,35 = 9,8955 → 9,90)')
ok(precoPorMarkup(10, null) === null && precoPorMarkup(null, 30) === null && precoPorMarkup(0, 30) === null, 'sem markup ou sem custo → sem sugestão (nunca inventa)')
ok(precoPorMarkup(10, 0) === 10, 'markup 0% → preço = custo')

// 2) custo do produto nesta nota: custo real (se calculado) senão valor unitário, dividido pelo fator da embalagem
ok(custoProdutoDaNota(120, 100, 12) === 10, 'custo real 120 por CX de 12 UN → 10 por UN')
ok(custoProdutoDaNota(null, 60, 12) === 5, 'sem custo real usa o valor unitário da nota (60 ÷ 12 = 5)')
ok(custoProdutoDaNota(0, 8, null) === 8 && custoProdutoDaNota(null, 8, 0) === 8, 'custo real 0 ou fator vazio/0 → valor unitário, fator 1')
ok(custoProdutoDaNota(null, 0, 1) === null, 'linha sem valor → sem custo')

// 3) leitura do preço digitado
ok(lerPreco('14,00') === 14 && lerPreco('1.234,56') === 1234.56 && lerPreco('R$ 9.90') === 9.9, 'aceita 14,00 · 1.234,56 · R$ 9.90')
ok(lerPreco('') === null && lerPreco('abc') === null && lerPreco('0') === null && lerPreco('-3') === null, 'vazio, texto, zero e negativo recusados')

// 4) a tela de entrada monta o componente para item com produto que entra no estoque, com o custo ÷ fator
const itens = readFileSync('src/app/dashboard/compras/documentos-recebidos/_components/ItensNfeRecebida.tsx', 'utf8')
ok(/<PrecoVendaEntradaNota[\s\S]{0,300}custoProdutoDaNota\(extras\[it\.item_id\]\?\.custo_unitario_real, it\.valor_unitario, fatorSalvo\[it\.produto_id\]\)/.test(itens),
  'ItensNfeRecebida passa custo real/valor unitário ÷ fator do produto')
ok(/it\.produto_id && it\.entra_estoque !== false && \(\s*<PrecoVendaEntradaNota/.test(itens), 'só aparece para item vinculado que movimenta estoque')

// 5) o componente lê o markup pela regra da Precificação e grava pela função com guarda + histórico; tem o "?"
const comp = readFileSync('src/components/precificacao/PrecoVendaEntradaNota.tsx', 'utf8')
ok(comp.includes("rpc('fn_preco_markup_efetivo'") && comp.includes("rpc('fn_produto_preco_aplicar'"), 'lê fn_preco_markup_efetivo e grava fn_produto_preco_aplicar')
ok(!/\.from\('erp_produtos'\)\s*\.update/.test(comp), 'nunca grava erp_produtos direto (sem histórico)')
ok(comp.includes('<AjudaCampo chave="compras.entrada.preco_venda_sugerido"'), 'campo Preço de venda tem o "?" (RD-95)')

// 6) a chave do "?" está cadastrada numa migration
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
ok(migs.some((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').includes("'compras.entrada.preco_venda_sugerido'")), 'chave compras.entrada.preco_venda_sugerido em erp_ajuda_campo (migration)')

if (falhas) { console.error(`\n${falhas} falha(s) no preço de venda sugerido na entrada da nota (#2710).`); process.exit(1) }
console.log('✓ #2710: preço de venda sugerido na entrada da nota')
