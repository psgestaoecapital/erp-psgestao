import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const periodo = searchParams.get('periodo')
  if (!empresaId || !periodo) return NextResponse.json({ error: 'empresa_id e periodo obrigatórios' }, { status: 400 })

  // Busca DRE consolidada de todas as linhas via rota interna
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const token = req.headers.get('authorization')
  const dreRes = await fetch(
    `${baseUrl}/api/linhas-negocio/dre?empresa_id=${empresaId}&periodo=${periodo}`,
    { headers: { Authorization: token ?? '' } }
  )
  const dreJson = await dreRes.json()
  const linhas = dreJson.data ?? []

  if (!linhas.length) return NextResponse.json({ data: null })

  const receitaTotal = linhas.reduce((s: number, l: any) => s + l.receita_bruta, 0)
  const cm3Total = linhas.reduce((s: number, l: any) => s + l.cm3, 0)
  const sorted = [...linhas].sort((a: any, b: any) => b.cm3_pct - a.cm3_pct)

  return NextResponse.json({
    data: {
      linhas,
      consolidado: {
        receita_total: receitaTotal,
        cm3_total: cm3Total,
        cm3_pct_media: receitaTotal > 0 ? (cm3Total / receitaTotal) * 100 : 0,
        melhor_linha: sorted[0]?.linha_nome ?? '—',
        pior_linha: sorted[sorted.length - 1]?.linha_nome ?? '—',
      }
    }
  })
})
