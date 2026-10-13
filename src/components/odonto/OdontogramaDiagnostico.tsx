'use client'
// OD-3 · Odontograma em modo DIAGNÓSTICO (marca condição clínica por dente/face). Reusa o SVG
// Odontograma do OD-2 (RD-26) + o backend existente (fn_odonto_odontograma_estado / _marcar). É o que
// a tela /prontuario fazia — agora na Ficha. O modo PLANO (procedimento + valor) vive na aba Tratamentos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, TOK } from './ui'
import { Odontograma, type Face } from './Odontograma'
import { BUCKET_ODONTO_IMG, type ImagemOdonto } from './ImagensFicha'

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
  const [imgs, setImgs] = useState<ImagemOdonto[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [deciduos, setDeciduos] = useState(false)
  const [alvo, setAlvo] = useState<{ dente: string; face: Face | null } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [{ data: est }, { data: ims }] = await Promise.all([
      supabase.rpc('fn_odonto_odontograma_estado', { p_company_id: companyId, p_paciente_id: pacienteId }),
      supabase.rpc('fn_odonto_imagem_paciente', { p_company_id: companyId, p_paciente_id: pacienteId }),
    ])
    setEstado((est as Estado[]) ?? [])
    setImgs((ims as ImagemOdonto[]) ?? [])
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // imagem por dente (OD-5): badge de contagem + miniaturas ao selecionar o dente
  const imgCount = useMemo(() => { const m: Record<string, number> = {}; for (const i of imgs) if (i.dente_fdi) m[i.dente_fdi] = (m[i.dente_fdi] ?? 0) + 1; return m }, [imgs])
  const alvoImgs = useMemo(() => alvo ? imgs.filter((i) => i.dente_fdi === alvo.dente) : [], [alvo, imgs])
  useEffect(() => {
    const paths = alvoImgs.filter((i) => (i.mime ?? '').startsWith('image/')).map((i) => i.arquivo_path)
    if (!paths.length) return
    let alive = true
    void supabase.storage.from(BUCKET_ODONTO_IMG).createSignedUrls(paths, 3600).then(({ data }) => {
      if (!alive) return
      const m: Record<string, string> = {}; for (const s of (data ?? [])) { if (s.signedUrl && s.path) m[s.path] = s.signedUrl }
      setThumbs((prev) => ({ ...prev, ...m }))
    })
    return () => { alive = false }
  }, [alvoImgs])

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
      <Odontograma deciduos={deciduos} onToggleDecidua={setDeciduos} cor={cor} corDente={corDente} selecionados={new Set()} badge={(d) => imgCount[d] ?? 0}
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
          {alvoImgs.length > 0 && (
            <div style={{ marginTop: 10, borderTop: `0.5px solid ${TOK.line}`, paddingTop: 8 }}>
              <div style={{ fontSize: 11, color: TOK.mut, marginBottom: 6 }}>🖼 {alvoImgs.length} imagem(ns) neste dente — toque para abrir:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {alvoImgs.map((i) => thumbs[i.arquivo_path]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img key={i.id} src={thumbs[i.arquivo_path]} alt={i.arquivo_nome} onClick={() => window.open(thumbs[i.arquivo_path], '_blank', 'noopener')} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', border: `0.5px solid ${TOK.line}` }} />
                  : <span key={i.id} style={{ fontSize: 11, color: TOK.mut, alignSelf: 'center' }}>{i.arquivo_nome}</span>)}
              </div>
            </div>
          )}
        </CardOdonto>
      )}
    </div>
  )
}
