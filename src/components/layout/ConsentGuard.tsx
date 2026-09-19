'use client'
// ConsentGuard: o GATE de consentimento LGPD (restaura a chamada que sumiu no #126, 14/05).
// Montado no dashboard/layout → só roda em rotas autenticadas do dashboard. Se o usuário está
// PENDENTE na versão vigente (fn_lgpd_consentimento_pendente, que lê a versão do PARÂMETRO e o
// consolidado por auth.uid()), manda pra ROTA /aceite — nunca um modal no root layout (o #124
// fazia isso e aparecia em login/públicas; foi revertido em 47s). /aceite fica FORA do dashboard,
// então não há laço, e páginas públicas (/termos, /privacidade, /) não são bloqueadas.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function ConsentGuard() {
  const router = useRouter()
  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
      if (ignore || !user) return
      const { data, error } = await supabase.rpc('fn_lgpd_consentimento_pendente')
      if (ignore || error) return
      if (data === true) router.replace('/aceite')
    })()
    return () => { ignore = true }
  }, [router])
  return null
}
