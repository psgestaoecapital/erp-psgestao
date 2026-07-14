'use client'

// CentralMetas — cadastro de metas por indicador (fn_meta_listar + fn_meta_definir).
// Padrão premium: o NOME do indicador é a estrela; direção (maior/menor é melhor)
// como selo; a meta é editável; a sugestão do catálogo aparece discreta.
// RD-25: nunca inventa meta — só o gestor define; o sistema sugere.
// 🚨 direcao_boa vem do catálogo e nunca é editável aqui (é definição do indicador).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#2E7D5B'
const GREEN_BG = '#EAF3DE'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'

type Indicador = {
  indicador_id: string
  nome: string
  sigla: string | null
  unidade: string | null
  direcao_boa: 'maior' | 'menor' | 'neutro' | null
  tema: string | null
  o_que_mede: string | null
  meta: number | null
  meta_fonte: string | null
  tem_meta: boolean
  sugestao: number | null
}

const TEMA_LABEL: Record<string, string> = {
  gente: '👥 Gente', financeiro: '💰 Financeiro', operacional: '⚙️ Operacional',
  comercial: '🛒 Comercial', qualidade: '✅ Qualidade',
}
const fmtNum = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }))

export default function CentralMetas() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_meta_listar', { p_company_id: empresaUnica, p_tema: null })
    if (error) { setErro(error.message); setLoading(false); return }
    const r = data as { ok?: boolean; indicadores?: Indicador[] } | null
    setIndicadores(r?.indicadores ?? [])
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  async function salvar(ind: Indicador) {
    if (!empresaUnica) return
    const raw = rascunho[ind.indicador_id]
    const valor = Number(String(raw).replace(',', '.'))
    if (raw == null || raw === '' || !isFinite(valor)) { setErro('Informe um número válido para a meta.'); return }
    setSalvando(ind.indicador_id); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('fn_meta_definir', {
      p_company_id: empresaUnica, p_indicador_id: ind.indicador_id, p_valor_meta: valor, p_fonte: 'ceo',
    })
    setSalvando(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setErro(error?.message || j?.erro || 'Falha ao salvar'); return }
    setOk(`Meta de ${ind.nome} definida: ${fmtNum(valor)}${ind.unidade ? ` ${ind.unidade}` : ''}.`)
    setRascunho((s) => { const n = { ...s }; delete n[ind.indicador_id]; return n })
    await carregar()
  }

  const porTema = useMemo(() => {
    const m = new Map<string, Indicador[]>()
    for (const i of indicadores) { const t = i.tema ?? 'outros'; if (!m.has(t)) m.set(t, []); m.get(t)!.push(i) }
    return [...m.entries()]
  }, [indicadores])

  const comMeta = indicadores.filter((i) => i.tem_meta).length

  if (!empresaUnica) {
    return <Casca><Vazio titulo="Selecione uma empresa" texto="A Central de Metas é por empresa. Escolha uma empresa específica no topo." /></Casca>
  }

  return (
    <Casca>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div />
        <span style={{ fontSize: 12, color: MUT }}>{comMeta} de {indicadores.length} indicadores com meta definida</span>
      </div>

      {erro && <div style={{ background: RED_BG, color: RED, padding: '10px 14px', borderRadius: 8, margin: '8px 0', fontSize: 13 }}>{erro}</div>}
      {ok && <div style={{ background: GREEN_BG, color: GREEN, padding: '10px 14px', borderRadius: 8, margin: '8px 0', fontSize: 13, fontWeight: 600 }}>✓ {ok}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando indicadores…</div>
      ) : indicadores.length === 0 ? (
        <Vazio titulo="Nenhum indicador no catálogo" texto="Os indicadores nascem no catálogo (area_indicadores_mestres). A vertical de Gente já está cadastrada." />
      ) : (
        porTema.map(([tema, lista]) => (
          <section key={tema} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: ESP, margin: '4px 0 10px' }}>{TEMA_LABEL[tema] ?? tema}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lista.map((ind) => <CardMeta key={ind.indicador_id} ind={ind} rascunho={rascunho[ind.indicador_id] ?? ''} onRascunho={(v) => setRascunho((s) => ({ ...s, [ind.indicador_id]: v }))} onSalvar={() => salvar(ind)} salvando={salvando === ind.indicador_id} />)}
            </div>
          </section>
        ))
      )}
    </Casca>
  )
}

function CardMeta({ ind, rascunho, onRascunho, onSalvar, salvando }: {
  ind: Indicador; rascunho: string; onRascunho: (v: string) => void; onSalvar: () => void; salvando: boolean
}) {
  const dir = ind.direcao_boa
  const dirLabel = dir === 'menor' ? '↓ menor é melhor' : dir === 'maior' ? '↑ maior é melhor' : 'informativo'
  const dirCor = dir === 'menor' ? '#854F0B' : dir === 'maior' ? GREEN : MUT
  const dirBg = dir === 'menor' ? '#FAEEDA' : dir === 'maior' ? GREEN_BG : 'rgba(61,35,20,0.05)'
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `3px solid ${ind.tem_meta ? GOLD : LINE}`, borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: ESP }}>{ind.nome}</span>
          {ind.unidade && <span style={{ fontSize: 11, color: MUT }}>({ind.unidade})</span>}
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: dirBg, color: dirCor, letterSpacing: 0.3 }}>{dirLabel}</span>
        </div>
        {ind.o_que_mede && <div style={{ fontSize: 11, color: MUT, marginTop: 3, maxWidth: 520 }}>{ind.o_que_mede}</div>}
      </div>

      <div style={{ textAlign: 'right', minWidth: 96 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>Meta atual</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: ind.tem_meta ? ESP : MUT, fontVariantNumeric: 'tabular-nums' }}>
          {ind.tem_meta ? fmtNum(ind.meta) : '—'}
        </div>
        {ind.sugestao != null && !ind.tem_meta && (
          <button type="button" onClick={() => onRascunho(String(ind.sugestao))} style={{ fontSize: 10, color: GOLD, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0 0' }}>
            sugestão: {fmtNum(ind.sugestao)} ↵
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={rascunho}
          onChange={(e) => onRascunho(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSalvar() }}
          placeholder={ind.tem_meta ? 'nova meta' : 'defina a meta'}
          inputMode="decimal"
          style={{ width: 96, padding: '9px 12px', border: `0.5px solid rgba(61,35,20,0.25)`, borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', textAlign: 'right' }}
        />
        <button
          type="button"
          onClick={onSalvar}
          disabled={salvando || !rascunho}
          style={{ padding: '9px 14px', borderRadius: 8, border: 'none', background: salvando || !rascunho ? '#C9BCA8' : GOLD, color: '#FFF', fontSize: 12, fontWeight: 700, cursor: salvando || !rascunho ? 'not-allowed' : 'pointer', minHeight: 38 }}
        >
          {salvando ? '…' : ind.tem_meta ? 'Atualizar' : 'Definir'}
        </button>
      </div>
    </div>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🎯 Metas</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Central de Metas</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>Cada indicador com a SUA meta. A meta é sua decisão — o sistema sugere, você define. Serve todas as áreas do PS.</p>
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
