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
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none' }
const COMBS = ['gasolina', 'etanol', 'flex', 'diesel', 'gnv', 'elétrico', 'híbrido']

type Modelo = { id: string; marca: string; modelo: string; versao: string | null; combustivel: string | null; potencia_cv: number | null; cilindradas: number | null; portas: number | null; cambio: string | null }
type Row = {
  id: string; marca: string | null; modelo: string | null; chassi: string; cor: string | null
  combustivel: string | null; potencia_cv: number | null; cilindradas: number | null
  ano_fabricacao: number | null; ano_modelo: number | null; valor_aquisicao: number | null
  // R7b-2: identificação/documento editáveis em lista + indicador de CRLV
  tipo: string | null; placa: string | null; renavam: string | null; portas: number | null; crlv_storage_path: string | null
  ncm: string | null; lugares: number | null
  fiscais_faltantes: string[]; sugestao_ano_chassi: number | null
}
const TIPOS: Array<{ v: string; lbl: string }> = [
  { v: 'carro', lbl: 'Carro' }, { v: 'moto', lbl: 'Moto' }, { v: 'caminhao', lbl: 'Caminhão' }, { v: 'maquina', lbl: 'Máquina' },
]
// campos de identificação/documento que o R7b-2 ajuda a completar (além dos fiscais do pátio)
function faltamDadosVeiculo(r: Pick<Row, 'tipo' | 'placa' | 'renavam' | 'cor' | 'portas' | 'crlv_storage_path'>): string[] {
  const f: string[] = []
  if (!r.tipo) f.push('tipo')
  if (!r.placa) f.push('placa')
  if (!r.renavam) f.push('Renavam')
  if (!r.cor) f.push('cor')
  if (r.portas == null) f.push('portas')
  if (!r.crlv_storage_path) f.push('CRLV')
  return f
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
  // B2 · NCM sugerido por veículo (fonte única fn_veic_ncm_sugerido) + aplicar em lote.
  const [ncmSug, setNcmSug] = useState<Record<string, string>>({})
  const [loteBusy, setLoteBusy] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); setModelos([]); return }
    // dados editáveis de veic_veiculo + completude (fiscais_faltantes/sugestão) da mesma regra do pátio
    const [vv, pat, ml] = await Promise.all([
      supabase.from('veic_veiculo').select('id,marca,modelo,chassi,cor,combustivel,potencia_cv,cilindradas,ano_fabricacao,ano_modelo,valor_aquisicao,tipo,placa,renavam,portas,crlv_storage_path,ncm,lugares').eq('company_id', companyId).is('deleted_at', null),
      supabase.from('v_veic_patio').select('id,fiscais_faltantes,sugestao_ano_chassi').eq('company_id', companyId),
      supabase.rpc('fn_veic_modelo_listar', { p_company_id: companyId }),
    ])
    if (vv.error) { setErro(vv.error.message); return }
    const patMap = new Map<string, { fiscais_faltantes: string[]; sugestao_ano_chassi: number | null }>()
    ;((pat.data as { id: string; fiscais_faltantes: string[] | null; sugestao_ano_chassi: number | null }[]) ?? []).forEach((p) => patMap.set(p.id, { fiscais_faltantes: p.fiscais_faltantes ?? [], sugestao_ano_chassi: p.sugestao_ano_chassi }))
    const lista: Row[] = ((vv.data as Omit<Row, 'fiscais_faltantes' | 'sugestao_ano_chassi'>[]) ?? []).map((v) => ({
      ...v, fiscais_faltantes: patMap.get(v.id)?.fiscais_faltantes ?? [], sugestao_ano_chassi: patMap.get(v.id)?.sugestao_ano_chassi ?? null,
    })).filter((v) => v.fiscais_faltantes.length > 0 || faltamDadosVeiculo(v).length > 0)
      .sort((a, b) => (a.marca || '').localeCompare(b.marca || '') || (a.modelo || '').localeCompare(b.modelo || ''))
    setRows(lista)
    const mr = ml.data as { ok?: boolean; modelos?: Modelo[] } | null
    setModelos(mr?.modelos ?? [])
    // B2 · NCM sugerido (do tipo/combustível/cilindradas/lugares) por veículo
    const sug: Record<string, string> = {}
    await Promise.all(lista.map(async (v) => {
      const { data: n } = await supabase.rpc('fn_veic_ncm_sugerido', { p_tipo: v.tipo, p_combustivel: v.combustivel, p_cilindradas: v.cilindradas, p_lugares: v.lugares })
      if (typeof n === 'string' && n) sug[v.id] = n
    }))
    setNcmSug(sug)
  }, [companyId])

  async function aplicarNcmLote() {
    const alvos = rows.filter((r) => !r.ncm && ncmSug[r.id])
    if (!alvos.length) { setMsg('Nenhum veículo sem NCM com sugestão disponível.'); return }
    setLoteBusy(true)
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
    let ok = 0
    for (const r of alvos) {
      const { data } = await supabase.rpc('fn_veic_atualizar_dados', { p_veiculo_id: r.id, p_dados: { ncm: ncmSug[r.id] }, p_user: user?.id ?? null })
      if ((data as { ok?: boolean } | null)?.ok) ok++
    }
    setLoteBusy(false); setMsg(`NCM sugerido aplicado em ${ok} de ${alvos.length} veículo(s).`); void carregar()
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function uid() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

  async function aplicarModelo(m: Modelo) {
    const { data, error } = await supabase.rpc('fn_veic_modelo_aplicar', { p_company_id: companyId, p_modelo_id: m.id, p_veiculo_ids: null, p_user: await uid() })
    const r = data as { ok?: boolean; erro?: string; atualizados?: number } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha'); return }
    setMsg(`${m.marca} ${m.modelo}: ${r.atualizados ?? 0} veículo(s) preenchido(s) pelo modelo.`); void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1180, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar ao pátio</a>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Completar em lista <span style={{ color: C.espM, fontWeight: 400 }}>· {rows.length} veículo(s) com dados faltando</span></div>
          {rows.some((r) => !r.ncm && ncmSug[r.id]) && (
            <button disabled={loteBusy} onClick={() => void aplicarNcmLote()} title="Preenche o NCM sugerido (do tipo/combustível/cilindradas) em todos os veículos sem NCM"
              style={{ marginLeft: 'auto', border: `1px solid ${C.gold}`, background: loteBusy ? C.cream : C.white, color: C.gold, borderRadius: 8, padding: '5px 12px', cursor: loteBusy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700 }}>
              {loteBusy ? 'aplicando…' : `aplicar NCM sugerido em lote (${rows.filter((r) => !r.ncm && ncmSug[r.id]).length})`}
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: C.green, padding: '12px 0' }}>✓ Todos os veículos do pátio têm os dados do veículo preenchidos.</div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <div style={{ minWidth: 900, display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '190px 110px 90px 90px 80px 80px 120px 90px', gap: 6, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, padding: '4px 0' }}>
                <span>veículo</span><span>combustível</span><span>potência</span><span>cilindr.</span><span>ano fab</span><span>ano mod</span><span>aquisição</span><span></span>
              </div>
              {rows.map((r) => <LinhaLote key={r.id} r={r} companyId={companyId} ncmSugerido={ncmSug[r.id] ?? null} onSaved={() => { setMsg('Veículo atualizado.'); void carregar() }} onErro={setErro} />)}
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
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
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

// R7b-2: um campo rotulado compacto (label em cima, input embaixo) — usado na linha de identificação/doc.
function Campo({ label, children, w }: { label: string; children: React.ReactNode; w?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, width: w }}>
      <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espL }}>{label}</span>
      {children}
    </label>
  )
}

