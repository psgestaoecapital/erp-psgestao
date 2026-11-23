'use client'

// Hub · Execução da obra (auditoria CEO 20/11): as 15 telas de execução só abriam de dentro do
// Cockpit de uma obra. Agora elas têm item próprio no menu ("Execução da obra") que passa pelo
// resolvedor /dashboard/projetos/obras/ir/[tela]. Para o resolvedor abrir a tela "na última obra
// usada" em 1 toque, registramos aqui a obra que o usuário está vendo — toda tela [id] passa por
// este layout. É passthrough puro (não muda render/SSR das páginas filhas).
import { useEffect } from 'react'
import { useParams } from 'next/navigation'

export const CHAVE_ULTIMA_OBRA = 'ps:projetos:ultimaObra'

export default function ObraIdLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  useEffect(() => {
    if (!id) return
    try { window.localStorage.setItem(CHAVE_ULTIMA_OBRA, id) } catch { /* modo privado/sem storage: ignora */ }
  }, [id])
  return <>{children}</>
}
