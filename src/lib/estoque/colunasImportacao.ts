// Fonte única das COLUNAS da importação de estoque (contexto 9c43a93d). A ORDEM e as CHAVES aqui são
// o CONTRATO com a planilha padrão (public/modelos/MODELO_migracao_estoque_PS.xlsx, linha 4). O script
// scripts/check-modelo-estoque.ts abre o xlsx e compara — se divergir, QUEBRA O BUILD.
// Alterou o modelo? Altere o gerador (scripts/modelos/gerar_modelo_estoque_ps.py) E esta lista juntos.

export interface ColunaEstoque {
  key: string
  label: string          // rótulo humano (aba Estoque, linha 3, sem o " *")
  obrig?: boolean        // obrigatória (dourada com *)
  ajuda: string
}

export const COLUNAS_ESTOQUE: ColunaEstoque[] = [
  { key: 'codigo', label: 'Código', obrig: true, ajuda: 'Código único do produto (SKU). Texto — preserva zeros à esquerda.' },
  { key: 'nome', label: 'Descrição', obrig: true, ajuda: 'Descrição do produto.' },
  { key: 'unidade', label: 'Unidade', ajuda: 'Unidade de medida (UN, KG, CX...). Vazio = UN.' },
  { key: 'estoque_atual', label: 'Quantidade em estoque', obrig: true, ajuda: 'Saldo atual. Pode ser NEGATIVO (aceito e marcado).' },
  { key: 'custo_medio', label: 'Custo médio unitário (R$)', ajuda: 'Custo médio por unidade → grava em preco_custo_medio.' },
  { key: 'preco_venda', label: 'Preço de venda (R$)', ajuda: 'Preço de venda por unidade.' },
  { key: 'ncm', label: 'NCM', ajuda: 'NCM (8 dígitos). Ausente em item SPED 00–06 gera AVISO (não bloqueia).' },
  { key: 'codigo_barras', label: 'Código de barras (GTIN/EAN)', ajuda: 'GTIN/EAN.' },
  { key: 'codigo_original', label: 'Código original / do fornecedor', ajuda: 'Código do fabricante/fornecedor (referência).' },
  { key: 'fornecedor_padrao_nome', label: 'Fornecedor', ajuda: 'Nome do fornecedor padrão.' },
  { key: 'categoria', label: 'Categoria / grupo', ajuda: 'Categoria/grupo do produto.' },
  { key: 'marca', label: 'Marca', ajuda: 'Marca/fabricante.' },
  { key: 'estoque_minimo', label: 'Estoque mínimo', ajuda: 'Ponto de reposição (opcional).' },
  { key: 'localizacao', label: 'Localização', ajuda: 'Prateleira/endereço no depósito.' },
  { key: 'tipo_item_sped', label: 'Tipo do item (SPED)', ajuda: 'Código SPED 00–10/99. Vazio = 00 (revenda).' },
  { key: 'origem', label: 'Origem da mercadoria', ajuda: 'Origem ICMS 0–8. Vazio = 0 (nacional).' },
  { key: 'cest', label: 'CEST', ajuda: 'CEST (7 dígitos), quando aplicável.' },
]

export const CHAVES_ESTOQUE: string[] = COLUNAS_ESTOQUE.map((c) => c.key)

export const TIPOS_SPED = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '99']
export const TIPOS_EXIGEM_NCM = ['00', '01', '02', '03', '04', '05', '06']
export const ORIGENS = ['0', '1', '2', '3', '4', '5', '6', '7', '8']
export const CODIGO_EXEMPLO = 'EXEMPLO-001'
