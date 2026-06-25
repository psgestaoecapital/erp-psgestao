// CORS compartilhado pras Edge Functions chamadas direto do browser
// (supabase.functions.invoke). Sem isso, o preflight OPTIONS falha e o
// browser bloqueia o POST com 'Failed to send a request to the Edge Function'.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
