// src/app/sign/epi/[token]/page.tsx
// Rota PUBLICA (sem auth) — funcionario abre via link wa.me e assina
// recebimento dos EPIs digitalmente (Lei 14.063/2020).
//
// Middleware atual (src/middleware.ts) so protege /api/dev/*, entao /sign/*
// e publicamente acessivel sem alteracao.
//
// Mobile-first: vai ser aberto via WhatsApp no celular do trabalhador.
// Padrao visual minimal Estrela Polar (espresso/off-white/dourado).

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  espressoM: '#6B5D4F',
  offwhite: '#FAF7F2',
  cream: '#F0ECE3',
  gold: '#C8941A',
  goldSoft: '#E8C872',
  borderLt: '#E0D8CC',
  ink: '#1A1A1A',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  amber: '#EAB308',
  amberSoft: '#FEF3C7',
}

interface Viz {
  token_id: string
  company_id: string
  funcionario_nome: string
  funcionario_cpf: string
  catalogo_ids: string[]
  quantidades: number[]
  expires_at: string
  expirado: boolean
  ja_assinado: boolean
}

interface EpiInfo {
  id: string
  nome: string
  ca_numero: string | null
}

interface ConfirmRes {
  sucesso: boolean
  assinatura_id: string | null
  movimentacoes_criadas: number | null
  mensagem: string
}

