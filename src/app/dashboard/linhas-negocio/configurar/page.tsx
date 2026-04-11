'use client'
import React from 'react'
import LinhasConfig from '@/components/linhas-negocio/LinhasConfig'
import Link from 'next/link'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'

export default function ConfigurarLinhasPage() {
  const { empresaId, loading } = useEmpresaAtual()

  if (loading) {
    return <div className='p-6 text-sm text-muted-foreground'>Carregando...</div>
  }

  return (
    <div className='p-6 max-w-2xl mx-auto space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-xl font-bold'>Configurar linhas de negócio</h1>
          <p className='text-sm text-muted-foreground mt-0.5'>
            Defina as linhas e o ERP passa a calcular a margem de contribuição de cada uma automaticamente.
          </p>
        </div>
        <Link href='/dashboard/linhas-negocio' className='text-sm text-muted-foreground hover:underline'>
          ← Voltar
        </Link>
      </div>
      {empresaId ? (
        <LinhasConfig empresaId={empresaId}/>
      ) : (
        <p className='text-sm text-destructive'>
          Não foi possível identificar a empresa. Verifique se o seu perfil está configurado.
        </p>
      )}
    </div>
  )
}
