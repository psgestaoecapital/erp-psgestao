'use client'
// PRONTUÁRIO + ODONTOGRAMA clínico (O3). Evolução imutável (CFO) + odontograma por dente.
// Reusa erp_odonto_paciente/profissional/procedimento (RD-26). Escopo company_id (RD-45).
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, ChevronLeft, Lock, Plus, Stethoscope } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const TOP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const BOTTOM = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

// condição → cor (odontograma clínico)
const CONDICOES: { id: string; label: string; cor: string }[] = [
  { id: 'higido', label: 'Hígido', cor: '#FFFFFF' },
  { id: 'carie', label: 'Cárie', cor: '#E11D48' },
  { id: 'restauracao', label: 'Restauração', cor: '#2563EB' },
  { id: 'canal', label: 'Canal', cor: '#7C3AED' },
  { id: 'coroa', label: 'Coroa', cor: '#C8941A' },
  { id: 'implante', label: 'Implante', cor: '#0D9488' },
  { id: 'ausente', label: 'Ausente', cor: '#9CA3AF' },
  { id: 'fratura', label: 'Fratura', cor: '#EA580C' },
]
const corCond = (c?: string) => CONDICOES.find((x) => x.id === c)?.cor
const TIPOS = [{ id: 'evolucao', l: 'Evolução' }, { id: 'anamnese', l: 'Anamnese' }, { id: 'observacao', l: 'Observação' }, { id: 'atestado', l: 'Atestado' }]

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

type Pac = { id: string; nome: string }
type Prof = { id: string; nome: string }
type Evo = { id: string; tipo: string; texto: string; data_atendimento: string; origem: string; assinado: boolean; profissional_nome: string | null; created_at: string }
type Odo = { dente: string; face: string | null; condicao: string; observacao: string | null }

