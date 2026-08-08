'use client'
// OD-2 · Consolidação (feedback do CEO): o odontograma + plano vivem agora DENTRO da Ficha do
// Paciente (aba Tratamentos / Orçamentos) — fim do "Selecione um paciente". Esta rota antiga vira
// um REDIRECT (RD-55: não apagamos a rota, pra não quebrar links). Com ?paciente=<id> abre direto a
// Ficha na aba Tratamentos; sem paciente, cai na lista de Pacientes.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ClinicaRedirect() {
  const router = useRouter()
  useEffect(() => {
    const pid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('paciente') : null
    router.replace(pid ? `/dashboard/odonto/pacientes/${pid}?aba=tratamentos` : '/dashboard/odonto/pacientes')
  }, [router])
  return null
}
