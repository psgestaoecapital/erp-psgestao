'use client'

// CentralDivergencias (RD-49) — fila visível de divergências da ingestão.
// Padrão premium (card da OS): identificador é a estrela · severidade = semáforo ·
// impacto em R$ forte · sugestão da IA SEMPRE rotulada (não é dado oficial) ·
// ações discretas [Resolver] [Ignorar]. Mobile-first. LGPD: domínio 'gente' exige
// acesso RH/BPO/CEO (reusa fn_bi_gente_setores_visiveis, igual ao Ponto).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const S_VERM = '#B23B3B'; const S_VERM_BG = '#FCEBEB'
const S_AMBAR = '#C8941A'; const S_AMBAR_BG = '#FAEEDA'
const S_VERDE = '#2E7D5B'; const S_VERDE_BG = '#EAF3DE'

type Div = {
  id: string; fonte: string; dominio: string; tipo: string; severidade: 'critica'|'alta'|'media'|'baixa'
  titulo: string; descricao: string | null; contexto: Record<string, unknown> | null
  impacto_valor: number | null; impacto_descricao: string | null
  sugestao: Record<string, unknown> | null; sugestao_confianca: number | null; sugestao_motivo: string | null
  status: string
}
type Resumo = { ok?: boolean; abertas?: number; criticas?: number; impacto_total?: number; por_dominio?: Record<string, number> }

