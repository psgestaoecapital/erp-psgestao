'use client'

// Hub · Gestão de Obras · Portal do cliente (H9 · Decisão CEO 30/10) — detalhe de UMA obra, visão do cliente.
// V1 só leitura: avanço/cronograma, fotos do diário (RDO) e medições. Segurança 100% no banco:
// fn_obra_portal_avanco/_fotos/_medicoes chamam fn_obra_portal_pode_ver(p_obra_id) e RAISE 42501 ("Sem acesso")
// quando o auth.uid() não tem acesso ativo àquela obra — o cliente não enxerga obra que não é dele nem passando o id.
// Sem login as funções negam (auth.uid() nulo). RD-95 "?". RD-96/RD-100 próprios. Celular 390px.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/portal/obras/[id]'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

type TarefaPrev = { nome: string | null; inicio: string | null; fim: string | null; percentual: number | null }
type Avanco = {
  numero: string | null; nome: string | null; status: string | null
  pct_conclusao: number | null; data_inicio: string | null; data_prevista_fim: string | null
  tarefas: TarefaPrev[]
}
type FotoDia = { data: string | null; clima: string | null; atividades: string | null; fotos: string[] }
type MedicaoPrev = { numero: number | null; competencia: string | null; status: string | null; valor_total: number | null; aprovada_em: string | null }

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtBRL = (v: number | null | undefined) =>
  (typeof v === 'number' ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null | undefined) => `${Math.round(Number(v ?? 0))}%`

// 42501 = "Sem acesso a esta obra" (guarda do banco). Degrada para aviso amigável, nunca erro cru.
function semAcesso(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  return code === '42501' || /sem acesso|permission denied|not allowed/.test(msg)
}

export default function PortalObraDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [avanco, setAvanco] = useState<Avanco | null>(null)
  const [fotos, setFotos] = useState<FotoDia[]>([])
  const [medicoes, setMedicoes] = useState<MedicaoPrev[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [bloqueado, setBloqueado] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(''); setBloqueado(false)
    try {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth?.user) { router.replace(`/login?next=/portal/obras/${id}`); return }

      const av = await supabase.rpc('fn_obra_portal_avanco', { p_obra_id: id })
      if (av.error) {
        if (semAcesso(av.error)) { setBloqueado(true); return }
        throw av.error
      }
      if (av.data && Object.keys(av.data as object).length > 0) setAvanco(av.data as Avanco)

      const [ft, md] = await Promise.all([
        supabase.rpc('fn_obra_portal_fotos', { p_obra_id: id }),
        supabase.rpc('fn_obra_portal_medicoes', { p_obra_id: id }),
      ])
      if (!ft.error && Array.isArray(ft.data)) setFotos(ft.data as FotoDia[])
      if (!md.error && Array.isArray(md.data)) setMedicoes(md.data as MedicaoPrev[])
    } catch (e) {
      setErro(erroAmigavel(e, 'Não foi possível carregar o acompanhamento desta obra.'))
    } finally {
      setCarregando(false)
    }
  }, [id, router])

  useEffect(() => { void carregar() }, [carregar])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 4 }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Link href="/portal/obras" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Minhas obras</Link>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>{avanco?.nome || 'Acompanhamento da obra'}</h1>
          {avanco?.numero && <span style={{ fontSize: 14, color: MUT }}>{avanco.numero}</span>}
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Visão de leitura do andamento da sua obra. Sem custo nem margem — só avanço, fotos e medições.
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }} data-testid="erro">{erro}</div>}

        {bloqueado ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }} data-testid="portal-sem-acesso">
            Você não tem acesso a esta obra. Se o link mudou ou o acesso foi encerrado, peça à construtora um novo convite. Para ver as obras liberadas para você, volte para <Link href="/portal/obras" style={{ color: GOLD, fontWeight: 700 }}>Minhas obras</Link>.
          </div>
        ) : carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando o acompanhamento…</div>
        ) : (
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }} data-testid="portal-detalhe">
            {/* Avanço */}
            <div style={card} data-testid="detalhe-avanco">
              <div style={{ ...lbl, marginBottom: 10 }}>Avanço da obra <AjudaCampo chave="portal.obras.avanco" rota={ROTA} /></div>
              {!avanco ? (
                <div style={{ fontSize: 13, color: MUT }}>Ainda sem cronograma para mostrar. Assim que a construtora lançar as etapas e os avanços, eles aparecem aqui.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 30, fontWeight: 800, color: GOLD }}>{pct(avanco.pct_conclusao)}</span>
                    <span style={{ fontSize: 13, color: MUT }}>concluído{avanco.status ? ` · ${avanco.status}` : ''}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: MUT }}>{fmtData(avanco.data_inicio)} → {fmtData(avanco.data_prevista_fim)}</span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(61,35,20,0.08)', borderRadius: 6, marginTop: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(avanco.pct_conclusao ?? 0)))}%`, background: GOLD }} />
                  </div>
                  {avanco.tarefas.length > 0 && (
                    <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                      {avanco.tarefas.map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ flex: '1 1 180px', fontSize: 13, color: ESP, fontWeight: 600, minWidth: 0 }}>{t.nome || 'Etapa'}</span>
                          <span style={{ fontSize: 11, color: MUT }}>{fmtData(t.inicio)} → {fmtData(t.fim)}</span>
                          <div style={{ width: 90, height: 6, background: 'rgba(61,35,20,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(t.percentual ?? 0)))}%`, background: VERDE }} />
                          </div>
                          <span style={{ fontSize: 12, color: MUT, width: 42, textAlign: 'right' }}>{pct(t.percentual)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Fotos do diário */}
            <div style={card} data-testid="detalhe-fotos">
              <div style={{ ...lbl, marginBottom: 10 }}>Fotos do diário <AjudaCampo chave="portal.obras.fotos" rota={ROTA} /></div>
              {fotos.length === 0 ? (
                <div style={{ fontSize: 13, color: MUT }}>Sem fotos no diário ainda. As fotos que a equipe lança no diário de obra (RDO) aparecem aqui.</div>
              ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                  {fotos.map((f, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 12, color: ESP, fontWeight: 700 }}>{fmtData(f.data)}{f.clima ? ` · ${f.clima}` : ''}</div>
                      {f.atividades && <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{f.atividades}</div>}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {f.fotos.map((src, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={j} src={src} alt={`Foto do diário de ${fmtData(f.data)}`} loading="lazy"
                               style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: `1px solid ${LINE}` }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Medições */}
            <div style={card} data-testid="detalhe-medicoes">
              <div style={{ ...lbl, marginBottom: 10 }}>Medições <AjudaCampo chave="portal.obras.medicoes" rota={ROTA} /></div>
              {medicoes.length === 0 ? (
                <div style={{ fontSize: 13, color: MUT }}>Nenhuma medição lançada ainda. As medições da obra aparecem aqui para você acompanhar o que já foi medido.</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {medicoes.map((m, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 8, borderBottom: i < medicoes.length - 1 ? `1px solid ${LINE}` : 'none' }}>
                      <span style={{ fontSize: 13, color: ESP, fontWeight: 700 }}>Medição {m.numero ?? '—'}</span>
                      <span style={{ fontSize: 12, color: MUT }}>{m.competencia ? fmtData(m.competencia) : ''}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: m.status === 'aprovada' ? VERDE : MUT, background: m.status === 'aprovada' ? 'rgba(46,125,50,0.1)' : 'rgba(61,35,20,0.06)', padding: '2px 8px', borderRadius: 16 }}>{m.status || 'rascunho'}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 14, color: ESP, fontWeight: 700 }}>{fmtBRL(m.valor_total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
