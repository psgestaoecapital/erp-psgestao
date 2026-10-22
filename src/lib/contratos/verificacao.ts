// #2936 etapa 4 · Conferência pública de contrato assinado (/verificar/contrato) — regras puras (sem rede).
// Só dois formatos chegam ao banco: o código de verificação (12 hex, impresso no PDF) ou um hash SHA-256 (64 hex).
// Qualquer outra coisa é recusada antes, sem consulta (nada de busca parcial ou "parecida").

export const CODIGO_VERIFICACAO_RE = /^[0-9a-f]{12}$/
export const HASH_RE = /^[0-9a-f]{64}$/

export type Consulta = { tipo: 'codigo' | 'hash'; valor: string }

// "ab12 cd34-ef56" → { tipo: 'codigo', valor: 'ab12cd34ef56' }; espaços, hífens e pontos colados do PDF são ignorados.
export function normalizarConsulta(bruto: string | null | undefined): Consulta | null {
  const v = (bruto ?? '').toLowerCase().replace(/[\s.\-–—:]/g, '')
  if (CODIGO_VERIFICACAO_RE.test(v)) return { tipo: 'codigo', valor: v }
  if (HASH_RE.test(v)) return { tipo: 'hash', valor: v }
  return null
}

export function linkVerificacao(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, '')}/verificar/contrato?c=${encodeURIComponent(codigo.toUpperCase())}`
}

export interface SignatarioPublico { nome: string; papel: string; status: string; assinado_em: string | null }

export interface ResultadoVerificacao {
  ok: boolean; erro?: string; encontrado?: boolean; status?: string; versao?: number; documento_hash?: string
  concluido_em?: string | null; arquivo?: 'original' | 'assinado' | null; tem_pdf_assinado?: boolean
  signatarios?: SignatarioPublico[]
}

// Frase principal da página, em linguagem do usuário.
export function veredito(r: ResultadoVerificacao): { tom: 'ok' | 'aviso' | 'erro'; titulo: string; texto: string } {
  if (!r.encontrado) return {
    tom: 'erro', titulo: 'Documento não encontrado',
    texto: 'Nenhum contrato assinado por aqui tem esse código ou essa impressão digital. Se você conferiu um arquivo, ele pode ter sido alterado depois da assinatura.',
  }
  if (r.status === 'assinado') return {
    tom: 'ok', titulo: 'Contrato assinado por todos',
    texto: r.arquivo === 'assinado'
      ? 'O arquivo conferido é o PDF assinado original, sem nenhuma alteração.'
      : r.arquivo === 'original'
        ? 'O arquivo conferido é exatamente o documento que as partes assinaram.'
        : 'O código confere com um contrato assinado eletronicamente por todas as partes.',
  }
  if (r.status === 'cancelado') return { tom: 'erro', titulo: 'Envio cancelado', texto: 'Este envio para assinatura foi cancelado pela empresa e não vale como contrato assinado.' }
  if (r.status === 'expirado') return { tom: 'erro', titulo: 'Prazo vencido', texto: 'O prazo para assinar terminou antes de todas as partes assinarem. Este envio não vale como contrato assinado.' }
  return { tom: 'aviso', titulo: 'Assinatura em andamento', texto: 'Ainda falta alguém assinar. O contrato só vale como assinado quando todas as partes assinarem.' }
}
