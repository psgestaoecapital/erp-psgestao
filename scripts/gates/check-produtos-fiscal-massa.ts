// Gate (CEO 29/09 · edição fiscal em massa de produtos; FCR com 436 sem os 4 campos). Regras puras + travas do código.
// Roda no build. Sem rede.
import { readFileSync } from 'node:fs'
import {
  TIPOS_ITEM_SPED, CSOSN, CST_ICMS, CST_PIS_COFINS, ehSimples, erroDoValor, rotuloCampo,
  camposFaltandoNoItem, mensagemProdutoSemTributacao,
} from '../../src/lib/produtos/fiscalMassa'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) as tabelas do front são as MESMAS da função do banco (a tela não oferece código que o banco recusa, nem o contrário)
const mig = readFileSync('supabase/migrations/20260930100000_produtos_fiscal_massa.sql', 'utf8')
const arr = (nome: string) => {
  const m = mig.match(new RegExp(nome + String.raw` text\[\] := ARRAY\[([\s\S]*?)\];`))
  return m ? [...m[1].matchAll(/'(\d+)'/g)].map((x) => x[1]) : []
}
const igual = (a: string[], b: readonly { codigo: string }[]) => a.join(',') === b.map((o) => o.codigo).join(',')
ok(igual(arr('c_tipo'), TIPOS_ITEM_SPED), 'Tipo do item (SPED): front = banco')
ok(igual(arr('c_csosn'), CSOSN), 'CSOSN: front = banco')
ok(igual(arr('c_cst_icms'), CST_ICMS), 'CST do ICMS: front = banco')
ok(igual(arr('c_cst_pc'), CST_PIS_COFINS), 'CST do PIS/COFINS: front = banco')

// 2) regime decide CSOSN × CST (mesmo teste do nfe-builder)
ok(ehSimples('simples') && ehSimples('simples_nacional') && !ehSimples('lucro_real') && !ehSimples(null), 'Simples = regime contém "simples"')
ok(rotuloCampo('cst_icms', true) === 'CSOSN do ICMS' && rotuloCampo('cst_icms', false) === 'CST do ICMS', 'rótulo do ICMS segue o regime')
ok(erroDoValor('cst_icms', '102', true) === null && erroDoValor('cst_icms', '00', true) !== null, 'Simples: 102 vale, 00 não')
ok(erroDoValor('cst_icms', '00', false) === null && erroDoValor('cst_icms', '102', false) !== null, 'regime normal: 00 vale, 102 não')
ok(erroDoValor('cst_pis', '49', true) === null && erroDoValor('cst_pis', '48', true) !== null, 'CST do PIS pela tabela 4.3.3')
ok(erroDoValor('tipo_item_sped', '99', true) === null && erroDoValor('tipo_item_sped', '11', true) !== null, 'Tipo do item 00..10 e 99')

// 3) a régua da emissão (usada pelo nfe-validator quando o "102 automático" sair): diz produto e campo
const falta = camposFaltandoNoItem({ icms: { cst: '' }, pis: { cst: '49' }, cofins: {} }, true)
ok(falta.join('|') === 'CSOSN do ICMS|CST da COFINS', 'item sem CSOSN e sem COFINS → os 2 campos, nessa ordem')
ok(camposFaltandoNoItem({ icms: { cst: '102' }, pis: { cst: '49' }, cofins: { cst: '49' } }, true).length === 0, 'item completo → nada falta')
const msg = mensagemProdutoSemTributacao('Item 2', 'ARGAMASSA AC3', '660', falta)
ok(msg.includes('ARGAMASSA AC3 (cód. 660)') && msg.includes('sem CSOSN do ICMS e CST da COFINS') && msg.includes('Edição fiscal em massa'),
  'mensagem cita o produto, os campos e onde corrigir')

// 4) a função: prévia não grava; aplicar só preenche o vazio por padrão; registra quem (auth.uid) e o antes/depois
ok(/IF NOT COALESCE\(p_aplicar, false\) THEN\s+RETURN/.test(mig), 'prévia retorna ANTES de qualquer escrita')
ok(mig.includes("COALESCE(btrim(c.antes),'') = '' OR (v_sobre AND"), 'só preenche o vazio, a não ser que peça para substituir')
ok(mig.includes("v_sobre, v_obs, v_prod_mudam, v_campos, auth.uid(), v_email"), 'lote registra quem alterou por auth.uid()')
ok(mig.includes('INSERT INTO public.erp_produto_fiscal_alteracao'), 'antes/depois de cada campo')
ok(mig.includes("'sem_filtro'") && mig.includes("'regime_indefinido'"), 'sem filtro ou sem regime → recusa')
ok((mig.match(/UPDATE public\.erp_produtos/g) ?? []).length === 1, 'a migration NÃO altera produto nenhum fora da função')
ok(/REVOKE ALL ON FUNCTION public\.fn_produtos_fiscal_massa\(uuid, jsonb, jsonb, boolean, boolean, text\) FROM PUBLIC, anon/.test(mig), 'função fechada ao anon')
ok(mig.includes('fiscal_observacao = COALESCE(v_obs, p.fiscal_observacao)'), 'marca (ex.: regra provisória) gravada em cada produto alterado')
ok(mig.includes('regexp_split_to_table(COALESCE(p_filtro->>\'ncm_prefixo\',\'\'), \'[^0-9]+\')'), 'prefixo de NCM aceita vários')
ok(mig.includes("'sem_tributacao', v_sem_trib"), 'pré-voo conta produto sem tributação')

// 5) a ficha do produto não supõe mais tributação (abria com CST 00 / PIS-COFINS 01 e gravava ao salvar)
const form = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
ok(!/cst_icms \?\? '00'|cst_pis \?\? '01'|cst_cofins \?\? '01'/.test(form), 'ficha sem CST suposto (00/01)')
ok(!/aliquota_icms \?\? '18'|aliquota_pis \?\? '1\.65'|aliquota_cofins \?\? '7\.6'/.test(form), 'ficha sem alíquota suposta (18/1,65/7,6)')

// 6) a tela
const page = readFileSync('src/app/dashboard/cadastros/produtos/page.tsx', 'utf8')
ok(page.includes('data-testid="fiscal-massa-abrir"') && page.includes('<EdicaoFiscalMassaModal'), 'botão "Edição fiscal em massa" na tela Produtos')
// a ficha abre com a linha INTEIRA do produto (a lista não traz os campos fiscais; salvar apagava/supunha CST, alíquotas, ST)
ok(page.includes("async function abrirEdicao(id: string)") && !page.includes('onClick={() => setEditando(p)}') && !page.includes(".select(SELECT_COLS).eq('company_id', companyId).eq('id', editId)"), 'ficha abre com o produto completo (select *)')
ok(form.includes('!(k in produto) && (enviado[k] === null'), 'ficha não envia campo que não carregou')

if (falhas) { console.error(`\ncheck-produtos-fiscal-massa: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-produtos-fiscal-massa: ok')