// R7b-2 parte b · sugestão da IA lida do CRLV (o que a rota /api/revenda/crlv-ler devolve).
type SugestaoCrlv = {
  placa: string | null; renavam: string | null; chassi: string | null
  marca: string | null; modelo: string | null; cor: string | null
  ano_fabricacao: number | null; ano_modelo: number | null; combustivel: string | null
  confianca: string; observacao: string
}

function LinhaLote({ r, companyId, ncmSugerido, onSaved, onErro }: { r: Row; companyId: string; ncmSugerido: string | null; onSaved: () => void; onErro: (m: string) => void }) {
  const num = (n: number | null) => (n == null ? '' : String(n))
  const [f, setF] = useState({
    // R7b-2 · identificação/documento
    tipo: r.tipo ?? '', placa: r.placa ?? '', renavam: r.renavam ?? '', chassi: r.chassi ?? '', cor: r.cor ?? '', portas: num(r.portas),
    // técnicos (já existiam)
    combustivel: r.combustivel ?? '', potencia_cv: num(r.potencia_cv), cilindradas: num(r.cilindradas), ano_fabricacao: num(r.ano_fabricacao), ano_modelo: num(r.ano_modelo), valor_aquisicao: num(r.valor_aquisicao),
    // B2 · NCM (classificação fiscal) — sugerido pela fn_veic_ncm_sugerido, editável
    ncm: r.ncm ?? '',
  })
  const [busy, setBusy] = useState(false)
  // R7b-2 parte b · leitura ASSISTIDA do CRLV — a IA sugere, a pessoa confere e aplica; nada grava sozinho.
  const [lendo, setLendo] = useState(false)
  const [sug, setSug] = useState<SugestaoCrlv | null>(null)
  // T5 (juiz) · "confira e salve": os campos preenchidos pela IA ficam DESTACADOS até salvar.
  const [iaFields, setIaFields] = useState<Set<string>>(new Set())
  const hi = (k: string): React.CSSProperties => iaFields.has(k) ? { borderColor: C.gold, boxShadow: `0 0 0 2px ${C.gold}22` } : {}
  // B2 · mini-visualizador do CRLV — URL assinada do bucket privado, aberta sob demanda.
  const [crlvUrl, setCrlvUrl] = useState<string | null>(null)
  const [vendoCrlv, setVendoCrlv] = useState(false)
  const temCrlv = !!r.crlv_storage_path
  const faltam = [...r.fiscais_faltantes, ...faltamDadosVeiculo(r)]

  async function verCrlv() {
    if (crlvUrl) { setVendoCrlv((v) => !v); return }
    if (!r.crlv_storage_path) return
    const { data } = await supabase.storage.from('revenda-veiculos').createSignedUrl(r.crlv_storage_path, 3600)
    if (data?.signedUrl) { setCrlvUrl(data.signedUrl); setVendoCrlv(true) }
    else onErro('Não foi possível abrir o CRLV.')
  }

  async function lerCrlv() {
    setLendo(true); setSug(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { onErro('Sessão expirada — entre novamente.'); return }
      const res = await fetch('/api/revenda/crlv-ler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, veiculoId: r.id }),
      })
      const j = await res.json().catch(() => null) as { ok?: boolean; sugestao?: SugestaoCrlv; ia_desativada?: boolean; budget_pausado?: boolean; aviso?: string; erro?: string } | null
      if (j?.ia_desativada || j?.budget_pausado) { onErro(j.aviso || 'Leitura por IA indisponível agora.'); return }
      if (!res.ok || !j?.ok || !j.sugestao) { onErro(j?.erro || 'Não foi possível ler o CRLV.'); return }
      setSug(j.sugestao)
    } catch { onErro('Falha ao ler o CRLV.') }
    finally { setLendo(false) }
  }

  // aplica a sugestão da IA aos campos do formulário (só os que têm input aqui) — a pessoa ainda clica "salvar".
  function aplicarSugestao(s: SugestaoCrlv) {
    const preenchidos = new Set<string>()
    const marca = (k: string, v: unknown) => { if (v != null && v !== '') preenchidos.add(k) }
    marca('placa', s.placa); marca('renavam', s.renavam); marca('chassi', s.chassi); marca('cor', s.cor)
    marca('ano_fabricacao', s.ano_fabricacao); marca('ano_modelo', s.ano_modelo)
    if (s.combustivel && COMBS.includes(s.combustivel)) preenchidos.add('combustivel')
    setF((prev) => ({
      ...prev,
      placa: s.placa ?? prev.placa,
      renavam: s.renavam ?? prev.renavam,
      chassi: s.chassi ?? prev.chassi,
      cor: s.cor ?? prev.cor,
      combustivel: s.combustivel && COMBS.includes(s.combustivel) ? s.combustivel : prev.combustivel,
      ano_fabricacao: s.ano_fabricacao != null ? String(s.ano_fabricacao) : prev.ano_fabricacao,
      ano_modelo: s.ano_modelo != null ? String(s.ano_modelo) : prev.ano_modelo,
    }))
    setIaFields(preenchidos) // destaca até salvar (etapa "confira e salve")
  }
  async function salvar() {
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
    const { data, error } = await supabase.rpc('fn_veic_atualizar_dados', { p_veiculo_id: r.id, p_dados: f, p_user: user?.id ?? null })
    setBusy(false)
    const rr = data as { ok?: boolean; erro?: string } | null
    if (error || !rr?.ok) {
      const e = rr?.erro
      onErro(e === 'tipo_invalido' ? 'Tipo inválido.' : e === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (error?.message || e || 'Falha'))
      return
    }
    setIaFields(new Set()) // salvou → o destaque "confira e salve" sai
    onSaved()
  }
  // T5 (juiz) · quando a fn não sugere NCM, dizer O QUE falta (em vez de campo vazio). A fn exige
  // tipo (moto exige cilindradas; lugares assume 5). Lista os campos vazios que ajudam a sugerir.
  const ncmFaltam = [!f.tipo && 'tipo', !f.combustivel && 'combustível', !f.cilindradas && 'cilindradas'].filter(Boolean) as string[]
  return (
    <div style={{ borderTop: `1px solid ${C.cream}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* cabeçalho da linha: veículo + o que falta + CRLV */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5 }}>{r.marca || '—'} {r.modelo || ''}</b>
        <span style={{ fontSize: 10, color: C.espL, fontFamily: 'monospace' }}>chassi …{(r.chassi || '').slice(-6)}</span>
        <span title={temCrlv ? 'CRLV anexado' : 'CRLV não anexado — anexe na ficha'}
          style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${temCrlv ? C.green : C.amber}`, color: temCrlv ? C.green : C.amber, background: temCrlv ? C.greenBg : C.amberBg }}>
          {temCrlv ? '📄 CRLV ok' : '📄 CRLV faltando'}
        </span>
        {!temCrlv && <a href={`/dashboard/revenda/veiculo/${r.id}`} style={{ fontSize: 11, color: C.gold, textDecoration: 'none' }}>anexar CRLV na ficha →</a>}
        {temCrlv && (
          <button onClick={() => void verCrlv()} title="Abrir o CRLV anexado sem sair da lista"
            style={{ border: `1px solid ${C.espL}`, background: vendoCrlv ? C.cream : C.white, color: C.espM, borderRadius: 999, padding: '3px 11px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
            {vendoCrlv ? 'ocultar CRLV' : '👁 ver CRLV'}
          </button>
        )}
        {temCrlv && (
          <button disabled={lendo} onClick={() => void lerCrlv()} title="A IA lê o CRLV e sugere os campos — você confere e aplica"
            style={{ border: `1px solid ${C.gold}`, background: lendo ? C.cream : C.white, color: C.gold, borderRadius: 999, padding: '3px 11px', cursor: lendo ? 'wait' : 'pointer', fontSize: 11, fontWeight: 700 }}>
            {lendo ? '🤖 lendo…' : '🤖 Ler CRLV (IA)'}
          </button>
        )}
        {faltam.length > 0 && <span style={{ fontSize: 10.5, color: C.espM }}>falta: {faltam.join(', ')}</span>}
      </div>

      {/* B2 · mini-visualizador do CRLV — URL assinada do bucket privado, embutida na própria lista */}
      {vendoCrlv && crlvUrl && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.cream }}>
          <iframe src={crlvUrl} title={`CRLV ${r.marca ?? ''} ${r.modelo ?? ''}`} style={{ width: '100%', height: 360, border: 'none', background: C.white }} />
          <div style={{ padding: '5px 10px', fontSize: 10.5, color: C.espM, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span>CRLV anexado · link temporário</span>
            <a href={crlvUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.gold, textDecoration: 'none' }}>abrir em nova aba →</a>
          </div>
        </div>
      )}

      {/* R7b-2 parte b · painel de sugestão da IA — a pessoa confere e aplica; a IA não grava nada */}
      {sug && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '9px 11px', fontSize: 11.5, color: C.esp }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <b style={{ fontSize: 12 }}>Sugestão da IA (confira antes de salvar)</b>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, border: `1px solid ${sug.confianca === 'alta' ? C.green : sug.confianca === 'media' ? C.amber : C.red}`, color: sug.confianca === 'alta' ? C.green : sug.confianca === 'media' ? C.amber : C.red }}>
              confiança {sug.confianca}
            </span>
            <button onClick={() => aplicarSugestao(sug)} style={{ border: 'none', borderRadius: 7, background: C.gold, color: C.white, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>aplicar aos campos</button>
            <button onClick={() => setSug(null)} style={{ border: `1px solid ${C.border}`, background: C.white, color: C.espM, borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>descartar</button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: C.espM }}>
            {([['placa', sug.placa], ['Renavam', sug.renavam], ['chassi', sug.chassi], ['marca', sug.marca], ['modelo', sug.modelo], ['cor', sug.cor], ['ano fab', sug.ano_fabricacao], ['ano mod', sug.ano_modelo], ['combustível', sug.combustivel]] as Array<[string, string | number | null]>).map(([lbl, val]) => (
              <span key={lbl}>{lbl}: <b style={{ color: val == null || val === '' ? C.espL : C.esp }}>{val == null || val === '' ? '—' : String(val)}</b></span>
            ))}
          </div>
          {sug.observacao && <div style={{ marginTop: 5, fontSize: 10.5, color: C.espM, fontStyle: 'italic' }}>obs.: {sug.observacao}</div>}
          <div style={{ marginTop: 5, fontSize: 10, color: C.espL }}>marca/modelo vêm do catálogo de modelos — a IA só ajuda a conferir; ajuste os campos e clique em salvar.</div>
        </div>
      )}

      {/* T5 · etapa "confira e salve" visível: enquanto houver campos preenchidos pela IA, avisa e destaca */}
      {iaFields.size > 0 && (
        <div style={{ background: '#FDF7E8', border: `1px solid ${C.gold}`, borderRadius: 8, padding: '7px 11px', fontSize: 11.5, color: '#8A4B08', fontWeight: 600 }}>
          ✏️ Confira os campos <b>destacados em dourado</b> (preenchidos pela IA) e clique em <b>salvar</b>.
        </div>
      )}

      {/* linha 1 · identificação e documento (R7b-2) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Campo label="tipo" w={110}>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} style={inp}>
            <option value="">—</option>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.lbl}</option>)}
          </select>
        </Campo>
        <Campo label="placa" w={100}><input value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} placeholder="ABC1D23" style={{ ...inp, ...hi('placa') }} /></Campo>
        <Campo label="Renavam" w={120}><input value={f.renavam} onChange={(e) => setF({ ...f, renavam: e.target.value.replace(/\D/g, '') })} placeholder="00000000000" style={{ ...inp, ...hi('renavam') }} /></Campo>
        <Campo label="chassi" w={180}><input value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value.toUpperCase() })} placeholder="chassi" style={{ ...inp, ...hi('chassi') }} /></Campo>
        <Campo label="cor" w={100}><input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} placeholder="cor" style={{ ...inp, ...hi('cor') }} /></Campo>
        <Campo label="portas" w={70}><input value={f.portas} onChange={(e) => setF({ ...f, portas: e.target.value.replace(/\D/g, '') })} placeholder="4" style={inp} /></Campo>
        {/* B2 · NCM (classificação fiscal) — a fn_veic_ncm_sugerido sugere pelo tipo/combustível/cilindradas; a pessoa aplica */}
        <Campo label="NCM" w={ncmSugerido ? 130 : 190}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input value={f.ncm} onChange={(e) => setF({ ...f, ncm: e.target.value.replace(/\D/g, '') })} placeholder={ncmSugerido ?? 'NCM'} style={{ ...inp, width: 88 }} />
            {ncmSugerido && f.ncm !== ncmSugerido && (
              <button title={`sugerido pela classificação fiscal: ${ncmSugerido}`} onClick={() => setF({ ...f, ncm: ncmSugerido })}
                style={{ border: `1px solid ${C.amber}`, background: C.white, color: C.amber, borderRadius: 6, padding: '7px 6px', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>💡{ncmSugerido}</button>
            )}
            {/* T5 · sem sugestão: dizer O QUE informar, em vez de campo vazio */}
            {!ncmSugerido && !f.ncm && (
              <span style={{ fontSize: 9.5, color: C.espM, lineHeight: 1.2 }}>
                {ncmFaltam.length > 0 ? `para sugerir, informe: ${ncmFaltam.join(', ')}` : 'sem faixa de NCM para esta combinação'}
              </span>
            )}
          </div>
        </Campo>
      </div>

      {/* linha 2 · técnicos (existiam) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Campo label="combustível" w={120}>
          <select value={f.combustivel} onChange={(e) => setF({ ...f, combustivel: e.target.value })} style={{ ...inp, ...hi('combustivel') }}>
            <option value="">—</option>{COMBS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        <Campo label="potência" w={80}><input value={f.potencia_cv} onChange={(e) => setF({ ...f, potencia_cv: e.target.value })} placeholder="cv" style={inp} /></Campo>
        <Campo label="cilindr." w={80}><input value={f.cilindradas} onChange={(e) => setF({ ...f, cilindradas: e.target.value })} placeholder="cc" style={inp} /></Campo>
        <Campo label="ano fab" w={80}><input value={f.ano_fabricacao} onChange={(e) => setF({ ...f, ano_fabricacao: e.target.value })} placeholder={r.sugestao_ano_chassi ? `${r.sugestao_ano_chassi}?` : 'ano'} style={{ ...inp, ...hi('ano_fabricacao') }} /></Campo>
        <Campo label="ano mod" w={80}><input value={f.ano_modelo} onChange={(e) => setF({ ...f, ano_modelo: e.target.value })} placeholder={r.sugestao_ano_chassi ? `${r.sugestao_ano_chassi}?` : 'ano'} style={{ ...inp, ...hi('ano_modelo') }} /></Campo>
        <Campo label="aquisição" w={110}><input value={f.valor_aquisicao} onChange={(e) => setF({ ...f, valor_aquisicao: e.target.value })} placeholder="R$" style={inp} /></Campo>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {r.sugestao_ano_chassi != null && (!f.ano_modelo || !f.ano_fabricacao) && (
            <button title={`sugestão pelo chassi: ${r.sugestao_ano_chassi}`} onClick={() => setF({ ...f, ano_modelo: f.ano_modelo || String(r.sugestao_ano_chassi), ano_fabricacao: f.ano_fabricacao || String(r.sugestao_ano_chassi) })}
              style={{ border: `1px solid ${C.amber}`, background: C.white, color: C.amber, borderRadius: 6, padding: '7px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>💡{r.sugestao_ano_chassi}</button>
          )}
          <button disabled={busy} onClick={() => void salvar()} style={{ border: 'none', borderRadius: 7, background: busy ? C.espL : C.gold, color: C.white, padding: '8px 14px', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>{busy ? '…' : 'salvar'}</button>
        </div>
      </div>
    </div>
  )
}
