/**
 * Gate (#1677 etapa 4): Ordem de Fornecimento em PDF do pedido de compra. Confere a parte pura (texto obrigatório da NF
 * com o número, frete CIF/FOB, entrega/pagamento "a combinar", pendências, CNPJ formatado), que o PDF é gerado e pagina
 * com muitos itens, que o cartão está no pedido de compra e o botão em Pendências (quem confere o recebimento), que o
 * "?" tem chave cadastrada (RD-95) e que a migration é só catálogo de ajuda. Sem rede.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import {
  type DadosOF, FRETE_ROTULO, docFormatado, linhasEmpresa, linhasEntregaPagamento, montarOrdemFornecimentoPdf, nomeArquivoOF,
  pendenciasOF, textoObrigatorioNF, cidadeUf, enderecoLinha,
} from '../../src/lib/compras/ordemFornecimentoPdf'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

async function main() {
  ok(textoObrigatorioNF('PC-0012') === 'INFORMAÇÕES OBRIGATÓRIAS NAS OBSERVAÇÕES DA NF: ORDEM DE FORNECIMENTO Nº PC-0012', 'texto obrigatório da NF leva o número da OF')
  ok(Object.keys(FRETE_ROTULO).join(',') === 'CIF,FOB,SEM', 'frete oferece CIF, FOB e sem frete')
  ok(docFormatado('12345678000195') === '12.345.678/0001-95', 'CNPJ sai formatado')
  ok(nomeArquivoOF('PC/0012') === 'ordem_fornecimento_PC_0012.pdf', 'nome do arquivo seguro')
  ok(enderecoLinha({ logradouro: 'Rua A', numero: '10', bairro: 'Centro' }) === 'Rua A, 10 - Centro', 'endereço montado do cadastro')
  ok(enderecoLinha({ endereco: 'Av. B 99' }) === 'Av. B 99', 'endereço livre quando não há campos separados')
  ok(cidadeUf({ cidade: 'Chapecó', uf: 'SC' }) === 'Chapecó/SC' && cidadeUf({ cidade_estado: 'Xanxerê - SC' }) === 'Xanxerê - SC', 'cidade/UF')

  const base: DadosOF = {
    numero: 'PC-0012', data_pedido: '2026-10-17', emitido_em: '2026-10-17',
    comprador: { razao_social: 'Empresa Compradora Ltda', nome_fantasia: 'Compradora', cnpj: '12345678000195', ie: '123', endereco: 'Rua A, 10', cidade_uf: 'Chapecó/SC', cep: '89800-000' },
    fornecedor: { razao_social: 'Fornecedor Exemplo SA', cnpj: '98765432000110', telefone: '(49) 3333-0000', email: 'vendas@exemplo.com' },
    itens: [{ codigo: 'P1', descricao: 'Filtro de óleo — linha pesada', unidade: 'UN', quantidade: 2, preco_unitario: 50, subtotal: 100 }],
    subtotal: 100, desconto_valor: 5, acrescimo_valor: 0, frete_valor: 20, total: 115,
    data_prevista: '2026-10-24', prazo_entrega_dias: null, frete_tipo: 'CIF', transportadora: 'Rodonaves',
    condicao_pagamento: '28/56 dias', forma_pagamento: 'boleto', parcelas: 2, primeiro_vencimento: '2026-11-14', observacoes: 'Entregar das 8h às 17h.',
  }
  const ep = linhasEntregaPagamento(base)
  ok(ep.entrega[0] === 'Entrega prevista: 24/10/2026' && ep.entrega[1].startsWith('Frete: CIF (por conta do fornecedor)'), 'entrega e frete CIF na OF')
  ok(ep.pagamento.includes('Condição: 28/56 dias') && ep.pagamento.includes('Parcelas: 2') && ep.pagamento.includes('Forma: Boleto'), 'condição e parcelas na OF')
  const vazio = linhasEntregaPagamento({ ...base, data_prevista: null, prazo_entrega_dias: null, frete_tipo: null, condicao_pagamento: null })
  ok(vazio.entrega[0].endsWith('a combinar') && vazio.entrega[1].startsWith('Frete: a combinar') && vazio.pagamento[0] === 'Condição: a combinar', 'sem condição preenchida sai "a combinar"')
  ok(linhasEntregaPagamento({ ...base, data_prevista: null, prazo_entrega_dias: 7 }).entrega[0] === 'Entrega prevista: 7 dia(s) após o pedido', 'prazo em dias quando não há data')
  ok(pendenciasOF(base).length === 0, 'pedido completo não tem pendência')
  ok(pendenciasOF({ ...base, frete_tipo: null, condicao_pagamento: null }).join('|') === 'frete (CIF/FOB)|condição de pagamento', 'avisa o que falta preencher')
  ok(linhasEmpresa(base.comprador)[1] === 'Nome fantasia: Compradora' && linhasEmpresa(base.comprador)[2].includes('12.345.678/0001-95'), 'dados da empresa compradora')

  const pdf1 = await PDFDocument.load(await montarOrdemFornecimentoPdf(base))
  ok(pdf1.getPageCount() === 1, 'OF de 1 item cabe em 1 página')
  ok(pdf1.getTitle() === 'Ordem de Fornecimento PC-0012', 'título do PDF tem o número')
  const muitos = Array.from({ length: 80 }, (_, i) => ({ ...base.itens[0], codigo: `P${i}`, descricao: `Item ${i} com descrição longa o bastante para quebrar em mais de uma linha na coluna de descrição da ordem` }))
  const pdf2 = await PDFDocument.load(await montarOrdemFornecimentoPdf({ ...base, itens: muitos, observacoes: 'x '.repeat(400) }))
  ok(pdf2.getPageCount() >= 3, `OF com 80 itens pagina (${pdf2.getPageCount()} páginas)`)
  const pdf3 = await PDFDocument.load(await montarOrdemFornecimentoPdf({ ...base, itens: [], fornecedor: { razao_social: null, cnpj: null }, observacoes: null, numero: 'Ω-1' }))
  ok(pdf3.getPageCount() === 1, 'OF sem itens e com caractere fora do Latin-1 não quebra')

  const comp = readFileSync('src/components/compras/OrdemFornecimento.tsx', 'utf8')
  const drawer = readFileSync('src/app/dashboard/commerce/compras/page.tsx', 'utf8')
  const pend = readFileSync('src/app/dashboard/compras/pendencias/page.tsx', 'utf8')
  ok(/<OrdemFornecimentoCard[\s\S]*compraId=\{compra\.id\}/.test(drawer), 'cartão da OF no pedido de compra')
  ok(/editavel=\{!compra\.titulos_gerados/.test(drawer), 'condições travam depois do financeiro gerado')
  ok(/<BotaoOrdemFornecimento compraId=\{p\.cotacao\.compra\.id\}/.test(pend), 'botão da OF em Pendências de compra (recebimento)')
  ok(/from\('erp_compras'\)\.update\(\{ \.\.\.c,/.test(comp) && !/titulos_gerados|total|status/.test(comp.slice(comp.indexOf('export type CondicoesOF'), comp.indexOf('}', comp.indexOf('export type CondicoesOF')))), 'cartão grava só as condições da OF (sem total/status/financeiro)')
  const migArq = readdirSync('supabase/migrations').find((f) => f.endsWith('_compras_ordem_fornecimento_ajuda.sql'))
  const mig = migArq ? readFileSync(`supabase/migrations/${migArq}`, 'utf8') : ''
  ok(!!migArq, 'migration da ajuda da OF existe')
  const chaves = [...comp.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
  ok(chaves.length >= 8, `"?" em todos os campos e ações da OF (${chaves.length})`)
  for (const c of new Set(chaves)) ok(mig.includes(`'${c}'`), `chave de ajuda cadastrada: ${c}`)
  const semCom = mig.replace(/--[^\n]*/g, '')
  ok(/INSERT INTO public\.erp_ajuda_campo/.test(semCom) && !/\b(CREATE|ALTER|DROP|DELETE|GRANT|REVOKE|TRUNCATE)\b/i.test(semCom) && !/\bUPDATE\s+public\./i.test(semCom), 'migration só cadastra ajuda (aditiva)')

  if (falhas) { console.error(`\n${falhas} falha(s) na Ordem de Fornecimento (#1677 etapa 4)`); process.exit(1) }
  console.log('✓ Ordem de Fornecimento (#1677 etapa 4) ok')
}
main().catch((e) => { console.error(e); process.exit(1) })
