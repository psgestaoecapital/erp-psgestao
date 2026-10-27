// Gate — #3740 (Jordana · Gean, todas as empresas): recebimento em cartão gera um título da operadora por parcela
// (bruto/taxa/líquido/repasse), a conciliação reconhece o líquido e fecha o repasse em bruto. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { parcelasCartao } from '../../src/lib/financeiro/cartaoParcelas'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// a prévia da tela faz a mesma conta do banco
const p3 = parcelasCartao(900, 3, 2.25, 30, '2026-10-19')
ok(p3.map((p) => p.bruto).join() === '300,300,300', '900 em 3x → 3 parcelas de 300')
ok(p3.map((p) => p.taxa).join() === '6.75,6.75,6.75' && p3.map((p) => p.liquido).join() === '293.25,293.25,293.25', 'taxa 2,25% → 6,75 e líquido 293,25 por parcela')
ok(p3.map((p) => p.repasse).join() === '2026-11-18,2026-12-18,2027-01-17', 'repasse = venda + prazo + 30 por parcela')
const p100 = parcelasCartao(100, 3, 0, 30, '2026-10-19')
ok(p100.map((p) => p.bruto).join() === '33.33,33.33,33.34', 'a última parcela leva o arredondamento (soma = total)')
const deb = parcelasCartao(150, 1, 1.01, 1, '2026-12-31')
ok(deb.length === 1 && deb[0].repasse === '2027-01-01' && deb[0].taxa === 1.52, 'débito: 1 parcela D+1, virada de ano')

const nome = readdirSync('supabase/migrations').find((f) => f.endsWith('_cartao_repasse_por_parcela.sql'))
ok(!!nome, 'migration cartao_repasse_por_parcela existe')
const sql = nome ? readFileSync(`supabase/migrations/${nome}`, 'utf8') : ''
ok(/FOR i IN 1\.\.v_n LOOP/.test(sql) && sql.includes("parcela '||i||'/'||v_n"), 'um título da operadora por parcela')
ok(['bandeira_obrigatoria', 'modalidade_obrigatoria', 'parcelas_invalidas', 'titulo_ja_baixado'].every((e) => sql.includes(`'${e}'`)), 'bandeira/modalidade/parcelas obrigatórias e não baixa duas vezes')
ok(sql.includes('valor_liquido, data_repasse') && sql.includes('taxa_pagar_id = v_taxa_pagar'), 'grava líquido/repasse e liga a taxa (despesa) ao repasse')
ok(sql.includes("'repasse_cartao', p_receber_id::text||'#'||i"), 'repasse com referência de sistema (não bate no anti-duplicidade)')
ok(sql.includes('SELECT r.valor_liquido WHERE r.eh_repasse_cartao') && sql.includes('fn_receber_valor_referencia'), 'conciliação reconhece o líquido do repasse (lote e 1:1)')
ok(/CREATE TRIGGER trg_zz_cartao_repasse_fechar\s+AFTER UPDATE OF conciliado, movimento_banco_id, valor_pago/.test(sql), 'gatilho de fechamento roda depois do guarda do valor_pago (nome trg_zz_)')
ok(sql.includes("'taxa_cartao', v_mov, auth.uid(), clock_timestamp()"), 'baixa da taxa nasce depois da baixa da conciliação (clock_timestamp)')
ok(!/\bUPDATE\s+(public\.)?erp_receber\s+SET[^;]*WHERE\s+(?!id\s*=)/i.test(sql.replace(/WHERE id = (p_receber_id|v_novo)/g, '')), 'nenhum UPDATE em massa de títulos (recebimentos antigos não mudam)')

const modal = readFileSync('src/components/financeiro/CartaoRecebimentoModal.tsx', 'utf8')
ok(modal.includes("rpc('fn_cartao_registrar_recebimento'") && modal.includes('p_data_venda: data'), 'modal registra com a data da venda')
for (const k of ['adquirente', 'bandeira', 'modalidade', 'parcelas', 'data_venda', 'previa'])
  ok(modal.includes(`chave="financeiro.cartao_recebimento.${k}"`) && sql.includes(`'financeiro.cartao_recebimento.${k}'`), `"?" ${k} na tela e no banco (RD-95)`)
const marcar = readFileSync('src/components/financeiro/MarcarPagoModal.tsx', 'utf8')
ok(marcar.includes("tipo === 'receber' && forma === 'Cartão'") && marcar.includes('<CartaoRecebimentoModal'), 'baixa manual de receita em "Cartão" abre o recebimento em cartão')

// "Nova receita" em cartão (OS-2026-0281 da Gean saiu como 3 títulos do cliente em aberto): a venda vira UM título do
// cliente pelo total, quitado por fn_cartao_registrar_recebimento, que gera as parcelas da operadora.
const nova = readFileSync('src/components/financeiro/NovaReceitaForm.tsx', 'utf8')
ok(/const vendaCartao = ehCartao && !editando && !origemConciliacao/.test(nova), 'Nova receita: venda no cartão fora da conciliação')
ok(nova.includes('parcelas >= 2 && !vendaCartao') && nova.includes('p_total_parcelas: vendaCartao ? 1 : parcelas'), 'Nova receita: cartão cria UM título do cliente (não N parcelas do cliente)')
ok(/if \(vendaCartao && ids\.length > 0\) \{\s*const \{ data: rc, error: rcErr \} = await supabase\.rpc\('fn_cartao_registrar_recebimento'/.test(nova) && nova.includes('p_parcelas: parcelas, p_data_venda: dataRecebimento'), 'Nova receita: cartão gera os repasses da operadora por parcela')
ok(nova.includes("Faltou preencher: maquininha, bandeira e modalidade do cartão") && nova.includes("Cartão de débito é sempre 1 parcela"), 'Nova receita: cartão exige maquininha/bandeira/modalidade; débito 1x')
ok(nova.includes('ehCartao && cartaoCalc?.ok && !vendaCartao') && nova.includes('!origemConciliacao && !vendaCartao && jaRecebido'), 'Nova receita: sem o patch CART-1 antigo nem baixa em conta na venda no cartão')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
