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

// ── Casamento TOLERANTE de cabeçalho (Triches 25/09: import MasterKey perdeu documento/IE/endereço
// porque o casamento era por chave técnica exata). Aceita variações humanas de cabeçalho, normalizando
// (minúsculas, sem acento, só alfanumérico) antes de comparar. Fonte do fix do importador de cadastros.
export function normHeaderCadastro(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')                        // tira espaço, barra, ponto, parênteses…
}

// Apelidos por chave (além da própria chave técnica e do label humano, que entram automático).
export const ALIASES_CADASTROS: Record<string, string[]> = {
  tipo: ['tipocadastro', 'tipodecadastro'],
  tipo_pessoa: ['tipopessoa', 'pfpj', 'pessoa', 'tipodepessoa'],
  nome_fantasia: ['nome', 'fantasia', 'nomecliente', 'nomefornecedor', 'nomerazao', 'razaonome', 'cliente', 'fornecedor'],
  razao_social: ['razao', 'razaosocial'],
  cpf_cnpj: ['cnpj', 'cpf', 'cnpjcpf', 'cpfcnpj', 'documento', 'doc', 'inscricao', 'inscr', 'nrdocumento', 'numerodocumento'],
  codigo_sistema_anterior: ['codigo', 'codigoanterior', 'codigosistemaanterior', 'idexterno', 'codigoexterno', 'refexterna', 'codcliente', 'codigocliente'],
  sistema_origem: ['sistemaorigem', 'sistemadeorigem', 'origem', 'sistema'],
  ie: ['ie', 'inscricaoestadual', 'inscestadual', 'inscestad'],
  im: ['im', 'inscricaomunicipal', 'inscmunicipal'],
  contribuinte_icms: ['contribuinte', 'contribuinteicms', 'indicadorie', 'indie', 'icms'],
  rg: ['rg'],
  data_nasc_abertura: ['datanascimento', 'nascimento', 'dataabertura', 'abertura', 'datanasc', 'datanascabertura'],
  email: ['email', 'emailprincipal'],
  telefone: ['telefone', 'fone', 'tel', 'telefonefixo', 'telfixo'],
  celular: ['celular', 'whatsapp', 'whats', 'cel', 'celularwhatsapp'],
  site: ['site', 'website', 'url'],
  cep: ['cep'],
  logradouro: ['logradouro', 'endereco', 'rua', 'ruaav', 'avenida', 'end'],
  numero: ['numero', 'num', 'nro'],
  complemento: ['complemento', 'compl'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio'],
  uf: ['uf', 'estado', 'siglauf'],
  pais: ['pais'],
  codigo_ibge: ['codigoibge', 'ibge'],
  limite_credito: ['limitecredito', 'limitedecredito', 'limite'],
  condicao_pagamento: ['condicaopagamento', 'condicaodepagamento', 'condpagamento'],
  vendedor: ['vendedor'],
  segmento: ['segmento', 'ramo'],
  categoria: ['categoria', 'grupo'],
  tags: ['tags', 'etiquetas'],
  banco: ['banco'],
  agencia: ['agencia'],
  conta: ['conta'],
  pix: ['pix', 'chavepix'],
  prazo_entrega_dias: ['prazoentrega', 'prazodeentrega', 'prazoentregadias'],
  ativo: ['ativo', 'situacao', 'status'],
  observacoes: ['observacoes', 'obs', 'anotacoes'],
}

// Conjunto de tokens aceitos por chave (chave + label + apelidos, tudo normalizado).
const TOKENS_POR_CHAVE: Record<string, Set<string>> = Object.fromEntries(
  COLUNAS_CADASTROS.map((c) => {
    const set = new Set<string>([normHeaderCadastro(c.key), normHeaderCadastro(c.label), ...(ALIASES_CADASTROS[c.key] ?? [])])
    set.delete('')
    return [c.key, set]
  }),
)

// Casa cada coluna do cabeçalho a uma chave. Retorna { chave: índice } (índice -1 = não reconhecida).
// Primeira coluna que casa vence; cada chave recebe no máximo uma coluna.
export function casarColunasCadastros(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {}
  for (const k of CHAVES_CADASTROS) idx[k] = -1
  header.forEach((h, j) => {
    const nh = normHeaderCadastro(h)
    if (!nh) return
    for (const c of COLUNAS_CADASTROS) {
      if (idx[c.key] >= 0) continue
      if (TOKENS_POR_CHAVE[c.key].has(nh)) { idx[c.key] = j; break }
    }
  })
  return idx
}

export const TIPOS_CADASTRO = ['Cliente', 'Fornecedor', 'Ambos'] as const
export const TIPOS_PESSOA = ['PF', 'PJ'] as const
export const CONTRIBUINTE_ICMS = ['1', '2', '9'] as const // 1 contribuinte · 2 isento · 9 não contribuinte
export const NOME_EXEMPLO = 'Cliente de exemplo — APAGUE esta linha'
