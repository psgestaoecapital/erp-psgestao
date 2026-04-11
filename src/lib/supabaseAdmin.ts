import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Variáveis de ambiente Admin Supabase não configuradas. ' +
    'Verifique SUPABASE_SERVICE_ROLE_KEY no .env.local (nunca exponha no cliente)'
  )
}

// ATENÇÃO: Este cliente tem acesso total ao banco.
// Use APENAS em Server Components, API Routes e Server Actions.
// NUNCA importe em arquivos de componente cliente ('use client').
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