function maskCPF(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function fmtData(s: string): string {
  try {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

export default function SignEpiPage() {
  const params = useParams()
  const token = params?.token as string

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [viz, setViz] = useState<Viz | null>(null)
  const [epis, setEpis] = useState<EpiInfo[]>([])
  const [cpf, setCpf] = useState('')
  const [aceito, setAceito] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [confirmado, setConfirmado] = useState<ConfirmRes | null>(null)
  const [geoloc, setGeoloc] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)

  // Carregar token + marcar visualizado
  useEffect(() => {
    if (!token) return
    let alive = true
    ;(async () => {
      try {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
        const { data, error } = await supabase.rpc('fn_compliance_epi_marcar_visualizado', {
          p_token: token,
          p_ip: null,
          p_user_agent: ua,
        })
        if (error) throw error
        const r = (Array.isArray(data) ? data[0] : data) as Viz
        if (!alive) return
        if (!r) throw new Error('Token nao encontrado')
        setViz(r)

        // Buscar nomes dos EPIs
        if (r.catalogo_ids && r.catalogo_ids.length > 0) {
          const { data: cats } = await supabase
            .from('epi_catalogo')
            .select('id, nome, ca_numero')
            .in('id', r.catalogo_ids)
          if (alive) setEpis((cats ?? []) as EpiInfo[])
        }
      } catch (e: any) {
        if (alive) setErro(e?.message || 'Falha ao carregar')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [token])

  // Tentar capturar geolocalizacao (nao bloqueia se negar)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoloc({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => { /* user negou ou erro — segue sem geoloc */ },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 0 },
    )
  }, [])

  async function confirmar() {
    if (!viz || !cpf || !aceito) return
    setEnviando(true)
    setErro(null)
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
      const cpfLimpo = cpf.replace(/\D/g, '')
      const { data, error } = await supabase.rpc('fn_compliance_epi_confirmar_assinatura', {
        p_token: token,
        p_codigo_confirmacao: cpfLimpo,
        p_ip: null,
        p_user_agent: ua,
        p_geolocalizacao: geoloc ? geoloc : null,
        p_foto_url: null,
      })
      if (error) throw error
      const r = (Array.isArray(data) ? data[0] : data) as ConfirmRes
      if (!r?.sucesso) {
        throw new Error(r?.mensagem || 'CPF nao confere. Verifique e tente novamente.')
      }
      setConfirmado(r)
    } catch (e: any) {
      setErro(e?.message || 'Falha ao confirmar')
    } finally {
      setEnviando(false)
    }
  }

  const podeConfirmar = !!viz && cpf.replace(/\D/g, '').length === 11 && aceito && !enviando

  // Estado: carregando
  if (loading) {
    return (
      <PageShell>
        <p style={{ textAlign: 'center', color: C.muted, fontSize: 14 }}>Carregando…</p>
      </PageShell>
    )
  }

  // Estado: erro
  if (erro && !viz) {
    return (
      <PageShell>
        <div style={erroBanner}>{erro}</div>
      </PageShell>
    )
  }

  // Estado: ja assinado
  if (viz?.ja_assinado) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, color: C.espresso, margin: '0 0 8px' }}>Já confirmado</h2>
          <p style={{ color: C.espressoM, fontSize: 14, margin: 0 }}>
            EPIs ja confirmados. Obrigado!
          </p>
        </div>
      </PageShell>
    )
  }

  // Estado: expirado
  if (viz?.expirado) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⏰</div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, color: C.espresso, margin: '0 0 8px' }}>Link expirou</h2>
          <p style={{ color: C.espressoM, fontSize: 14, margin: 0 }}>
            Solicite um novo link ao seu gestor para confirmar a entrega dos EPIs.
          </p>
        </div>
      </PageShell>
    )
  }

  // Estado: sucesso pos-confirmacao
  if (confirmado?.sucesso) {
    const hashPreview = confirmado.assinatura_id?.replace(/-/g, '').slice(0, 16) || ''
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: C.espresso, margin: '0 0 8px' }}>Recebimento confirmado!</h2>
          <p style={{ color: C.espressoM, fontSize: 14, margin: '0 0 16px' }}>
            Sua assinatura digital foi registrada com sucesso.
          </p>
          {hashPreview && (
            <div style={{ background: C.cream, padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 12, color: C.espresso, marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Hash de integridade:</div>
              {hashPreview}…
            </div>
          )}
          <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
            Pode fechar esta janela. O comprovante foi enviado ao seu gestor.
          </p>
        </div>
      </PageShell>
    )
  }

  // Estado: formulario principal
  const nome = viz?.funcionario_nome ?? ''
  const primeiroNome = nome.split(' ')[0] || nome

  return (
    <PageShell>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, color: C.espresso, margin: '0 0 4px' }}>
        Olá, {primeiroNome}!
      </h2>
      <p style={{ color: C.espressoM, fontSize: 14, margin: '0 0 18px' }}>
        Confirme abaixo o recebimento dos EPIs.
      </p>

      <div style={cardBox}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
          EPIs a receber ({epis.length})
        </div>
        {epis.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 12, fontStyle: 'italic', margin: 0 }}>Sem EPIs vinculados</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: C.espresso, fontSize: 14, lineHeight: 1.7 }}>
            {epis.map((e, i) => {
              const qtd = viz?.quantidades?.[viz.catalogo_ids.indexOf(e.id)] ?? 1
              return (
                <li key={e.id}>
                  <strong>{qtd}x</strong> {e.nome}
                  {e.ca_numero && <span style={{ fontSize: 11, color: C.muted }}> · CA {e.ca_numero}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div style={{ ...cardBox, background: C.amberSoft, borderColor: C.amber }}>
        <p style={{ fontSize: 12, color: '#92400E', margin: 0, lineHeight: 1.5 }}>
          <strong>Aviso legal:</strong> Sua assinatura digital tem valor jurídico pela{' '}
          <strong>Lei 14.063/2020</strong>. Um hash de integridade é gerado para garantir que os dados
          não foram alterados.
        </p>
      </div>

      <label style={labelStyle}>CPF</label>
      <input
        type="tel"
        inputMode="numeric"
        value={cpf}
        onChange={(e) => setCpf(maskCPF(e.target.value))}
        placeholder="000.000.000-00"
        autoComplete="off"
        style={inputStyle}
      />

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 8, marginTop: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={aceito}
          onChange={(e) => setAceito(e.target.checked)}
          style={{ marginTop: 3, width: 18, height: 18, accentColor: C.gold, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, color: C.espresso, lineHeight: 1.5 }}>
          Recebi os EPIs listados acima e estou ciente das instruções de uso, conservação e troca.
        </span>
      </label>

      {erro && <div style={{ ...erroBanner, marginTop: 12 }}>{erro}</div>}

      <button
        onClick={confirmar}
        disabled={!podeConfirmar}
        style={{
          marginTop: 16,
          width: '100%',
          minHeight: 52,
          padding: 14,
          borderRadius: 10,
          border: 'none',
          background: podeConfirmar ? C.green : C.borderLt,
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: 700,
          cursor: podeConfirmar ? 'pointer' : 'not-allowed',
          transition: 'opacity 0.15s',
        }}
      >
        {enviando ? '⏳ Confirmando…' : '✓ Confirmar Recebimento'}
      </button>

      <p style={{ fontSize: 10, color: C.muted, textAlign: 'center', margin: '14px 0 0' }}>
        Link expira em {fmtData(viz?.expires_at ?? '')}
      </p>
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: C.offwhite, color: C.ink, padding: 'clamp(12px, 4vw, 24px)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 24, paddingTop: 12 }}>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 700, color: C.espresso, letterSpacing: 1 }}>
            PS <span style={{ color: C.gold }}>Gestão</span>
          </div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>
            Confirmação de Entrega de EPI
          </div>
        </header>
        {children}
        <footer style={{ marginTop: 32, paddingTop: 16, borderTop: `1px solid ${C.borderLt}`, fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 1.6 }}>
          Lei 14.063/2020 · Hash SHA-256 · Audit trail completo
        </footer>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.espressoLt, letterSpacing: 0.5, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '14px 14px', background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 8, fontSize: 17, color: C.ink, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const cardBox: React.CSSProperties = { background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: 14, marginBottom: 14 }
const erroBanner: React.CSSProperties = { background: C.redSoft, color: '#991B1B', padding: '12px 14px', borderRadius: 8, fontSize: 13, borderLeft: `4px solid ${C.red}` }