const DOMINIOS: { key: string; label: string; icone: string }[] = [
  { key: 'gente', label: 'Gente', icone: '👥' },
  { key: 'financeiro', label: 'Financeiro', icone: '💰' },
  { key: 'fiscal', label: 'Fiscal', icone: '🧾' },
  { key: 'estoque', label: 'Estoque', icone: '📦' },
]
const SEV = {
  critica: { dot: '🔴', fg: S_VERM, bg: S_VERM_BG, label: 'Crítica' },
  alta:    { dot: '🟡', fg: S_AMBAR, bg: S_AMBAR_BG, label: 'Alta' },
  media:   { dot: '🟡', fg: S_AMBAR, bg: S_AMBAR_BG, label: 'Média' },
  baixa:   { dot: '⚪', fg: MUT, bg: 'rgba(61,35,20,0.05)', label: 'Baixa' },
}
const fmtBRL = (n: number | null | undefined) => 'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CentralDivergencias() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [dominio, setDominio] = useState('gente')
  const [itens, setItens] = useState<Div[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [acessoGente, setAcessoGente] = useState<boolean | null>(null)
  const [setores, setSetores] = useState<string[]>([])
  const [resolvendo, setResolvendo] = useState<Div | null>(null)

  // gate LGPD do domínio gente (mesmo do Ponto)
  useEffect(() => {
    if (!empresaUnica) { setAcessoGente(null); return }
    let alive = true
    void supabase.rpc('fn_bi_gente_setores_visiveis', { p_company_id: empresaUnica }).then(({ data }) => {
      if (!alive) return
      const s = data as { ve_tudo?: boolean; setores?: string[] } | null
      setAcessoGente(!!(s?.ve_tudo || (s?.setores && s.setores.length > 0)))
    })
    return () => { alive = false }
  }, [empresaUnica])

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [res, lista, deptos] = await Promise.all([
      supabase.rpc('fn_divergencia_resumo', { p_company_id: empresaUnica }),
      supabase.rpc('fn_divergencia_listar', { p_company_id: empresaUnica, p_dominio: dominio, p_status: 'aberta' }),
      supabase.from('ind_ponto_colaborador').select('departamento').eq('company_id', empresaUnica).limit(1000),
    ])
    setResumo(res.data as Resumo)
    setItens((lista.data as Div[]) ?? [])
    const ds = new Set<string>()
    for (const r of (deptos.data ?? []) as { departamento: string | null }[]) if (r.departamento) ds.add(r.departamento)
    setSetores([...ds].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    setLoading(false)
  }, [empresaUnica, dominio])

  useEffect(() => { void carregar() }, [carregar])

  async function ignorar(d: Div) {
    const motivo = window.prompt(`Ignorar "${d.titulo}"?\nMotivo (fica registrado):`)
    if (!motivo) return
    const { data } = await supabase.rpc('fn_divergencia_ignorar', { p_id: d.id, p_motivo: motivo })
    if ((data as { ok?: boolean })?.ok) { setOk('Divergência arquivada.'); await carregar() }
    else setErro('Não foi possível ignorar.')
  }

  const gateGente = dominio === 'gente' && acessoGente !== true

  if (!empresaUnica) {
    return <Casca><Vazio titulo="Selecione uma empresa" texto="A fila de divergências é por empresa. Escolha uma no topo." /></Casca>
  }

  return (
    <Casca>
      {/* Cabeçalho com impacto */}
      <div style={{ background: ESP, borderRadius: 12, padding: '14px 18px', color: BG, marginBottom: 14, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{resumo?.abertas ?? 0}</span>
          <span style={{ fontSize: 13, marginLeft: 6, color: 'rgba(250,247,242,0.8)' }}>divergências abertas</span>
          {(resumo?.criticas ?? 0) > 0 && <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: '#E08A8A' }}>🔴 {resumo!.criticas} críticas</span>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(250,247,242,0.6)' }}>Impacto declarado</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#E8B94A', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(resumo?.impacto_total)}</div>
        </div>
      </div>

      {/* Abas por domínio */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {DOMINIOS.map((d) => {
          const n = resumo?.por_dominio?.[d.key] ?? 0
          const on = dominio === d.key
          return (
            <button key={d.key} onClick={() => setDominio(d.key)}
              style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: on ? ESP : '#FFF', color: on ? BG : ESP, border: `0.5px solid ${on ? ESP : LINE}` }}>
              {d.icone} {d.label}{n > 0 ? ` (${n})` : ''}
            </button>
          )
        })}
      </div>

      {erro && <div style={{ background: S_VERM_BG, color: S_VERM, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {ok && <div style={{ background: S_VERDE_BG, color: S_VERDE, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>✓ {ok}</div>}

      {gateGente ? (
        <Vazio titulo="Acesso restrito" texto="A fila de Gente mostra nome e custo por pessoa (dado sensível · LGPD) e é restrita a quem opera RH/BPO. Fale com o administrador." />
      ) : loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
      ) : itens.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: S_VERDE }}>✅ Nenhuma divergência aberta</div>
          <div style={{ fontSize: 13, color: MUT, marginTop: 4 }}>As integrações estão casando 100% neste domínio.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {itens.map((d) => (
            <CardDiv key={d.id} d={d} onResolver={() => setResolvendo(d)} onIgnorar={() => ignorar(d)} />
          ))}
        </div>
      )}

      {resolvendo && (
        <ModalResolver d={resolvendo} setores={setores} onClose={() => setResolvendo(null)}
          onDone={(msg) => { setResolvendo(null); setOk(msg); void carregar() }} onErro={setErro} />
      )}
    </Casca>
  )
}

