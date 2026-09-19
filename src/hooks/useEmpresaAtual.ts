import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { getUsuarioId } from '@/lib/AuthProvider'

/**
 * Retorna o empresa_id do usuário logado buscando da tabela profiles.
 * Fallback: usa o ID do primeiro registro de empresas se profiles não tiver empresa_id.
 */
export function useEmpresaAtual() {
  const [empresaId, setEmpresaId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function buscar() {
      try {
        // Camada 2b: getUsuarioId() usa getSession (sem disputar a trava navigator.locks do mobile).
        const uid = await getUsuarioId()
        if (!uid) { setLoading(false); return }

        // Tenta buscar da tabela profiles
        const { data: profile } = await supabase
          .from('profiles')
          .select('empresa_id')
          .eq('id', uid)
          .single()

        if (profile?.empresa_id) {
          setEmpresaId(profile.empresa_id)
          setLoading(false)
          return
        }

        // Fallback: tenta tabela users_empresas ou similar
        const { data: ue } = await supabase
          .from('user_empresas')
          .select('empresa_id')
          .eq('user_id', uid)
          .limit(1)
          .single()

        if (ue?.empresa_id) {
          setEmpresaId(ue.empresa_id)
          setLoading(false)
          return
        }

        // Fallback final: usa o uid como empresa_id
        // (compatível com ERPs onde user = empresa)
        setEmpresaId(uid)
      } catch {
        // silencia erros de tabela não encontrada
      } finally {
        setLoading(false)
      }
    }
    buscar()
  }, [])

  return { empresaId, loading }
}
