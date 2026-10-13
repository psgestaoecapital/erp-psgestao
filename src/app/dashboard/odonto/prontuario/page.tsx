'use client'
// OD-3 · Consolidação: o prontuário (condições clínicas do odontograma + evoluções SOAP assinadas)
// agora vive na Ficha do Paciente (aba Prontuário) — fim do "Selecione um paciente". Esta rota antiga
// vira REDIRECT (RD-55: rota mantida, sem quebrar links). Com ?paciente=<id> abre direto a Ficha na
// aba Prontuário; sem paciente, cai na lista de Pacientes.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ProntuarioRedirect() {
  const router = useRouter()
  useEffect(() => {
    const pid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('paciente') : null
    router.replace(pid ? `/dashboard/odonto/pacientes/${pid}?aba=prontuario` : '/dashboard/odonto/pacientes')
  }, [router])
  return null
}
