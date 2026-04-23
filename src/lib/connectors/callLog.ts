// PS Gestão ERP — Helper para persistência de logs de chamadas de conectores.
// Usado por adapters (Omie, Nibo, ContaAzul, etc.) para gravar métricas de
// cada chamada a APIs externas na tabela data_source_call_logs.

import type { SupabaseClient } from '@supabase/supabase-js'

export type CallLogEntry = {
  companyId?: string | null
  dataSourceSlug: string
  endpoint: string
  params?: any
  duracaoMs?: number | null
  status: 'success' | 'error' | 'timeout' | 'rate_limit'
  httpStatus?: number | null
  errorMessage?: string | null
  responseBodyPreview?: string | null
}

/**
 * Grava uma linha em data_source_call_logs. Best-effort: se o INSERT
 * falhar, o erro é engolido — logging nunca deve derrubar o fluxo
 * operacional do caller.
 */
export async function logCall(
  supabase: SupabaseClient,
  entry: CallLogEntry
): Promise<void> {
  try {
    await supabase.from('data_source_call_logs').insert({
      company_id: entry.companyId ?? null,
      data_source_slug: entry.dataSourceSlug,
      endpoint: entry.endpoint,
      params: entry.params ?? null,
      duracao_ms: entry.duracaoMs ?? null,
      status: entry.status,
      http_status: entry.httpStatus ?? null,
      error_message: entry.errorMessage ? String(entry.errorMessage).slice(0, 2000) : null,
      response_body_preview: entry.responseBodyPreview
        ? String(entry.responseBodyPreview).slice(0, 500)
        : null,
    })
  } catch {
    // silent
  }
}
