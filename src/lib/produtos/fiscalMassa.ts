// Edição fiscal EM MASSA de produtos (CEO 29/09 · caso FCR: 436 produtos sem os 4 campos) + a régua que a emissão
// de NF-e usa para travar produto sem tributação (sem "102 automático"). Os mesmos códigos estão na migration
// 20260930100000_produtos_fiscal_massa.sql (o gate scripts/check-produtos-fiscal-massa.ts confere que batem).
//
// Fontes das tabelas (RD-72):
//  - Tipo do item: Guia Prático da EFD ICMS/IPI, registro 0200, campo 07 TIPO_ITEM (00…10 e 99).
//  - CSOSN: Tabela B do Código de Situação Tributária — Código de Situação da Operação no Simples Nacional
//    (Ajuste SINIEF 03/2010; Manual de Orientação do Contribuinte NF-e, grupo ICMSSN).
//  - CST do ICMS: Tabela B do CST (Convênio s/nº de 1970, redação do Ajuste SINIEF 03/2018 e 01/2023 p/ 02, 15, 53, 61).
//  - CST do PIS e da COFINS: Tabela 4.3.3 da EFD-Contribuições (IN RFB 1.009/2010).

export type CampoFiscal = 'tipo_item_sped' | 'cst_icms' | 'cst_pis' | 'cst_cofins'
export type Opcao = { codigo: string; rotulo: string }

export const CAMPOS_FISCAIS: readonly CampoFiscal[] = ['tipo_item_sped', 'cst_icms', 'cst_pis', 'cst_cofins']

export const TIPOS_ITEM_SPED: readonly Opcao[] = [
  { codigo: '00', rotulo: 'Mercadoria para revenda' },
  { codigo: '01', rotulo: 'Matéria-prima' },
  { codigo: '02', rotulo: 'Embalagem' },
  { codigo: '03', rotulo: 'Produto em processo' },
  { codigo: '04', rotulo: 'Produto acabado' },
  { codigo: '05', rotulo: 'Subproduto' },
  { codigo: '06', rotulo: 'Produto intermediário' },
  { codigo: '07', rotulo: 'Material de uso e consumo' },
  { codigo: '08', rotulo: 'Ativo imobilizado' },
  { codigo: '09', rotulo: 'Serviços' },
  { codigo: '10', rotulo: 'Outros insumos' },
  { codigo: '99', rotulo: 'Outras' },
]

export const CSOSN: readonly Opcao[] = [
  { codigo: '101', rotulo: 'Tributada pelo Simples com permissão de crédito' },
  { codigo: '102', rotulo: 'Tributada pelo Simples sem permissão de crédito' },
  { codigo: '103', rotulo: 'Isenção do ICMS para faixa de receita bruta' },
  { codigo: '201', rotulo: 'Com permissão de crédito e com cobrança do ICMS por ST' },
  { codigo: '202', rotulo: 'Sem permissão de crédito e com cobrança do ICMS por ST' },
  { codigo: '203', rotulo: 'Isenção p/ faixa de receita bruta e com cobrança do ICMS por ST' },
  { codigo: '300', rotulo: 'Imune' },
  { codigo: '400', rotulo: 'Não tributada pelo Simples' },
  { codigo: '500', rotulo: 'ICMS cobrado anteriormente por ST ou antecipação' },
  { codigo: '900', rotulo: 'Outros' },
]

export const CST_ICMS: readonly Opcao[] = [
  { codigo: '00', rotulo: 'Tributada integralmente' },
  { codigo: '02', rotulo: 'Monofásica própria sobre combustíveis' },
  { codigo: '10', rotulo: 'Tributada e com cobrança do ICMS por ST' },
  { codigo: '15', rotulo: 'Monofásica própria e com retenção sobre combustíveis' },
  { codigo: '20', rotulo: 'Com redução de base de cálculo' },
  { codigo: '30', rotulo: 'Isenta ou não tributada e com cobrança do ICMS por ST' },
  { codigo: '40', rotulo: 'Isenta' },
  { codigo: '41', rotulo: 'Não tributada' },
  { codigo: '50', rotulo: 'Suspensão' },
  { codigo: '51', rotulo: 'Diferimento' },
  { codigo: '53', rotulo: 'Monofásica sobre combustíveis com recolhimento diferido' },
  { codigo: '60', rotulo: 'ICMS cobrado anteriormente por ST' },
  { codigo: '61', rotulo: 'Monofásica sobre combustíveis cobrada anteriormente' },
  { codigo: '70', rotulo: 'Com redução de base e cobrança do ICMS por ST' },
  { codigo: '90', rotulo: 'Outras' },
]

