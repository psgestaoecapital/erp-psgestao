'use client'
// CEO 25/11 — deep-link ?company=<id> (ex.: "Resolver" das pendências do grupo na Caixa do dia).
// Troca a empresa ATIVA para a empresa do link antes das telas de destino carregarem os dados,
// escrevendo ps_empresa_sel (a chave canônica lida por useCompanyIds em TODO o app, com polling).
// Mecanismo ÚNICO: vale para qualquer rota/deep-link, não só a conciliação.
// Fail-safe: só troca se a empresa pertencer ao usuário; senão abre a tela normal.
import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'

export default function SyncEmpresaUrl() {
  const params = useSearchParams()
  const { companies, loading } = useCompanyIds()
  const company = params.get('company')
  useEffect(() => {
    if (!company || loading) return
    // só empresa do usuário (fail-safe) — id inválido/sem acesso não troca
    const ok = Array.isArray(companies) && companies.some((e: { id?: string }) => e?.id === company)
    if (!ok) return
    try {
      if (localStorage.getItem('ps_empresa_sel') !== company) localStorage.setItem('ps_empresa_sel', company)
    } catch { /* localStorage bloqueado — segue na empresa atual */ }
  }, [company, companies, loading])
  return null
}
