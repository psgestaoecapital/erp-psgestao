'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MeusDadosLGPD from '@/components/lgpd/MeusDadosLGPD'

export default function Page() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // FIX PR-152-sidebar: rota LGPD precisa contexto Compliance na sidebar.
  // Sem ?area=, o layout cai para a P3 (sessionStorage) e mostra a última
  // área visitada (em geral "Comércio & Serviços" do default).
  useEffect(() => {
    if (searchParams?.get('area') !== 'compliance') {
      const novos = new URLSearchParams(searchParams?.toString() ?? '')
      novos.set('area', 'compliance')
      router.replace(`/dashboard/lgpd/meus-dados?${novos.toString()}`)
    }
  }, [searchParams, router])

  return <MeusDadosLGPD />
}
