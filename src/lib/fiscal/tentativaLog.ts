import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Registro de TODA tentativa de operação fiscal na nota (NFS-e/NF-e): cancelamento, emissão, consulta.
// Doutrina "nada de falha silenciosa" (igual e-mails e bancos): grava nota, usuário, endpoint, status
// HTTP, código e mensagem da Focus/prefeitura, horário — SEM dado sensível (nunca XML/certificado/payload).

export interface TentativaFiscal {
  companyId: string
  notaTipo: 'nfse' | 'nfe' | 'nfce'
  notaId?: string | null
  // texto livre no banco: 'cancelamento' | 'emissao' | 'consulta' | 'carta_correcao' | 'devolucao' |
  // 'certificado_upload' | 'certificado_remover' | 'provider_config' | 'webhook_config' | 'testar_conexao' | ...
  operacao: string
  provider?: string | null
  endpoint?: string | null
  referencia?: string | null
  httpStatus?: number | null
  providerCodigo?: string | null
  providerMensagem?: string | null
  resultado: 'ok' | 'erro' | 'rejeitada' | 'ja_cancelada' | 'processando'
  usuarioId?: string | null
}

// Best-effort: nunca quebra o fluxo principal (mas nunca fica em silêncio — loga no servidor se falhar).
export async function registrarTentativaFiscal(t: TentativaFiscal): Promise<void> {
  try {
    await supabaseAdmin.from('erp_fiscal_tentativa').insert({
      company_id: t.companyId,
      nota_tipo: t.notaTipo,
      nota_id: t.notaId ?? null,
      operacao: t.operacao,
      provider: t.provider ?? null,
      endpoint: t.endpoint ?? null,
      referencia: t.referencia ?? null,
      http_status: t.httpStatus ?? null,
      provider_codigo: t.providerCodigo ?? null,
      provider_mensagem: t.providerMensagem ? String(t.providerMensagem).slice(0, 1000) : null,
      resultado: t.resultado,
      usuario_id: t.usuarioId ?? null,
    })
  } catch (e) {
    console.error('[registrarTentativaFiscal] falhou ao gravar tentativa fiscal', e)
  }
}

// Mensagem clara ao usuário a partir do motivo REAL devolvido pela Focus/prefeitura + próximo passo.
// Prazo vencido → aponta o Emissor Nacional / prefeitura. Nos demais casos mostra o motivo real (verbatim).
export function mensagemCancelamentoAmigavel(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim()
  if (/prazo|tempestiv|fora do prazo|expirad|n[ãa]o permitido o cancelamento|decurso de prazo|prazo de cancelamento/i.test(m)) {
    return 'O prazo de cancelamento desta prefeitura terminou. Cancele pelo Emissor Nacional (nfse.gov.br) ou peça o cancelamento fora do prazo na prefeitura.'
  }
  return m || 'O provedor não confirmou o cancelamento. Tente novamente em instantes.'
}

// A Focus/prefeitura indicou que a nota JÁ está cancelada → sincronizar o status local.
export function pareceJaCancelada(motivo: string | null | undefined): boolean {
  return /j[áa]\s*(est[áa])?\s*cancel|already cancel|nota cancelada|documento cancelado|cancelamento j[áa]/i.test((motivo ?? ''))
}
