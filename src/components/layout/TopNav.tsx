'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import MobileDrawer from './MobileDrawer'
import { supabase } from '@/lib/supabase'

interface UserResumo {
  email: string
  iniciais: string
}

export default function TopNav() {
  const [user, setUser] = useState<UserResumo | null>(null)
  const [temNotificacao, setTemNotificacao] = useState(false)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser?.email && !ignore) {
        const partes = authUser.email.split('@')[0].split('.')
        const iniciais = (partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')
        setUser({
          email: authUser.email,
          iniciais: iniciais.toUpperCase() || authUser.email[0].toUpperCase(),
        })
      }
      if (!ignore) setTemNotificacao(true)
    })()
    return () => { ignore = true }
  }, [])

  return (
    <header className="sticky top-0 z-20 bg-[#FAF7F2] border-b border-[#3D2314]/10 h-14 px-3 sm:px-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="md:hidden bg-[#3D2314] rounded-lg">
          <MobileDrawer />
        </div>
        <Link
          href="/dashboard/home"
          className="md:hidden flex items-center gap-2 text-[#3D2314]"
        >
          <span className="w-8 h-8 bg-[#C8941A] rounded-md flex items-center justify-center text-[#3D2314] font-medium text-[12px]">
            PS
          </span>
          <span className="text-[14px] font-medium">PS Gestão</span>
        </Link>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          aria-label="Notificações"
          data-testid="bell-notifications"
          className="relative w-9 h-9 rounded-lg hover:bg-[#3D2314]/8 flex items-center justify-center transition-colors text-[#3D2314]"
        >
          <Bell size={18} />
          {temNotificacao && (
            <span className="absolute top-[7px] right-[8px] w-[7px] h-[7px] bg-[#E24B4A] rounded-full ring-[1.5px] ring-[#FAF7F2]" />
          )}
        </button>

        {user && (
          <button
            type="button"
            aria-label={`Conta de ${user.email}`}
            data-testid="user-avatar"
            className="w-9 h-9 rounded-full bg-[#C8941A] text-[#3D2314] font-medium text-[13px] flex items-center justify-center hover:opacity-95 transition-opacity ring-[1.5px] ring-[#3D2314]/15"
          >
            {user.iniciais}
          </button>
        )}
      </div>
    </header>
  )
}
