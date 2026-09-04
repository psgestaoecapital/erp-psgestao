'use client'

// Revenda · Onda 3B parte 1 — tela Completar (SPEC do Engenheiro Chefe 04/09/2026).
// Transforma "completar 13 fichas" em minutos: (A) catálogo de modelos por empresa — o 2º Corolla
// herda do 1º; (B) lista dos veículos com dados faltando, editável em linha, sem abrir ficha por ficha.
// Selo honesto: nomeia o que falta, nunca afirma "não emite" (veicProd é do 0km; usado é do contador).

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none' }
const COMBS = ['gasolina', 'etanol', 'flex', 'diesel', 'gnv', 'elétrico', 'híbrido']

type Modelo = { id: string; marca: string; modelo: string; versao: string | null; combustivel: string | null; potencia_cv: number | null; cilindradas: number | null; portas: number | null; cambio: string | null }
type Row = {
  id: string; marca: string | null; modelo: string | null; chassi: string; cor: string | null
  combustivel: string | null; potencia_cv: number | null; cilindradas: number | null
  ano_fabricacao: number | null; ano_modelo: number | null; valor_aquisicao: number | null
  fiscais_faltantes: string[]; sugestao_ano_chassi: number | null
}

export default function CompletarPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Row[]>([])
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); setModelos([]); return }
    // dados editáveis de veic_veiculo + completude (fiscais_faltantes/sugestão) da mesma regra do pátio
    const [vv, pat, ml] = await Promise.all([
      supabase.from('veic_veiculo').select('id,marca,modelo,chassi,cor,combustivel,potencia_cv,cilindradas,ano_fabricacao,ano_modelo,valor_aquisicao').eq('company_id', companyId).is('deleted_at', null),
      supabase.from('v_veic_patio').select('id,fiscais_faltantes,sugestao_ano_chassi').eq('company_id', companyId),
      supabase.rpc('fn_veic_modelo_listar', { p_company_id: companyId }),
    ])
    if (vv.error) { setErro(vv.error.message); return }
    const patMap = new Map<string, { fiscais_faltantes: string[]; sugestao_ano_chassi: number | null }>()
    ;((pat.data as { id: string; fiscais_faltantes: string[] | null; sugestao_ano_chassi: number | null }[]) ?? []).forEach((p) => patMap.set(p.id, { fiscais_faltantes: p.fiscais_faltantes ?? [], sugestao_ano_chassi: p.sugestao_ano_chassi }))
    const lista: Row[] = ((vv.data as Omit<Row, 'fiscais_faltantes' | 'sugestao_ano_chassi'>[]) ?? []).map((v) => ({
      ...v, fiscais_faltantes: patMap.get(v.id)?.fiscais_faltantes ?? [], sugestao_ano_chassi: patMap.get(v.id)?.sugestao_ano_chassi ?? null,
    })).filter((v) => v.fiscais_faltantes.length > 0)
      .sort((a, b) => (a.marca || '').localeCompare(b.marca || '') || (a.modelo || '').localeCompare(b.modelo || ''))
    setRows(lista)
    const mr = ml.data as { ok?: boolean; modelos?: Modelo[] } | null
    setModelos(mr?.modelos ?? [])
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function uid() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }

  async function aplicarModelo(m: Modelo) {
    const { data, error } = await supabase.rpc('fn_veic_modelo_aplicar', { p_company_id: companyId, p_modelo_id: m.id, p_veiculo_ids: null, p_user: await uid() })
    const r = data as { ok?: boolean; erro?: string; atualizados?: number } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg(`${m.marca} ${m.modelo}: ${r.atualizados ?? 0} veículo(s) preenchido(s) pelo modelo.`); void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1180, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>← voltar ao pátio</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>Completar dados dos veículos</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '0 0 14px' }}>Nomeia o que falta — não trava. Cadastre um modelo uma vez e aplique a todos iguais; ou complete em lista, sem abrir ficha por ficha.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setErro(null)}>{erro}</div>}

      {/* A · Catálogo de modelos */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Catálogo de modelos</div>
        <NovoModelo companyId={companyId} onSaved={() => { setMsg('Modelo salvo.'); void carregar() }} onErro={setErro} />
        {modelos.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', marginTop: 8 }}>Nenhum modelo ainda. Combustível, potência e cilindradas são do modelo — cadastre uma vez, o próximo igual herda.</div> : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {modelos.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, borderTop: `1px solid ${C.cream}`, padding: '7px 0', flexWrap: 'wrap' }}>
                <b style={{ minWidth: 200 }}>{m.marca} {m.modelo} {m.versao ? `· ${m.versao}` : ''}</b>
                <span style={{ color: C.espM }}>{[m.combustivel, m.potencia_cv ? `${m.potencia_cv}cv` : null, m.cilindradas ? `${m.cilindradas}` : null, m.cambio].filter(Boolean).join(' · ') || '—'}</span>
                <button onClick={() => void aplicarModelo(m)} style={{ marginLeft: 'auto', border: `1px solid ${C.gold}`, background: C.white, color: C.gold, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>aplicar aos {m.marca} {m.modelo}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* B · Completar em lista */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Completar em lista <span style={{ color: C.espM, fontWeight: 400 }}>· {rows.length} veículo(s) com dados faltando</span></div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: C.green, padding: '12px 0' }}>✓ Todos os veículos do pátio têm os dados do veículo preenchidos.</div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <div style={{ minWidth: 900, display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '190px 110px 90px 90px 80px 80px 120px 90px', gap: 6, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, padding: '4px 0' }}>
                <span>veículo</span><span>combustível</span><span>potência</span><span>cilindr.</span><span>ano fab</span><span>ano mod</span><span>aquisição</span><span></span>
              </div>
              {rows.map((r) => <LinhaLote key={r.id} r={r} onSaved={() => { setMsg('Veículo atualizado.'); void carregar() }} onErro={setErro} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function NovoModelo({ companyId, onSaved, onErro }: { companyId: string; onSaved: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ marca: '', modelo: '', versao: '', combustivel: '', potencia_cv: '', cilindradas: '', portas: '', cambio: '' })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_modelo_salvar', { p_company_id: companyId, p_modelo: f, p_user: user?.id ?? null })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'marca_e_modelo_obrigatorios' ? 'Marca e modelo são obrigatórios.' : (error?.message || 'Falha')); return }
    setF({ marca: '', modelo: '', versao: '', combustivel: '', potencia_cv: '', cilindradas: '', portas: '', cambio: '' }); onSaved()
  }
  const F = (k: keyof typeof f, ph: string, w?: number) => <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} style={{ ...inp, width: w }} />
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {F('marca', 'marca', 120)}{F('modelo', 'modelo', 140)}{F('versao', 'versão', 110)}
      <select value={f.combustivel} onChange={(e) => setF({ ...f, combustivel: e.target.value })} style={inp}>
        <option value="">combustível…</option>{COMBS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {F('potencia_cv', 'potência cv', 90)}{F('cilindradas', 'cilindradas', 90)}{F('portas', 'portas', 65)}{F('cambio', 'câmbio', 90)}
      <button disabled={busy || !f.marca.trim() || !f.modelo.trim()} onClick={() => void salvar()} style={{ padding: '7px 14px', border: 'none', borderRadius: 7, background: (!f.marca.trim() || !f.modelo.trim() || busy) ? C.espL : C.gold, color: C.white, fontWeight: 700, cursor: (!f.marca.trim() || !f.modelo.trim() || busy) ? 'not-allowed' : 'pointer' }}>+ Modelo</button>
    </div>
  )
}

function LinhaLote({ r, onSaved, onErro }: { r: Row; onSaved: () => void; onErro: (m: string) => void }) {
  const num = (n: number | null) => (n == null ? '' : String(n))
  const [f, setF] = useState({ combustivel: r.combustivel ?? '', potencia_cv: num(r.potencia_cv), cilindradas: num(r.cilindradas), ano_fabricacao: num(r.ano_fabricacao), ano_modelo: num(r.ano_modelo), valor_aquisicao: num(r.valor_aquisicao) })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_atualizar_dados', { p_veiculo_id: r.id, p_dados: f, p_user: user?.id ?? null })
    setBusy(false)
    const rr = data as { ok?: boolean; erro?: string } | null
    if (error || !rr?.ok) { onErro(error?.message || rr?.erro || 'Falha'); return }
    onSaved()
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 110px 90px 90px 80px 80px 120px 90px', gap: 6, alignItems: 'center', borderTop: `1px solid ${C.cream}`, padding: '6px 0' }}>
      <div style={{ fontSize: 12 }}>
        <b>{r.marca || '—'} {r.modelo || ''}</b>
        <div style={{ fontSize: 10, color: C.espL, fontFamily: 'monospace' }}>{r.chassi.slice(-6)}</div>
      </div>
      <select value={f.combustivel} onChange={(e) => setF({ ...f, combustivel: e.target.value })} style={inp}>
        <option value="">—</option>{COMBS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input value={f.potencia_cv} onChange={(e) => setF({ ...f, potencia_cv: e.target.value })} placeholder="cv" style={inp} />
      <input value={f.cilindradas} onChange={(e) => setF({ ...f, cilindradas: e.target.value })} placeholder="cc" style={inp} />
      <input value={f.ano_fabricacao} onChange={(e) => setF({ ...f, ano_fabricacao: e.target.value })} placeholder={r.sugestao_ano_chassi ? `${r.sugestao_ano_chassi}?` : 'ano'} style={inp} />
      <input value={f.ano_modelo} onChange={(e) => setF({ ...f, ano_modelo: e.target.value })} placeholder={r.sugestao_ano_chassi ? `${r.sugestao_ano_chassi}?` : 'ano'} style={inp} />
      <input value={f.valor_aquisicao} onChange={(e) => setF({ ...f, valor_aquisicao: e.target.value })} placeholder="R$" style={inp} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {r.sugestao_ano_chassi != null && (!f.ano_modelo || !f.ano_fabricacao) && (
          <button title={`sugestão pelo chassi: ${r.sugestao_ano_chassi}`} onClick={() => setF({ ...f, ano_modelo: f.ano_modelo || String(r.sugestao_ano_chassi), ano_fabricacao: f.ano_fabricacao || String(r.sugestao_ano_chassi) })}
            style={{ border: `1px solid ${C.amber}`, background: C.white, color: C.amber, borderRadius: 6, padding: '5px 6px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>💡{r.sugestao_ano_chassi}</button>
        )}
        <button disabled={busy} onClick={() => void salvar()} style={{ border: 'none', borderRadius: 7, background: busy ? C.espL : C.gold, color: C.white, padding: '6px 10px', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>{busy ? '…' : 'salvar'}</button>
      </div>
    </div>
  )
}
