'use client'
// OD-3 · Odontograma em modo DIAGNÓSTICO (marca condição clínica por dente/face). Reusa o SVG
// Odontograma do OD-2 (RD-26) + o backend existente (fn_odonto_odontograma_estado / _marcar). É o que
// a tela /prontuario fazia — agora na Ficha. O modo PLANO (procedimento + valor) vive na aba Tratamentos.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, TOK } from './ui'
import { Odontograma, type Face } from './Odontograma'

type Estado = { dente: string; face: string | null; condicao: string }
const CONDICOES: { id: string; label: string; cor: string }[] = [
  { id: 'higido', label: 'Hígido', cor: '#FFFFFF' },
  { id: 'carie', label: 'Cárie', cor: '#E11D48' },
  { id: 'restauracao', label: 'Restauração', cor: '#2563EB' },
  { id: 'canal', label: 'Trat. endodôntico', cor: '#7C3AED' },
  { id: 'coroa', label: 'Coroa/prótese', cor: '#C8941A' },
  { id: 'implante', label: 'Implante', cor: '#0D9488' },
  { id: 'ausente', label: 'Ausente', cor: '#9CA3AF' },
  { id: 'fratura', label: 'Fratura', cor: '#EA580C' },
]
const corCond = (c?: string | null) => CONDICOES.find((x) => x.id === c)?.cor ?? null

export function OdontogramaDiagnostico({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [estado, setEstado] = useState<Estado[]>([])
  const [deciduos, setDeciduos] = useState(false)
  const [alvo, setAlvo] = useState<{ dente: string; face: Face | null } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_odonto_odontograma_estado', { p_company_id: companyId, p_paciente_id: pacienteId })
    setEstado((data as Estado[]) ?? [])
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const cor = useCallback((dente: string, face: Face): string | null => {
    const e = estado.find((x) => x.dente === dente && (x.face === face || x.face == null))
    return e ? corCond(e.condicao) : null
  }, [estado])
  const corDente = useCallback((dente: string): { fill: string | null; ausente: boolean } => {
    const cs = estado.filter((x) => x.dente === dente).map((x) => x.condicao)
    if (cs.includes('ausente')) return { fill: '#9CA3AF', ausente: true }
    const c = cs.find((cc) => cc !== 'higido' && corCond(cc))
    return { fill: c ? corCond(c) : null, ausente: false }
  }, [estado])

  const marcar = async (condicao: string) => {
    if (!alvo) return
    const { data, error } = await supabase.rpc('fn_odonto_odontograma_marcar', {
      p_company_id: companyId, p_paciente_id: pacienteId, p_dente: alvo.dente, p_condicao: condicao, p_face: alvo.face,
    })
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg('Falha ao marcar a condição.'); return }
    const lbl = CONDICOES.find((c) => c.id === condicao)?.label
    setAlvo(null); setMsg(`Dente ${alvo.dente}${alvo.face ? ' · face ' + alvo.face : ''}: ${lbl}`); setTimeout(() => setMsg(null), 2500); void carregar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: TOK.mut }}>Odontograma clínico · toque num dente (ou numa face) para registrar a <strong>condição</strong>. Para montar plano com valores, use a aba <strong>Tratamentos</strong>.</div>
      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}
      <Odontograma deciduos={deciduos} onToggleDecidua={setDeciduos} cor={cor} corDente={corDente} selecionados={new Set()}
        onFace={(d, f) => setAlvo({ dente: d, face: f })} onNum={(d) => setAlvo({ dente: d, face: null })} onDente={(d) => setAlvo({ dente: d, face: null })} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: TOK.mut }}>
        {CONDICOES.map((c) => <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: c.cor, border: `0.5px solid ${TOK.line}` }} />{c.label}</span>)}
      </div>
      {alvo && (
        <CardOdonto style={{ padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TOK.esp, marginBottom: 8 }}>Dente {alvo.dente}{alvo.face ? ` · face ${alvo.face}` : ''} → condição:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {CONDICOES.map((c) => (
              <button key={c.id} onClick={() => void marcar(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', border: `0.5px solid ${TOK.line}`, background: '#fff', color: TOK.esp }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: c.cor, border: `0.5px solid ${TOK.line}` }} />{c.label}
              </button>
            ))}
            <button onClick={() => setAlvo(null)} style={{ fontSize: 12, color: TOK.mut, background: 'none', border: 'none', cursor: 'pointer' }}>cancelar</button>
          </div>
        </CardOdonto>
      )}
    </div>
  )
}
