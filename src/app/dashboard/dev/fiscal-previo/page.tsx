'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Central de Dev · Pré-voo fiscal (visão PS) — CONTAGEM por empresa de impeditivos de emissão de NF-e,
// não lista de itens (a lista fica na tela por empresa, em Configurações › Fiscal). Fonte única:
// fn_fiscal_previo_resumo(), que roda fn_fiscal_previo por empresa. Só PS_ADMIN (a RPC já barra o resto).
// Responde à pergunta do CEO na Central: "quais empresas estão prontas para emitir?"

const GO = '#C8941A', BG = '#FAF7F2', BG2 = '#FFFFFF', BD = '#E7DED3', TX = '#3D2314', TXM = '#6B5D4F'
const G = '#16A34A', R = '#C0392B', Y = '#CA8A04'

interface Linha {
  company_id: string
  empresa: string
  bloqueios: number
  produtos_incompletos: number
  destinatarios_pendentes: number
  pronto: boolean
}

export default function FiscalPrevioResumoPage() {
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])

  useEffect(() => {
    (async () => {
      setLoading(true); setErro(null)
      try {
        const { data, error } = await supabase.rpc('fn_fiscal_previo_resumo')
        if (error) throw new Error(error.message)
        setLinhas((data as unknown as Linha[]) ?? [])
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao carregar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const prontas = linhas.filter((l) => l.pronto).length

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <a href="/dashboard/dev" style={{ color: GO, fontSize: 12, textDecoration: 'none' }}>← Central de Dev</a>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: TX, marginTop: 10, marginBottom: 4 }}>
          ✈️ Pré-voo fiscal — quem está pronto para emitir NF-e
        </h1>
        <p style={{ fontSize: 12.5, color: TXM, lineHeight: 1.6, marginBottom: 18, maxWidth: 640 }}>
          Contagem de impeditivos por empresa. A lista detalhada (quais produtos, quais destinatários) fica
          na tela da própria empresa, em <b>Configurações › Fiscal</b>. Mesmos predicados do validador de NF-e.
        </p>

        {loading ? (
          <div style={{ color: TXM, fontSize: 13, padding: 24 }}>Carregando…</div>
        ) : erro ? (
          <div style={{ background: '#FCEBEB', border: `1px solid #E8A6A5`, borderRadius: 10, padding: 14, color: '#791F1F', fontSize: 13 }}>
            {erro}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: TXM, marginBottom: 12 }}>
              <b style={{ color: prontas === linhas.length ? G : TX }}>{prontas}</b> de <b>{linhas.length}</b> empresa(s) sem impeditivos de configuração.
            </div>
            <div style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#F0ECE3', color: TX, textAlign: 'left' }}>
                    <th style={{ padding: '9px 12px', fontWeight: 600 }}>Empresa</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'center' }}>Config</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'center' }}>Produtos</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'center' }}>Destinatários</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'center' }}>Pronto?</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.company_id} style={{ borderTop: `1px solid ${BD}` }}>
                      <td style={{ padding: '9px 12px', color: TX }}>{l.empresa}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', color: l.bloqueios > 0 ? R : G, fontWeight: 600 }}>
                        {l.bloqueios > 0 ? `${l.bloqueios} impeditivo(s)` : 'OK'}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', color: l.produtos_incompletos > 0 ? Y : G }}>
                        {l.produtos_incompletos > 0 ? l.produtos_incompletos : 'OK'}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', color: l.destinatarios_pendentes > 0 ? Y : G }}>
                        {l.destinatarios_pendentes > 0 ? l.destinatarios_pendentes : 'OK'}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.pronto ? G : R }}>
                        {l.pronto ? '✓' : '✗'}
                      </td>
                    </tr>
                  ))}
                  {linhas.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: TXM }}>Nenhuma empresa com emissor fiscal ativo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
