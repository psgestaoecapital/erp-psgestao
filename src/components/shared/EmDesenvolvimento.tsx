'use client'
import { type ReactNode } from 'react'

interface Props {
  icone?: string
  titulo: string
  descricao?: string
  vertical?: 'odonto' | 'medica' | string
  resumo?: ReactNode
}

export default function EmDesenvolvimento({ icone = '🚧', titulo, descricao, vertical, resumo }: Props) {
  return (
    <div className="p-4 max-w-3xl mx-auto" style={{ color: '#3D2314' }}>
      <header className="mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span aria-hidden>{icone}</span>
          {titulo}
        </h1>
        {descricao && <p className="text-sm opacity-70">{descricao}</p>}
      </header>
      <div className="rounded-xl p-6 text-center" style={{ background: '#FAF7F2' }}>
        <p className="font-medium">Em desenvolvimento</p>
        <p className="text-sm opacity-70 mt-1">
          Esta tela faz parte das próximas entregas da vertical
          {vertical ? ` ${vertical}` : ''}. O módulo financeiro já está disponível em
          {' '}<a href="/dashboard/gestao-empresarial" className="underline" style={{ color: '#C8941A' }}>Gestão Empresarial</a>.
        </p>
        {resumo && <div className="mt-4 text-sm opacity-80">{resumo}</div>}
      </div>
    </div>
  )
}