export default function ProntuarioPage() {
  const companyId = useCompanyId()
  const [busca, setBusca] = useState(''); const [pacs, setPacs] = useState<Pac[]>([]); const [pac, setPac] = useState<Pac | null>(null)
  const [profs, setProfs] = useState<Prof[]>([])
  const [evos, setEvos] = useState<Evo[]>([]); const [odo, setOdo] = useState<Odo[]>([])
  const [texto, setTexto] = useState(''); const [tipo, setTipo] = useState('evolucao'); const [profSel, setProfSel] = useState('')
  const [salvando, setSalvando] = useState(false); const [denteSel, setDenteSel] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId || busca.length < 2) { setPacs([]); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_odonto_paciente').select('id,nome')
        .eq('company_id', companyId).eq('ativo', true).ilike('nome', `%${busca}%`).limit(8)
      if (alive) setPacs((data as Pac[]) ?? [])
    })()
    return () => { alive = false }
  }, [busca, companyId])

  useEffect(() => {
    if (!companyId) return
    supabase.from('erp_odonto_profissional').select('id,nome').eq('company_id', companyId).eq('ativo', true)
      .then(({ data }) => setProfs((data as Prof[]) ?? []))
  }, [companyId])

  const carregar = useCallback(async (p: Pac) => {
    if (!companyId) return
    const [e, o] = await Promise.all([
      supabase.rpc('fn_odonto_prontuario_paciente', { p_company_id: companyId, p_paciente_id: p.id }),
      supabase.rpc('fn_odonto_odontograma_estado', { p_company_id: companyId, p_paciente_id: p.id }),
    ])
    setEvos((e.data as Evo[]) ?? []); setOdo((o.data as Odo[]) ?? [])
  }, [companyId])

  const escolher = (p: Pac) => { setPac(p); setPacs([]); setBusca(''); setDenteSel(null); carregar(p) }

  // estado por dente (último vence — a RPC já retorna DISTINCT ON mais recente)
  const condDoDente = useMemo(() => {
    const m: Record<string, string> = {}
    odo.forEach((o) => { if (!(o.dente in m)) m[o.dente] = o.condicao })
    return m
  }, [odo])

  const marcar = async (dente: string, condicao: string) => {
    if (!companyId || !pac) return
    const { data, error } = await supabase.rpc('fn_odonto_odontograma_marcar', {
      p_company_id: companyId, p_paciente_id: pac.id, p_dente: dente, p_condicao: condicao,
    })
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setDenteSel(null); carregar(pac)
  }

  const salvarEvo = async () => {
    if (!companyId || !pac) return
    if (texto.trim().length < 3) { setMsg('Escreva a evolução.'); return }
    if (!confirm('Assinar e salvar? Depois de assinada, a evolução é IMUTÁVEL (CFO) — correção é uma nova entrada.')) return
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_odonto_prontuario_salvar', {
      p_company_id: companyId, p_paciente_id: pac.id, p_texto: texto,
      p_profissional_id: profSel || null, p_tipo: tipo, p_assinar: true,
    })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setTexto(''); setMsg('✅ Evolução assinada e registrada.'); carregar(pac)
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">Selecione uma empresa específica no topo do menu para abrir o prontuário.</div>

  if (!pac) return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Prontuário + Odontograma</div>
      <h1 className="text-2xl sm:text-3xl mt-1 mb-4" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Selecione o paciente</h1>
      <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <Search size={16} style={{ color: ESP60 }} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome…" className="flex-1 outline-none text-sm" style={{ color: ESP }} />
      </div>
      <div className="mt-2">
        {pacs.map((p) => (
          <button key={p.id} onClick={() => escolher(p)} className="w-full text-left px-3 py-2.5 rounded-xl mb-1" style={{ background: '#fff', border: `1px solid ${LINE}` }}>{p.nome}</button>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6 max-w-3xl mx-auto">
      <button onClick={() => setPac(null)} className="text-sm inline-flex items-center gap-1 mb-2" style={{ color: ESP60 }}><ChevronLeft size={16} /> trocar paciente</button>
      <h1 className="text-2xl font-semibold" style={{ fontFamily: 'ui-serif,Georgia,serif' }}>{pac.nome}</h1>
      {msg && <div className="mt-2 text-sm rounded-lg px-3 py-2" style={{ background: '#fff', border: `1px solid ${LINE}` }}>{msg}</div>}

      {/* ODONTOGRAMA CLÍNICO */}
      <div className="mt-4 rounded-2xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-xs font-semibold mb-2" style={{ color: ESP60 }}>Odontograma clínico · toque num dente para registrar a condição</div>
        {[TOP, BOTTOM].map((arc, ai) => (
          <div key={ai} className="flex gap-1 justify-center mb-1 overflow-x-auto">
            {arc.map((d) => {
              const k = String(d); const cor = corCond(condDoDente[k])
              const on = denteSel === k
              return (
                <button key={d} onClick={() => setDenteSel(on ? null : k)} title={`Dente ${d}${condDoDente[k] ? ' · ' + condDoDente[k] : ''}`}
                  style={{ width: 26, height: 34, flexShrink: 0, borderRadius: 6, fontSize: 10, fontWeight: 600,
                    background: cor && cor !== '#FFFFFF' ? cor : '#fff',
                    color: cor && cor !== '#FFFFFF' ? '#fff' : ESP,
                    border: on ? `2px solid ${ESP}` : `1px solid ${LINE}` }}>{d}</button>
              )
            })}
          </div>
        ))}
        <div className="flex flex-wrap gap-2 mt-2 justify-center">
          {CONDICOES.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 text-[11px]" style={{ color: ESP60 }}>
              <span className="w-3 h-3 rounded-sm" style={{ background: c.cor, border: `1px solid ${LINE}` }} />{c.label}
            </span>
          ))}
        </div>
        {denteSel && (
          <div className="mt-3 rounded-xl p-2" style={{ background: BG, border: `1px solid ${LINE}` }}>
            <div className="text-xs font-semibold mb-2">Dente {denteSel} → registrar condição:</div>
            <div className="flex flex-wrap gap-2">
              {CONDICOES.map((c) => (
                <button key={c.id} onClick={() => marcar(denteSel, c.id)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: c.cor, border: `1px solid ${LINE}` }} />{c.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* NOVA EVOLUÇÃO */}
      <div className="mt-4 rounded-2xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="flex items-center gap-2 mb-2">
          <Stethoscope size={15} style={{ color: GOLD }} /><span className="text-sm font-semibold">Nova evolução</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mb-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-xl px-3 py-2 text-sm bg-white outline-none" style={{ border: `1px solid ${LINE}`, color: ESP }}>
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.l}</option>)}
          </select>
          <select value={profSel} onChange={(e) => setProfSel(e.target.value)} className="flex-1 rounded-xl px-3 py-2 text-sm bg-white outline-none" style={{ border: `1px solid ${LINE}`, color: ESP }}>
            <option value="">Profissional (opcional)…</option>
            {profs.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="Descreva o atendimento / anamnese…" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ border: `1px solid ${LINE}`, color: ESP }} />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] inline-flex items-center gap-1" style={{ color: ESP60 }}><Lock size={11} /> Assinada = imutável (CFO)</span>
          <button onClick={salvarEvo} disabled={salvando} className="px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1" style={{ background: GOLD, color: '#fff' }}>
            <Plus size={15} /> {salvando ? 'Salvando…' : 'Assinar e salvar'}
          </button>
        </div>
      </div>

      {/* HISTÓRICO IMUTÁVEL */}
      <div className="mt-4">
        <div className="text-sm font-semibold mb-2">Histórico clínico</div>
        {evos.length === 0 && <div className="rounded-xl p-6 text-center text-sm" style={{ border: `1px dashed ${LINE}`, color: ESP60 }}>Sem evoluções ainda.</div>}
        {evos.map((e) => (
          <div key={e.id} className="rounded-xl p-3 mb-2" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: ESP60 }}>
              <b style={{ color: ESP }}>{new Date(e.data_atendimento + 'T00:00:00').toLocaleDateString('pt-BR')}</b>
              <span className="px-2 py-0.5 rounded-full" style={{ background: BG }}>{TIPOS.find((t) => t.id === e.tipo)?.l ?? e.tipo}</span>
              {e.profissional_nome && <span>· {e.profissional_nome}</span>}
              {e.origem === 'scribe_ia' && <span className="px-2 py-0.5 rounded-full" style={{ background: '#EDE9FE', color: '#6D28D9' }}>IA</span>}
              {e.assinado && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: '#DCFCE7', color: '#166534' }}><Lock size={9} /> assinada</span>}
            </div>
            <div className="text-sm mt-1 whitespace-pre-wrap">{e.texto}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
