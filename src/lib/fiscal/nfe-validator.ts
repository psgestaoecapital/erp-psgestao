import type { NFeRequest } from './types'
import { FiscalError } from './errors'
import { camposFaltandoNoItem, mensagemProdutoSemTributacao } from '@/lib/produtos/fiscalMassa'

const NCM_REGEX = /^\d{8}$/
const CFOP_REGEX = /^\d{4}$/

export function validateNFeRequest(req: NFeRequest): void {
  const erros: string[] = []

  if (!req.naturezaOperacao || req.naturezaOperacao.length < 3) {
    erros.push('naturezaOperacao obrigatoria')
  }
  if (!req.emitente?.cnpj || req.emitente.cnpj.length !== 14) {
    erros.push('CNPJ emitente invalido (14 digitos)')
  }
  if (!req.emitente?.inscricaoEstadual) {
    erros.push('Inscricao Estadual emitente obrigatoria pra NFe · configure na empresa')
  }
  if (!req.destinatario?.razaoSocial) {
    erros.push('Razao social destinatario obrigatoria')
  }
  if (!req.destinatario.cnpj && !req.destinatario.cpf) {
    erros.push('Destinatario precisa de CNPJ OU CPF')
  }
  // Guarda 232: destinatario declarado CONTRIBUINTE (indIEDest=1) precisa de Inscricao Estadual. A
  // SEFAZ rejeita "IE do destinatario nao informada" (232). Barra ANTES de enviar — melhor parar aqui
  // com mensagem clara do que gastar uma rejeicao na frente do cliente. Isento(2)/nao-contribuinte(9)
  // nao exigem IE. Chokepoint unico: todo caminho de emissao passa por validateNFeRequest.
  if (req.destinatario.indicadorIE === 1 && !req.destinatario.inscricaoEstadual) {
    erros.push('Destinatario e contribuinte de ICMS mas esta sem Inscricao Estadual · '
      + 'informe a IE no cadastro do cliente, ou marque-o como isento / nao contribuinte · '
      + 'sem isso a SEFAZ rejeita (232 · IE do destinatario nao informada)')
  }
  if (!req.destinatario.endereco) {
    erros.push('Endereco completo do destinatario obrigatorio pra NFe')
  } else {
    if (!req.destinatario.endereco.logradouro) erros.push('Logradouro destinatario obrigatorio')
    if (!req.destinatario.endereco.cep) erros.push('CEP destinatario obrigatorio')
    if (!req.destinatario.endereco.uf) erros.push('UF destinatario obrigatorio')
    if (!req.destinatario.endereco.cidade) erros.push('Cidade destinatario obrigatoria')
  }
  if (!req.itens || req.itens.length === 0) {
    erros.push('NFe precisa de pelo menos 1 item')
  } else {
    req.itens.forEach((item, idx) => {
      const prefixo = `Item ${idx + 1}`
      if (!item.descricao || item.descricao.length < 2) erros.push(`${prefixo}: descricao obrigatoria`)
      if (!item.ncm || !NCM_REGEX.test(item.ncm.replace(/\D/g, ''))) {
        erros.push(`${prefixo}: NCM invalido (8 digitos · ex: 84713012)`)
      }
      // CFOP ausente por falta de cadastro vira a mensagem de "produto sem tributação" (produto + campo), logo abaixo
      if (!item.cfopFaltando && (!item.cfop || !CFOP_REGEX.test(item.cfop))) {
        erros.push(`${prefixo}: CFOP invalido (4 digitos · ex: 5102)`)
      }
      if (!item.quantidade || item.quantidade <= 0) erros.push(`${prefixo}: quantidade > 0`)
      if (!item.valorUnitario || item.valorUnitario <= 0) erros.push(`${prefixo}: valor unitario > 0`)
      if (!item.unidade) erros.push(`${prefixo}: unidade obrigatoria (ex: UN, KG, M)`)
      // Guarda ST retido (padrão do 232): CST 60/500 (ICMS cobrado antes por ST) exige os 4 campos de
      // ST retido; sem eles a SEFAZ rejeita (938). Barra ANTES de emitir, dizendo quais faltam — melhor
      // parar aqui do que gastar uma rejeição. Zero é valor válido, então testa == null (não falsy).
      if (item.icms?.cst === '500' || item.icms?.cst === '60') {
        const s = item.icms.stRet
        const faltando: string[] = []
        if (s?.vBcstRet == null) faltando.push('Base de cálculo do ICMS ST retido (vBCSTRet)')
        if (s?.pst == null) faltando.push('Alíquota suportada pelo consumidor final (pST)')
        if (s?.vIcmsSubstituto == null) faltando.push('ICMS próprio do substituto (vICMSSubstituto)')
        if (s?.vIcmsStRet == null) faltando.push('ICMS ST retido (vICMSSTRet)')
        if (faltando.length > 0) {
          erros.push(`${prefixo}: CST ${item.icms.cst} exige os campos de ST retido no cadastro do produto (bloco Fiscal) · faltando: ${faltando.join(', ')}`)
        }
      }
      // Guarda "sem tributação suposta" (CEO 29/09 · FCR com 436 produtos sem CSOSN/CST/PIS/COFINS): o builder não
      // inventa mais 102/04 — item sem CSOSN/CST do ICMS, CST do PIS ou CST da COFINS no cadastro NÃO emite. Diz o
      // produto e os campos que faltam. Mesmo predicado do pré-voo (fn_fiscal_previo · sem_tributacao).
      const faltandoTrib = camposFaltandoNoItem(item, !!req.emitente.simplesNacional)
      if (faltandoTrib.length > 0) {
        erros.push(mensagemProdutoSemTributacao(prefixo, item.descricao, item.codigo, faltandoTrib))
      }
      // Guarda CST×CSOSN (OS-0179 · KGF): emitente do Simples com item em CST de regime normal (2 dígitos:
      // 00, 10, 20… 90) em vez de CSOSN (3 dígitos: 101…900). A Focus recusa na hora por schema (o CST não
      // cabe no grupo ICMSSN) com uma mensagem que o operador não entende. Barra aqui dizendo o produto e o
      // que usar. Mesmo predicado do pré-voo (fn_fiscal_previo · simples_cst_regime_normal).
      const cstItem = String(item.icms?.cst ?? '').trim()
      if (req.emitente.simplesNacional && /^\d{2}$/.test(cstItem)) {
        const nomeProduto = item.codigo ? `${item.descricao} (cód. ${item.codigo})` : item.descricao
        erros.push(`${prefixo}: O produto ${nomeProduto} está com tributação de regime normal (CST). Para empresa do Simples use CSOSN (ex.: 500 para produto com ST já retido). CST no cadastro: ${cstItem}`)
      }
      // Guarda comb (#1755 · CEO 07/10 "ANP só com código ANP"): o grupo comb (LA) do XML é obrigatório SÓ
      // quando o produto tem código ANP cadastrado (cProdANP). MOC 7.0 / NT 2016/002, grupo LA: "Informar
      // apenas para operações com combustíveis líquidos" — o gatilho é o produto estar na tabela SIMP da ANP
      // (ter cProdANP), não o NCM. Prova: NF 394.102 da Black Prime (LIMPA BICO DIESEL, NCM 2710, sem grupo
      // ANP) autorizada pela SEFAZ. NCM 2710 sem código ANP = só aviso no pré-voo, nunca bloqueio.
      // Produto COM código ANP e descANP faltando continua barrado, dizendo o que falta (sem isso a SEFAZ
      // rejeita o grupo comb). cProdANP é inteiro (aceita 0 teórico), por isso testa != null.
      if (item.comb?.cProdANP != null && !item.comb.descANP) {
        erros.push(`${prefixo}: o produto ${item.codigo ? `${item.descricao} (cód. ${item.codigo})` : item.descricao} tem código ANP ${item.comb.cProdANP} no cadastro, mas está sem a Descrição ANP (descANP) · preencha a descrição da tabela SIMP da ANP no bloco Fiscal do produto, ou apague o código ANP se o produto não é combustível · sem isso a SEFAZ rejeita (grupo comb · NT 2016/002)`)
      }
    })
  }

  if (erros.length > 0) {
    throw new FiscalError('PAYLOAD_INVALIDO', erros.join(' · '), { erros })
  }
}
