'use client'
// Aplica a preferência de tema do usuário logado assim que o dashboard monta (CEO 10/10). Aplica o default na hora
// (sem piscar) e, ao ler a preferência de erp_usuario_preferencia (RLS: só a do próprio usuário), reaplica. Sem linha
// ou erro → segue no default (dourado / automatico). Não renderiza nada.
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { aplicarTema } from '@/theme/aplicar-tema'
import { MODO_DEFAULT, type ModoTema, TEMA_DEFAULT } from '@/theme/theme-presets'

export default function ThemeApplier() {
  useEffect(() => {
    aplicarTema(TEMA_DEFAULT, MODO_DEFAULT)
    let vivo = true
    ;(async () => {
      try {
        const { data } = await supabase.from('erp_usuario_preferencia').select('tema, modo').maybeSingle()
        if (vivo && data) aplicarTema(data.tema ?? TEMA_DEFAULT, (data.modo as ModoTema) ?? MODO_DEFAULT)
      } catch { /* sem preferência → segue no default */ }
    })()
    return () => { vivo = false }
  }, [])
  return null
}
