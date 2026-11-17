// Tradução de rejeições/denegações da SEFAZ para linguagem do usuário (RD-98 pilar e).
// A SEFAZ devolve códigos de rejeição (cStat) + motivo técnico. Aqui mapeamos os mais
// comuns para uma explicação clara + o que fazer, SEM perder o detalhe técnico original.
// Puro, sem rede/estado — fácil de testar e estender.

type Traducao = { amigavel: string; acao: string }

// Códigos de rejeição NF-e (cStat) mais frequentes. Chave = código (3 dígitos).
const MAPA: Record<string, Traducao> = {
  '204': {
    amigavel: 'Já existe uma NF-e autorizada com esta mesma numeração e série.',
    acao: 'Use a nota já emitida ou emita com uma nova numeração.',
  },
  '206': {
    amigavel: 'Esta NF-e já está inutilizada na base da SEFAZ.',
    acao: 'Emita a nota com uma nova numeração.',
  },
  '215': {
    amigavel: 'Os dados da nota não passaram na validação (estrutura) da SEFAZ.',
    acao: 'Revise destinatário, itens, CFOP e impostos — algum campo obrigatório está ausente ou mal formatado.',
  },
  '217': {
    amigavel: 'A SEFAZ não encontrou esta NF-e na base dela.',
    acao: 'Confirme se a nota foi realmente transmitida antes de consultar.',
  },
  '225': {
    amigavel: 'A estrutura do arquivo da nota está incorreta.',
    acao: 'Revise os dados dos itens e tente emitir de novo.',
  },
  '228': {
    amigavel: 'A data de emissão está muito atrasada em relação a hoje.',
    acao: 'Emita a nota com a data atual.',
  },
  '266': {
    amigavel: 'A série informada para a nota é inválida.',
    acao: 'Verifique a configuração de série fiscal da empresa.',
  },
  '301': {
    amigavel: 'Há irregularidade fiscal no emitente (sua empresa) junto à SEFAZ.',
    acao: 'Regularize a situação fiscal da empresa antes de emitir.',
  },
  '302': {
    amigavel: 'Há irregularidade fiscal no destinatário da nota.',
    acao: 'Confira a situação cadastral do cliente/fornecedor na SEFAZ.',
  },
  '509': {
    amigavel: 'Um item tem CNPJ do emitente inválido.',
    acao: 'Verifique o CNPJ cadastrado da empresa.',
  },
  '528': {
    amigavel: 'O valor total dos tributos não confere com a soma dos itens.',
    acao: 'Revise os valores e impostos dos itens.',
  },
  '531': {
    amigavel: 'O valor total da nota não confere com a soma dos itens.',
    acao: 'Revise quantidades e valores unitários dos itens.',
  },
  '539': {
    amigavel: 'Já existe uma nota com esta numeração, mas com chave de acesso diferente (possível reenvio).',
    acao: 'Verifique em "Notas emitidas" antes de emitir outra — pode ser duplicidade.',
  },
  '594': {
    amigavel: 'O NCM informado para um item não existe na tabela oficial.',
    acao: 'Corrija o NCM no cadastro do produto.',
  },
  '610': {
    amigavel: 'O CFOP informado é incompatível com a operação (dentro/fora do estado).',
    acao: 'Revise o CFOP da nota e dos itens conforme a UF do destinatário.',
  },
  '778': {
    amigavel: 'Um item tem NCM inválido ou inexistente.',
    acao: 'Corrija o NCM no cadastro do produto antes de emitir.',
  },
}

// Extrai um código de rejeição de 3 dígitos do texto cru da SEFAZ.
// Formatos comuns: "Rejeicao: 539 - ...", "539 - Duplicidade...", "cStat 204".
export function extrairCodigoRejeicao(raw?: string | null): string | undefined {
  if (!raw) return undefined
  const m = raw.match(/\b([1-9]\d{2})\b/)
  return m?.[1]
}

// Mensagem amigável a partir do texto cru da SEFAZ.
// Sempre preserva o detalhe técnico original entre parênteses (nada é escondido).
export function traduzirRejeicaoSefaz(raw?: string | null, prefixo = 'Nota rejeitada pela SEFAZ'): string {
  const bruto = (raw ?? '').trim()
  const codigo = extrairCodigoRejeicao(bruto)
  const t = codigo ? MAPA[codigo] : undefined
  if (t) {
    const detalhe = bruto ? ` (detalhe SEFAZ: ${bruto})` : ''
    return `${prefixo} — ${t.amigavel} O que fazer: ${t.acao}${detalhe}`
  }
  // Sem código conhecido: devolve o texto cru (ou um fallback) sem inventar tradução.
  return bruto ? `${prefixo}: ${bruto}` : `${prefixo}: motivo não informado.`
}
