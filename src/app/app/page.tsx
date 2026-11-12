'use client'
// Entrada neutra do app instalado (start_url do manifest, CEO 12/11).
// Decide o destino pelo papel/área do usuário na empresa selecionada:
//   • comercial/vendedor → /dashboard/comercial/meu-painel (o escopo por vendedor é garantido no banco);
//   • Agro → /dashboard/agro/rebanho (mantém o comportamento atual do Agro, RD-97);
//   • demais → início da primeira área liberada;
//   • sem login → /login (returnTo volta pra cá depois de entrar).
// Fica fora do /dashboard (sem AuthProvider/menu): lê a sessão e as áreas direto do Supabase.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const EMPRESA_STORAGE_KEY = 'ps_empresa_sel'

function companySelecionada(): string | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(EMPRESA_STORAGE_KEY)
  if (!v || v === 'consolidado' || v.startsWith('group_')) return null
  return v
}

type AreaMin = { area_slug: string; rota_raiz: string; empresa_tem_acesso: boolean }

export default function AppEntrada() {
  const router = useRouter()
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!vivo) return
      if (!session) { router.replace('/login?returnTo=/app'); return }

      let destino = '/dashboard'
      try {
        const cid = companySelecionada()
        const { data } = await supabase.rpc('fn_listar_areas_visiveis', { p_company_id: cid, p_user_id: session.user.id })
        const permitidas = ((data ?? []) as AreaMin[]).filter((a) => a.empresa_tem_acesso && a.rota_raiz)
        const comercial = permitidas.find((a) => a.area_slug === 'comercial')
        const agro = permitidas.find((a) => a.area_slug === 'agro')
        destino = comercial
          ? '/dashboard/comercial/meu-painel'
          : agro
            ? '/dashboard/agro/rebanho'
            : (permitidas[0]?.rota_raiz ?? '/dashboard')
      } catch {
        destino = '/dashboard'
      }
      if (!vivo) return
      router.replace(destino)
      // Rede de segurança: se o replace não navegar (raro), oferece o link manual.
      setTimeout(() => { if (vivo) setErro(true) }, 4000)
    })()
    return () => { vivo = false }
  }, [router])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#FAF7F2', color: '#6B5D4F', fontSize: 15, padding: 16, textAlign: 'center' }}>
      <div>Abrindo o PS Gestão…</div>
      {erro && (
        <a href="/dashboard" style={{ color: '#C8941A', fontWeight: 700 }}>Continuar para o sistema</a>
      )}
    </div>
  )
}
