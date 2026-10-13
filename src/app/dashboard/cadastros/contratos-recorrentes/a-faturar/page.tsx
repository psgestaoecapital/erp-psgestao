'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

interface Contrato {
  id: string
  cliente_nome: string | null
  nome: string | null
  valor_atual: number | null
  valor_mensal: number | null
  dia_vencimento: number | null
  periodicidade: string | null
  data_primeiro_vencimento: string | null
  ultimo_titulo_gerado_em: string | null
  status: string | null
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function proximoVencimentoISO(c: Contrato, hoje: Date): string | null {
  if (c.dia_vencimento && c.dia_vencimento >= 1 && c.dia_vencimento <= 31) {
    const mes = new Date(hoje.getFullYear(), hoje.getMonth(), c.dia_vencimento)
    if (mes < hoje) mes.setMonth(mes.getMonth() + 1)
    const last = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
    if (mes.getDate() > last) mes.setDate(last)
    return mes.toISOString().slice(0, 10)
  }
  if (c.ultimo_titulo_gerado_em) {
    const u = new Date(c.ultimo_titulo_gerado_em + 'T00:00:00')
    u.setMonth(u.getMonth() + 1)
    return u.toISOString().slice(0, 10)
  }
  return c.data_primeiro_vencimento ?? null
}

export default function ContratosAFaturarPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [contratos, setContratos] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [faturandoId, setFaturandoId] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null)

  const carregar = async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('erp_contratos')
      .select('id, cliente_nome, nome, valor_atual, valor_mensal, dia_vencimento, periodicidade, data_primeiro_vencimento, ultimo_titulo_gerado_em, status')
      .eq('company_id', empresaUnica)
      .eq('status', 'ativo')
      .order('cliente_nome')
    setContratos((data ?? []) as Contrato[])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [empresaUnica])

  const hoje = useMemo(() => {
    const h = new Date()
    h.setHours(0, 0, 0, 0)
    return h
  }, [])

  const proximos = useMemo(() => {
    const limite = new Date(hoje)
    limite.setDate(hoje.getDate() + 15)
    return contratos
      .map((c) => ({ contrato: c, proxIso: proximoVencimentoISO(c, hoje) }))
      .filter(({ proxIso }) => {
        if (!proxIso) return false
        const d = new Date(proxIso + 'T00:00:00')
        return d >= hoje && d <= limite
      })
      .sort((a, b) => (a.proxIso ?? '').localeCompare(b.proxIso ?? ''))
  }, [contratos, hoje])

  async function faturar(c: Contrato, mesReferenciaISO: string) {
    if (!confirm(`Gerar a cobrança de ${c.cliente_nome ?? c.nome ?? 'cliente'} agora?`)) return
    setFaturandoId(c.id)
    setMensagem(null)
    const { error } = await supabase.rpc('fn_contrato_gerar_receber', {
      p_contrato_id: c.id,
      p_mes_referencia: mesReferenciaISO,
    })
    setFaturandoId(null)
    if (error) {
      setMensagem({ tipo: 'erro', texto: error.message })
      return
    }
    setMensagem({ tipo: 'ok', texto: `Cobrança gerada com sucesso (${c.cliente_nome ?? 'cliente'})` })
    carregar()
  }

  if (!empresaUnica) {
    return (
      <div style={{ padding: 40, background: '#FAF7F2', minHeight: '100vh', color: 'rgba(61,35,20,0.7)' }}>
        Selecione uma empresa para ver os contratos a faturar.
      </div>
    )
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Link href="/dashboard/cadastros/contratos-recorrentes" style={{ fontSize: 13, color: '#3D2314', textDecoration: 'none' }}>
          ← Voltar aos contratos
        </Link>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: '6px 0 4px', fontWeight: 400 }}>
          Contratos a Faturar
        </h1>
        <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, marginBottom: 20 }}>
          Próximos 15 dias · clique em <strong>Faturar agora</strong> para gerar a cobrança em contas a receber.
        </p>

        {mensagem && (
          <div style={{
            background: mensagem.tipo === 'ok' ? '#E8F5DD' : mensagem.tipo === 'erro' ? '#FCEBEB' : '#FFF8E7',
            color: mensagem.tipo === 'ok' ? '#3B6D11' : mensagem.tipo === 'erro' ? '#A32D2D' : '#854F0B',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}>
            {mensagem.texto}
          </div>
        )}

        {loading ? (
          <div style={{ background: '#FFFFFF', padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.5)', borderRadius: 8 }}>
            Carregando contratos…
          </div>
        ) : proximos.length === 0 ? (
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>✅</div>
            <div style={{ fontSize: 14, color: '#3D2314', marginBottom: 4 }}>Nenhum contrato a faturar nos próximos 15 dias.</div>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>Cadastre contratos recorrentes ativos para ver aqui.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {proximos.map(({ contrato, proxIso }) => {
              const valor = contrato.valor_atual ?? contrato.valor_mensal ?? 0
              const cliente = contrato.cliente_nome ?? '(sem nome)'
              return (
                <div key={contrato.id} style={{
                  background: '#FFFFFF',
                  border: '0.5px solid rgba(61,35,20,0.12)',
                  borderLeft: '4px solid #C8941A',
                  borderRadius: 8,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314' }}>{cliente}</div>
                    <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)', marginTop: 2 }}>
                      {contrato.nome ?? 'Contrato'} · próx. venc {proxIso ? fmtDate(proxIso) : '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 110 }}>
                    <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Valor</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#3D2314', fontVariantNumeric: 'tabular-nums' }}>R$ {fmt(valor)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => faturar(contrato, proxIso ?? hoje.toISOString().slice(0, 10))}
                    disabled={faturandoId === contrato.id}
                    style={{
                      background: faturandoId === contrato.id ? 'rgba(200,148,26,0.5)' : '#C8941A',
                      color: '#3D2314',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: faturandoId === contrato.id ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {faturandoId === contrato.id ? 'Faturando…' : 'Faturar agora →'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