export const CST_PIS_COFINS: readonly Opcao[] = [
  { codigo: '01', rotulo: 'Operação tributável com alíquota básica' },
  { codigo: '02', rotulo: 'Operação tributável com alíquota diferenciada' },
  { codigo: '03', rotulo: 'Operação tributável com alíquota por unidade de medida' },
  { codigo: '04', rotulo: 'Operação tributável monofásica — revenda a alíquota zero' },
  { codigo: '05', rotulo: 'Operação tributável por substituição tributária' },
  { codigo: '06', rotulo: 'Operação tributável a alíquota zero' },
  { codigo: '07', rotulo: 'Operação isenta da contribuição' },
  { codigo: '08', rotulo: 'Operação sem incidência da contribuição' },
  { codigo: '09', rotulo: 'Operação com suspensão da contribuição' },
  { codigo: '49', rotulo: 'Outras operações de saída' },
  { codigo: '50', rotulo: 'Entrada c/ crédito — vinculada a receita tributada no mercado interno' },
  { codigo: '51', rotulo: 'Entrada c/ crédito — vinculada a receita não tributada no mercado interno' },
  { codigo: '52', rotulo: 'Entrada c/ crédito — vinculada a receita de exportação' },
  { codigo: '53', rotulo: 'Entrada c/ crédito — receitas tributadas e não tributadas no mercado interno' },
  { codigo: '54', rotulo: 'Entrada c/ crédito — receitas tributadas no mercado interno e de exportação' },
  { codigo: '55', rotulo: 'Entrada c/ crédito — receitas não tributadas no mercado interno e de exportação' },
  { codigo: '56', rotulo: 'Entrada c/ crédito — receitas tributadas, não tributadas e de exportação' },
  { codigo: '60', rotulo: 'Crédito presumido — receita tributada no mercado interno' },
  { codigo: '61', rotulo: 'Crédito presumido — receita não tributada no mercado interno' },
  { codigo: '62', rotulo: 'Crédito presumido — receita de exportação' },
  { codigo: '63', rotulo: 'Crédito presumido — receitas tributadas e não tributadas no mercado interno' },
  { codigo: '64', rotulo: 'Crédito presumido — receitas tributadas no mercado interno e de exportação' },
  { codigo: '65', rotulo: 'Crédito presumido — receitas não tributadas no mercado interno e de exportação' },
  { codigo: '66', rotulo: 'Crédito presumido — receitas tributadas, não tributadas e de exportação' },
  { codigo: '67', rotulo: 'Crédito presumido — outras operações' },
  { codigo: '70', rotulo: 'Aquisição sem direito a crédito' },
  { codigo: '71', rotulo: 'Aquisição com isenção' },
  { codigo: '72', rotulo: 'Aquisição com suspensão' },
  { codigo: '73', rotulo: 'Aquisição a alíquota zero' },
  { codigo: '74', rotulo: 'Aquisição sem incidência da contribuição' },
  { codigo: '75', rotulo: 'Aquisição por substituição tributária' },
  { codigo: '98', rotulo: 'Outras operações de entrada' },
  { codigo: '99', rotulo: 'Outras operações' },
]

// Empresa do Simples → ICMS é CSOSN (3 dígitos); regime normal → CST (2 dígitos). Mesmo teste do nfe-builder.
export function ehSimples(regimeTributario: string | null | undefined): boolean {
  return (regimeTributario ?? '').toLowerCase().includes('simples')
}

export function rotuloCampo(campo: CampoFiscal, simples: boolean): string {
  switch (campo) {
    case 'tipo_item_sped': return 'Tipo do item (SPED)'
    case 'cst_icms': return simples ? 'CSOSN do ICMS' : 'CST do ICMS'
    case 'cst_pis': return 'CST do PIS'
    case 'cst_cofins': return 'CST da COFINS'
  }
}

export function opcoesDoCampo(campo: CampoFiscal, simples: boolean): readonly Opcao[] {
  switch (campo) {
    case 'tipo_item_sped': return TIPOS_ITEM_SPED
    case 'cst_icms': return simples ? CSOSN : CST_ICMS
    case 'cst_pis':
    case 'cst_cofins': return CST_PIS_COFINS
  }
}

// null = válido; senão a mensagem do porquê não
export function erroDoValor(campo: CampoFiscal, valor: string, simples: boolean): string | null {
  const v = valor.trim()
  if (opcoesDoCampo(campo, simples).some((o) => o.codigo === v)) return null
  if (campo === 'cst_icms') {
    return simples
      ? `${v} não é CSOSN. Empresa do Simples usa CSOSN (3 dígitos, ex.: 102, 500).`
      : `${v} não é CST do ICMS. Empresa do regime normal usa CST (2 dígitos, ex.: 00, 60).`
  }
  return `${v} não é um código válido para ${rotuloCampo(campo, simples)}.`
}

// ── Régua da emissão (nfe-validator): item de NF-e sem tributação do cadastro não sai ─────────────────────
type ItemTributos = { icms?: { cst?: string | null } | null; pis?: { cst?: string | null } | null; cofins?: { cst?: string | null } | null }
const vazio = (s: string | null | undefined) => (s ?? '').trim() === ''

export function camposFaltandoNoItem(item: ItemTributos, simples: boolean): string[] {
  const f: string[] = []
  if (vazio(item.icms?.cst)) f.push(rotuloCampo('cst_icms', simples))
  if (vazio(item.pis?.cst)) f.push(rotuloCampo('cst_pis', simples))
  if (vazio(item.cofins?.cst)) f.push(rotuloCampo('cst_cofins', simples))
  return f
}

export function juntarCampos(campos: string[]): string {
  if (campos.length <= 1) return campos.join('')
  return `${campos.slice(0, -1).join(', ')} e ${campos[campos.length - 1]}`
}

export function mensagemProdutoSemTributacao(prefixo: string, descricao: string, codigo: string | undefined, campos: string[]): string {
  const nome = codigo ? `${descricao} (cód. ${codigo})` : descricao
  return `${prefixo}: o produto ${nome} está sem ${juntarCampos(campos)} no cadastro. `
    + 'A nota não sai com tributação suposta — preencha em Cadastros › Produtos (ficha do produto ou "Edição fiscal em massa").'
}
