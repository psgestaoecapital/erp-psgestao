// GF4 · XML de compra em lote (Documentos Recebidos). Regras puras do envio em lote, sem rede: o que é cada arquivo,
// como cada resposta de fn_nfe_recebida_upload_xml vira situação + texto para o usuário, e o resumo do lote.
// A gravação continua TODA na fn_nfe_recebida_upload_xml (mesmas travas do envio de um arquivo: chave com DV,
// destinatário = CNPJ da empresa, não sobrescrever XML da SEFAZ nem aceitar valor divergente sem confirmação).
// Gate: scripts/gates/check-xml-lote-recebidas.ts.

export type RespUploadXml = {
  ok: boolean
  erro?: string
  motivo?: string
  valor_xml?: number
  valor_resumo?: number
  xml_atual_origem?: string
  cnpj_no_xml?: string
  cnpj_empresa?: string
  criada?: boolean
  itens?: number
  duplicatas?: number
  chave?: string
}

export type SituacaoLote = 'aplicada' | 'confirmar' | 'recusada'
export type Aceites = { sobrescrever: boolean; divergencia: boolean }

// Teto por envio: cada arquivo é uma chamada; acima disso o usuário divide o lote (evita prender a tela minutos).
export const MAX_ARQUIVOS_LOTE = 200

export function tipoArquivo(nome: string): 'xml' | 'zip' | 'outro' {
  const n = nome.trim().toLowerCase()
  if (n.endsWith('.xml')) return 'xml'
  if (n.endsWith('.zip')) return 'zip'
  return 'outro'
}

const brl = (v?: number) =>
  'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const mascaraCnpj = (c?: string) => {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d || '—'
}

// Aceite que a resposta pede (ou null se a resposta não pede aceite).
export function aceitePedido(r: RespUploadXml): keyof Aceites | null {
  if (r.ok || r.erro !== 'requer_aceite') return null
  if (r.motivo === 'sobrescrever_sefaz') return 'sobrescrever'
  if (r.motivo === 'divergencia_valor') return 'divergencia'
  return null
}

export function classificarUpload(r: RespUploadXml): { situacao: SituacaoLote; texto: string } {
  if (r.ok) {
    const itens = r.itens ?? 0
    const dups = r.duplicatas ?? 0
    return {
      situacao: 'aplicada',
      texto: `Nota ${r.criada ? 'criada' : 'completada'}: ${itens} ${itens === 1 ? 'item' : 'itens'}, ` +
        `${dups} ${dups === 1 ? 'parcela' : 'parcelas'}. Confira e lance em Contas a Pagar.`,
    }
  }
  const aceite = aceitePedido(r)
  if (aceite === 'sobrescrever') {
    return { situacao: 'confirmar', texto: 'Esta nota já tem o XML que veio da SEFAZ. Confirme para trocar pelo arquivo enviado.' }
  }
  if (aceite === 'divergencia') {
    return {
      situacao: 'confirmar',
      texto: `O valor do arquivo (${brl(r.valor_xml)}) é diferente do resumo da SEFAZ (${brl(r.valor_resumo)}). ` +
        'Confira com o fornecedor; se estiver certo, confirme.',
    }
  }
  const texto =
    r.erro === 'cnpj_destinatario_diverge'
      ? `A nota é para outro CNPJ (${mascaraCnpj(r.cnpj_no_xml)}), não para esta empresa (${mascaraCnpj(r.cnpj_empresa)}). Envie na empresa certa.`
      : r.erro === 'chave_invalida'
        ? 'A chave de acesso do arquivo é inválida (precisa de 44 números e o dígito verificador certo). Peça o XML de novo ao fornecedor.'
        : r.erro === 'xml_invalido'
          ? 'O arquivo não é um XML de NF-e (pode ser o PDF/DANFE ou um arquivo corrompido).'
          : r.erro === 'empresa_sem_cnpj'
            ? 'A empresa selecionada está sem CNPJ no cadastro: complete em Dados da Empresa.'
            : r.erro === 'sem_acesso'
              ? 'Você não tem acesso a esta empresa.'
              : r.erro === 'aplicar_xml_falhou'
                ? 'O XML foi conferido mas não gravou. Tente este arquivo de novo.'
                : r.erro === 'tipo_arquivo'
                  ? 'Só arquivos .xml (ou .zip com XMLs dentro).'
                  : (r.erro ?? 'Falha ao aplicar o XML.')
  return { situacao: 'recusada', texto }
}

export function resumoLote(situacoes: (SituacaoLote | 'pendente' | 'enviando')[]) {
  const r = { total: situacoes.length, aplicada: 0, confirmar: 0, recusada: 0, pendente: 0 }
  for (const s of situacoes) {
    if (s === 'aplicada' || s === 'confirmar' || s === 'recusada') r[s]++
    else r.pendente++
  }
  return r
}
