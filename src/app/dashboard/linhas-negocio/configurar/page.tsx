'use client'
import React from 'react'
import LinhasConfig from '@/components/linhas-negocio/LinhasConfig'
import Link from 'next/link'

const EMPRESA_ID = process.env.NEXT_PUBLIC_EMPRESA_ID ?? ''

export default function ConfigurarLinhasPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Configurar linhas de negócio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Defina as linhas e o ERP passa a calcular a margem de contribuição de cada uma automaticamente.
          </p>
        </div>
        <Link href="/dashboard/linhas-negocio" className="text-sm text-muted-foreground hover:underline">
          ← Voltar
        </Link>
      </div>
      <LinhasConfig empresaId={EMPRESA_ID}/>
    </div>
  )
}
