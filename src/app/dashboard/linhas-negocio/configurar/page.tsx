'use client'
import React from 'react'
import LinhasConfig from '@/components/linhas-negocio/LinhasConfig'
import Link from 'next/link'
import { useEmpresaAtual } from '@/hooks/useEmpresaAtual'

// RD-96: paleta PS premium (#C8941A/#3D2314, Fraunces), consistente com as telas irmãs da jornada.
const C = { espresso: '#3D2314', dourado: '#C8941A', fundo: '#FAF7F2', muted: 'rgba(61,35,20,0.6)', erro: '#A32D2D' }

export default function ConfigurarLinhasPage() {
  const { empresaId, loading } = useEmpresaAtual()

  if (loading) {
    return <div style={{ padding: 24, fontSize: 13, color: C.muted, background: C.fundo, minHeight: '100vh' }}>Carregando...</div>
  }

  return (
    <div style={{ background: C.fundo, minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Linhas de negócio
            </div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: C.espresso, margin: 0 }}>
              Configurar linhas de negócio
            </h1>
            <p style={{ fontSize: 13, color: C.muted, marginTop: 4, maxWidth: 520 }}>
              Defina as linhas e o ERP passa a calcular a margem de contribuição de cada uma automaticamente.
            </p>
          </div>
          <Link href="/dashboard/linhas-negocio" style={{ fontSize: 13, color: C.dourado, textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ← Voltar
          </Link>
        </div>
        {empresaId ? (
          <LinhasConfig empresaId={empresaId}/>
        ) : (
          <p style={{ fontSize: 13, color: C.erro }}>
            Não foi possível identificar a empresa. Verifique se o seu perfil está configurado.
          </p>
        )}
      </div>
    </div>
  )
}
