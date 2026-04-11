import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Retorna o usuário autenticado em Server Components e Server Actions.
 * Retorna null se não houver sessão válida.
 */
export async function getServerUser() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/**
 * Retorna empresa_id do usuário logado via perfil na tabela 'profiles'.
 */
export async function getUserEmpresaId(): Promise<string | null> {
  const user = await getServerUser()
  if (!user) return null

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data } = await supabase
    .from('profiles')
    .select('empresa_id')
    .eq('id', user.id)
    .single()

  return data?.empresa_id ?? null
}