function CardDiv({ d, onResolver, onIgnorar }: { d: Div; onResolver: () => void; onIgnorar: () => void }) {
  const sev = SEV[d.severidade] ?? SEV.media
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `3px solid ${sev.fg}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: sev.bg, color: sev.fg }}>{sev.dot} {sev.label}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: ESP }}>{d.titulo}</span>
          </div>
          {d.descricao && <div style={{ fontSize: 12, color: MUT, marginTop: 4, maxWidth: 620 }}>{d.descricao}</div>}
          {d.sugestao_confianca != null && (
            <div style={{ fontSize: 11, color: '#854F0B', background: S_AMBAR_BG, display: 'inline-block', padding: '3px 8px', borderRadius: 6, marginTop: 6 }}>
              💡 sugestão da IA · confiança {Math.round((d.sugestao_confianca) * 100)}% · não é dado oficial{d.sugestao_motivo ? ` — ${d.sugestao_motivo}` : ''}
            </div>
          )}
        </div>
        {d.impacto_descricao && (
          <div style={{ textAlign: 'right', minWidth: 120 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>Impacto</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: d.impacto_valor ? sev.fg : MUT }}>{d.impacto_valor != null ? fmtBRL(d.impacto_valor) : '—'}</div>
            <div style={{ fontSize: 10, color: MUT }}>{d.impacto_descricao}</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button data-test="div-ignorar" onClick={onIgnorar} style={{ padding: '7px 14px', borderRadius: 8, border: `0.5px solid ${LINE}`, background: '#FFF', color: MUT, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Ignorar</button>
        <button data-test="div-resolver" onClick={onResolver} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Resolver</button>
      </div>
    </div>
  )
}

function ModalResolver({ d, setores, onClose, onDone, onErro }: {
  d: Div; setores: string[]; onClose: () => void; onDone: (msg: string) => void; onErro: (e: string) => void
}) {
  const ehFolhaSemPonto = d.tipo === 'folha_sem_ponto'
  const [setor, setSetor] = useState('')
  const [naoApura, setNaoApura] = useState(false)
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const resolucao: Record<string, unknown> = ehFolhaSemPonto
      ? { setor: setor || null, apura_ponto: !naoApura, obs: obs || null }
      : { obs: obs || null }
    if (ehFolhaSemPonto && !setor && !naoApura) { onErro('Escolha um setor ou marque "não bate ponto".'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_divergencia_resolver', { p_id: d.id, p_resolucao: resolucao, p_origem: 'humano' })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { onErro(error?.message || j?.erro || 'Falha ao resolver'); return }
    onDone('Resolvido. Não perguntamos de novo.')
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 12, padding: 20, maxWidth: 440, width: '100%' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginBottom: 4 }}>Resolver divergência</div>
        <div style={{ fontSize: 12, color: MUT, marginBottom: 14 }}>{d.titulo}</div>

        {ehFolhaSemPonto ? (
          <>
            <label style={{ fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>Setor</label>
            <input list="setores-list" value={setor} onChange={(e) => setSetor(e.target.value)} placeholder="Escolha ou digite o setor"
              style={{ width: '100%', padding: '9px 12px', border: `0.5px solid rgba(61,35,20,0.25)`, borderRadius: 6, fontSize: 13, color: ESP, boxSizing: 'border-box', margin: '4px 0 12px' }} />
            <datalist id="setores-list">{setores.map((s) => <option key={s} value={s} />)}</datalist>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: ESP, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={naoApura} onChange={(e) => setNaoApura(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Esta pessoa <b>NÃO bate ponto</b> — entra no custo, fica fora do cálculo de horas.</span>
            </label>
          </>
        ) : (
          <div style={{ fontSize: 12, color: MUT, marginBottom: 12 }}>Confirmar que esta divergência foi tratada.</div>
        )}
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)"
          style={{ width: '100%', padding: '9px 12px', border: `0.5px solid rgba(61,35,20,0.25)`, borderRadius: 6, fontSize: 13, color: ESP, boxSizing: 'border-box', marginBottom: 16 }} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: `0.5px solid ${LINE}`, background: '#FFF', color: MUT, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: salvando ? '#C9BCA8' : GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer' }}>{salvando ? 'Salvando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>⚠️ Compartilhado</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Fila de Divergências</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>O que a ingestão não conseguiu casar sozinha. Resolva aqui — nunca perguntamos de novo.</p>
        </header>
        {children}
      </div>
    </div>
  )
}
function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div style={{ padding: '32px 20px', textAlign: 'center', background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: ESP, marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 13, color: MUT, maxWidth: 460, margin: '0 auto' }}>{texto}</div>
    </div>
  )
}
