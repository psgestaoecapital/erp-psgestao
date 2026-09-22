// Fonte única das COLUNAS da importação de CADASTROS (clientes e fornecedores). A ORDEM e as CHAVES aqui
// são o CONTRATO com a planilha padrão (public/modelos/MODELO_importacao_cadastros_PS.xlsx, linha 4) e com
// o importador (fn_cadastro_importar_previa/_aplicar + a tela). O script scripts/check-modelo-cadastros.ts
// abre o xlsx e compara — se divergir, QUEBRA O BUILD.
// Alterou o modelo? Altere o gerador (scripts/modelos/gerar_modelo_cadastros_ps.py) E esta lista juntos.

export type EscopoCadastro = 'ambos' | 'cliente' | 'fornecedor'

export interface ColunaCadastro {
  key: string
  label: string          // rótulo humano (aba Cadastros, linha 3, sem o " *")
  obrig?: boolean        // obrigatória (dourada com *)
  escopo: EscopoCadastro // a quem se aplica
  ajuda: string
}

export const COLUNAS_CADASTROS: ColunaCadastro[] = [
  { key: 'tipo', label: 'Tipo', obrig: true, escopo: 'ambos', ajuda: 'Cliente, Fornecedor ou Ambos.' },
  { key: 'tipo_pessoa', label: 'Tipo de pessoa', obrig: true, escopo: 'ambos', ajuda: 'PF ou PJ (ou deduz pelo documento).' },
  { key: 'nome_fantasia', label: 'Nome / Nome fantasia', obrig: true, escopo: 'ambos', ajuda: 'Nome (PF) ou nome fantasia (PJ).' },
  { key: 'razao_social', label: 'Razão social', escopo: 'ambos', ajuda: 'Razão social (PJ).' },
  { key: 'cpf_cnpj', label: 'CPF/CNPJ', escopo: 'ambos', ajuda: 'CPF (11) ou CNPJ (14). Recomendado; sem ele entra com alerta.' },
  { key: 'codigo_sistema_anterior', label: 'Código no sistema anterior', escopo: 'ambos', ajuda: 'Vira a referência externa (reimportar sem duplicar).' },
  { key: 'sistema_origem', label: 'Sistema de origem', escopo: 'ambos', ajuda: 'Omie, Conta Azul, Bling...' },
  { key: 'ie', label: 'Inscrição estadual (IE)', escopo: 'ambos', ajuda: 'IE ou ISENTO.' },
  { key: 'im', label: 'Inscrição municipal (IM)', escopo: 'ambos', ajuda: 'Inscrição municipal.' },
  { key: 'contribuinte_icms', label: 'Contribuinte ICMS', escopo: 'ambos', ajuda: '1 contribuinte · 2 isento · 9 não contribuinte.' },
  { key: 'rg', label: 'RG', escopo: 'ambos', ajuda: 'RG (PF).' },
  { key: 'data_nasc_abertura', label: 'Data de nascimento/abertura', escopo: 'ambos', ajuda: 'Nascimento (PF) ou abertura (PJ).' },
  { key: 'email', label: 'E-mail', escopo: 'ambos', ajuda: 'E-mail principal.' },
  { key: 'telefone', label: 'Telefone', escopo: 'ambos', ajuda: 'Telefone fixo.' },
  { key: 'celular', label: 'Celular / WhatsApp', escopo: 'ambos', ajuda: 'Celular/WhatsApp.' },
  { key: 'site', label: 'Site', escopo: 'ambos', ajuda: 'Site, quando houver.' },
  { key: 'cep', label: 'CEP', escopo: 'ambos', ajuda: 'CEP (8 díg.). Completa o endereço se faltar.' },
  { key: 'logradouro', label: 'Logradouro', escopo: 'ambos', ajuda: 'Rua/avenida.' },
  { key: 'numero', label: 'Número', escopo: 'ambos', ajuda: 'Número (ou S/N).' },
  { key: 'complemento', label: 'Complemento', escopo: 'ambos', ajuda: 'Sala, bloco, apto...' },
  { key: 'bairro', label: 'Bairro', escopo: 'ambos', ajuda: 'Bairro.' },
  { key: 'cidade', label: 'Cidade', escopo: 'ambos', ajuda: 'Município.' },
  { key: 'uf', label: 'UF', escopo: 'ambos', ajuda: 'Sigla do estado (2 letras).' },
  { key: 'pais', label: 'País', escopo: 'ambos', ajuda: 'Padrão Brasil.' },
  { key: 'codigo_ibge', label: 'Código IBGE do município', escopo: 'ambos', ajuda: 'Opcional; completado pelo CEP.' },
  { key: 'limite_credito', label: 'Limite de crédito (R$)', escopo: 'cliente', ajuda: 'Só cliente.' },
  { key: 'condicao_pagamento', label: 'Condição de pagamento padrão', escopo: 'ambos', ajuda: 'Ex.: à vista, 30/60/90 dias.' },
  { key: 'vendedor', label: 'Vendedor', escopo: 'cliente', ajuda: 'Vendedor responsável. Só cliente.' },
  { key: 'segmento', label: 'Segmento', escopo: 'cliente', ajuda: 'Segmento/ramo. Só cliente.' },
  { key: 'categoria', label: 'Categoria', escopo: 'ambos', ajuda: 'Categoria/grupo.' },
  { key: 'tags', label: 'Tags', escopo: 'cliente', ajuda: 'Etiquetas separadas por vírgula. Só cliente.' },
  { key: 'banco', label: 'Banco', escopo: 'fornecedor', ajuda: 'Banco. Só fornecedor.' },
  { key: 'agencia', label: 'Agência', escopo: 'fornecedor', ajuda: 'Agência. Só fornecedor.' },
  { key: 'conta', label: 'Conta', escopo: 'fornecedor', ajuda: 'Conta. Só fornecedor.' },
  { key: 'pix', label: 'PIX', escopo: 'fornecedor', ajuda: 'Chave PIX. Só fornecedor.' },
  { key: 'prazo_entrega_dias', label: 'Prazo de entrega (dias)', escopo: 'fornecedor', ajuda: 'Prazo em dias. Só fornecedor.' },
  { key: 'ativo', label: 'Ativo', escopo: 'ambos', ajuda: 'Sim/Não (padrão Sim).' },
  { key: 'observacoes', label: 'Observações', escopo: 'ambos', ajuda: 'Anotações livres.' },
]

export const CHAVES_CADASTROS: string[] = COLUNAS_CADASTROS.map((c) => c.key)

export const TIPOS_CADASTRO = ['Cliente', 'Fornecedor', 'Ambos'] as const
export const TIPOS_PESSOA = ['PF', 'PJ'] as const
export const CONTRIBUINTE_ICMS = ['1', '2', '9'] as const // 1 contribuinte · 2 isento · 9 não contribuinte
export const NOME_EXEMPLO = 'Cliente de exemplo — APAGUE esta linha'
