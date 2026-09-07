'use client'

// Revenda de Veículos · Onda 1 — pátio. Cartão por veículo com dias parados (semáforo pelas faixas
// da empresa), situação e custo acumulado. Filtro por situação, ordenação por dias. Novo veículo pelo
// chassi (placa opcional). Dias e custo são DERIVADOS (view v_veic_patio) — nunca coluna.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const SIT = ['em_preparacao', 'disponivel', 'reservado', 'vendido', 'entregue', 'devolvido']
const semColor = (s: string) => s === 'verde' ? { c: C.green, bg: C.greenBg } : s === 'amarelo' ? { c: C.amber, bg: C.amberBg } : { c: C.red, bg: C.redBg }

type Veic = { id: string; chassi: string; placa: string | null; modelo: string | null; ano_modelo: number | null; situacao: string; dias_patio: number; custo_acumulado: number; semaforo: string; foto_url: string | null; tem_custo: boolean; fiscais_faltantes: string[] | null; sugestao_ano_chassi: number | null }

export default function PatioPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Veic[]>([])
  const [fotoUrls, setFotoUrls] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState('todos')
  const [compl, setCompl] = useState('todos') // completude: todos | sem_custo | sem_dados | sem_vistoria
  const [comVistoria, setComVistoria] = useState<Set<string>>(new Set()) // Onda 5B: ids com vistoria (não cancelada)
  const [precificados, setPrecificados] = useState<Set<string>>(new Set()) // Onda 6A: ids com preco_venda definido
  const [emPreparacao, setEmPreparacao] = useState<Set<string>>(new Set()) // Onda 9: ids com OS de preparação aberta
  const [interessados, setInteressados] = useState<Map<string, number>>(new Map()) // Onda 10: veiculo -> nº de oportunidades abertas
  const [resumoFiscal, setResumoFiscal] = useState<{ total: number; aptos: number; pendentes: number } | null>(null) // Onda 0
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); return }
    const { data, error } = await supabase.from('v_veic_patio').select('*').eq('company_id', companyId).order('dias_patio', { ascending: false })
    if (error) { setErro(error.message); return }
    const lista = (data as Veic[]) ?? []
    setRows(lista)
    // foto_url guarda o storage_path da principal (bucket privado) — assina para exibir.
    // Legado eventual em URL pública (http) passa direto.
    const paths = lista.map((r) => r.foto_url).filter((u): u is string => !!u && !u.startsWith('http'))
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('revenda-veiculos').createSignedUrls(paths, 3600)
      const m: Record<string, string> = {}
      ;(signed ?? []).forEach((s) => { if (s.signedUrl && s.path) m[s.path] = s.signedUrl })
      setFotoUrls(m)
    } else setFotoUrls({})
    // Onda 5B: quais veículos já têm vistoria (badge "sem vistoria" nos demais)
    const { data: vst } = await supabase.from('insp_vistoria').select('alvo_id').eq('company_id', companyId).eq('alvo_tabela', 'veic_veiculo').neq('situacao', 'cancelada')
    setComVistoria(new Set(((vst as { alvo_id: string }[]) ?? []).map((x) => x.alvo_id)))
    // Onda 6A: quais já têm preço de venda (badge "não precificado" nos demais)
    const { data: prc } = await supabase.from('veic_veiculo').select('id').eq('company_id', companyId).is('deleted_at', null).not('preco_venda', 'is', null)
    setPrecificados(new Set(((prc as { id: string }[]) ?? []).map((x) => x.id)))
    // Onda 0: resumo de completude fiscal (contador "X de Y prontos para nota")
    const { data: rf } = await supabase.rpc('fn_veic_completude_resumo', { p_company_id: companyId })
    const rr = rf as { ok?: boolean; total?: number; aptos?: number; pendentes?: number } | null
    setResumoFiscal(rr?.ok ? { total: rr.total ?? 0, aptos: rr.aptos ?? 0, pendentes: rr.pendentes ?? 0 } : null)
    // Onda 9: veículos com OS de preparação AINDA aberta (badge "em preparação" + trava do anúncio na Onda 13)
    const { data: prep } = await supabase.rpc('fn_veic_preparacao_listar', { p_company_id: companyId, p_veiculo_id: null })
    const pl = prep as { ok?: boolean; os?: { veiculo_id: string; concluida: boolean }[] } | null
    setEmPreparacao(new Set((pl?.ok ? (pl.os ?? []) : []).filter((o) => !o.concluida).map((o) => o.veiculo_id)))
    // Onda 10: nº de interessados (oportunidades abertas) por veículo — carro parado com muitos interessados é sinal de preço
    const { data: ops } = await supabase.from('erp_crm_oportunidade').select('veic_interesse_id').eq('company_id', companyId).is('deleted_at', null).not('veic_interesse_id', 'is', null).not('etapa', 'in', '(ganho,perdido)')
    const mp = new Map<string, number>()
    ;((ops as { veic_interesse_id: string }[]) ?? []).forEach((o) => mp.set(o.veic_interesse_id, (mp.get(o.veic_interesse_id) ?? 0) + 1))
    setInteressados(mp)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => rows.filter((r) =>
    (filtro === 'todos' || r.situacao === filtro) &&
    (compl === 'todos'
      || (compl === 'sem_custo' && !r.tem_custo)
      || (compl === 'sem_dados' && (r.fiscais_faltantes?.length ?? 0) > 0)
      || (compl === 'sem_vistoria' && !comVistoria.has(r.id))
      || (compl === 'nao_precificado' && !precificados.has(r.id))
      || (compl === 'pronto_nota' && (r.fiscais_faltantes?.length ?? 0) === 0)
      || (compl === 'em_preparacao_os' && emPreparacao.has(r.id))
      || (compl === 'faltam_nota' && (r.fiscais_faltantes?.length ?? 0) > 0))
  ), [rows, filtro, compl, comVistoria, precificados, emPreparacao])
  const nSemCusto = useMemo(() => rows.filter((r) => !r.tem_custo).length, [rows])
  const nSemDados = useMemo(() => rows.filter((r) => (r.fiscais_faltantes?.length ?? 0) > 0).length, [rows])
  const nSemVistoria = useMemo(() => rows.filter((r) => !comVistoria.has(r.id)).length, [rows, comVistoria])
  const nNaoPrecificado = useMemo(() => rows.filter((r) => !precificados.has(r.id)).length, [rows, precificados])
  const nEmPreparacao = useMemo(() => rows.filter((r) => emPreparacao.has(r.id)).length, [rows, emPreparacao])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Pátio de veículos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(nSemDados > 0 || nSemCusto > 0) && (
            <a href="/dashboard/revenda/completar" style={{ padding: '9px 14px', border: `1px solid ${C.gold}`, borderRadius: 8, background: C.white, color: C.gold, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
              🧩 Completar dados{nSemDados ? ` (${nSemDados})` : ''}
            </a>
          )}
          <a href="/dashboard/revenda/demanda" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
            🏆 O que comprar
          </a>
          <a href="/dashboard/revenda/preparacao" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
            🔧 Preparação{nEmPreparacao ? ` (${nEmPreparacao})` : ''}
          </a>
          <button onClick={() => setNovo(true)} style={{ padding: '9px 16px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer' }}>+ Novo veículo</button>
        </div>
      </div>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Dias parados e custo acumulado são calculados na hora — nunca gravados. Semáforo pelas faixas da empresa.</p>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: C.espM }}>Situação&nbsp;
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            {SIT.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.espM }}>Completude&nbsp;
          <select value={compl} onChange={(e) => setCompl(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            <option value="sem_custo">sem custo de aquisição{nSemCusto ? ` (${nSemCusto})` : ''}</option>
            <option value="sem_dados">sem dados do veículo{nSemDados ? ` (${nSemDados})` : ''}</option>
            <option value="sem_vistoria">sem vistoria{nSemVistoria ? ` (${nSemVistoria})` : ''}</option>
            <option value="nao_precificado">não precificado{nNaoPrecificado ? ` (${nNaoPrecificado})` : ''}</option>
            <option value="em_preparacao_os">em preparação (OS aberta){nEmPreparacao ? ` (${nEmPreparacao})` : ''}</option>
            <option value="pronto_nota">pronto para nota{resumoFiscal ? ` (${resumoFiscal.aptos})` : ''}</option>
            <option value="faltam_nota">faltam campos p/ nota{resumoFiscal ? ` (${resumoFiscal.pendentes})` : ''}</option>
          </select>
        </label>
        <span style={{ fontSize: 12, color: C.espM }}>{visiveis.length} veículo(s) · ordenado por dias parados</span>
      </div>

      {/* Onda 0: contador de completude fiscal (toque aplica o filtro dos pendentes) */}
      {resumoFiscal && resumoFiscal.total > 0 && (
        <button onClick={() => setCompl(compl === 'faltam_nota' ? 'todos' : 'faltam_nota')}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: resumoFiscal.pendentes > 0 ? C.amberBg : C.greenBg, border: `1px solid ${resumoFiscal.pendentes > 0 ? C.amber : C.green}55`, borderRadius: 10, padding: '9px 12px', marginBottom: 12, cursor: 'pointer', fontSize: 13, color: resumoFiscal.pendentes > 0 ? '#8A4B08' : C.green }}>
          <b>{resumoFiscal.aptos} de {resumoFiscal.total}</b> prontos para emitir nota{resumoFiscal.pendentes > 0 ? ` · toque para ver os ${resumoFiscal.pendentes} pendentes` : ' ✅'}
        </button>
      )}

      {visiveis.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Nenhum veículo no pátio. Cadastre o primeiro.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {visiveis.map((v) => {
            const sc = semColor(v.semaforo)
            return (
              <div key={v.id} onClick={() => router.push(`/dashboard/revenda/veiculo/${v.id}`)}
                style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}>
                <div style={{ height: 110, background: C.cream, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.espL, fontSize: 12 }}>
                  {(() => {
                    const src = v.foto_url ? (v.foto_url.startsWith('http') ? v.foto_url : fotoUrls[v.foto_url]) : null
                    // eslint-disable-next-line @next/next/no-img-element
                    return src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📷 sem foto'
                  })()}
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{v.modelo || '—'} {v.ano_modelo ? `· ${v.ano_modelo}` : ''}</div>
                  <div style={{ fontSize: 12, color: C.espM, fontFamily: 'monospace' }}>{v.placa || 'sem placa'} · {v.chassi.slice(-6)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.c, fontWeight: 700 }}>● {v.dias_patio} dia(s)</span>
                    <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM }}>{v.situacao.replace('_', ' ')}</span>
                    {emPreparacao.has(v.id) && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }} title="Veículo com OS de preparação aberta — não deve ir ao anúncio até concluir">🔧 em preparação</span>}
                    {!comVistoria.has(v.id) && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>sem vistoria</span>}
                    {!precificados.has(v.id) && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>não precificado</span>}
                    {(interessados.get(v.id) ?? 0) > 0 && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: '#FDF7E8', color: C.gold, fontWeight: 700 }} title="Oportunidades abertas com este carro. Muitos interessados + parado há tempo = sinal de preço.">❤ {interessados.get(v.id)} interessado{(interessados.get(v.id) ?? 0) > 1 ? 's' : ''}</span>}
                    {/* Onda 0: badge fiscal — pronto para nota (verde) ou faltam N campos (âmbar) */}
                    {(v.fiscais_faltantes?.length ?? 0) === 0
                      ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.greenBg, color: C.green, fontWeight: 700 }}>pronto para nota</span>
                      : <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>faltam {v.fiscais_faltantes!.length} campos</span>}
                  </div>
                  {/* Selo 1 · custo (margem). Selo 2 · dados do veículo — nomeia o que falta,
                      NUNCA afirma "não emite" (veicProd é do 0km; usado é decisão do contador). */}
                  {v.tem_custo
                    ? <div style={{ marginTop: 8, fontSize: 12, color: C.espM }}>custo acumulado <b style={{ color: C.esp }}>{brl(v.custo_acumulado)}</b></div>
                    : <div style={{ marginTop: 8, fontSize: 11, color: '#8A4B08', background: '#FAEEDA', borderRadius: 6, padding: '4px 8px', fontWeight: 600 }}>⚠️ sem custo de aquisição — margem não calcula</div>}
                  {(v.fiscais_faltantes?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: C.blue, background: '#EEF3FB', borderRadius: 6, padding: '4px 8px', lineHeight: 1.35 }}
                      title="Necessário para veículo novo; para usado, a confirmar com o contador">
                      🚙 faltam dados do veículo: {v.fiscais_faltantes!.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {novo && <NovoVeiculo companyId={companyId} onClose={() => setNovo(false)} onSaved={(id) => { setNovo(false); if (id) router.push(`/dashboard/revenda/veiculo/${id}`); else void carregar() }} onErro={setErro} />}
    </div>
  )
}

function NovoVeiculo({ companyId, onClose, onSaved, onErro }: { companyId: string; onClose: () => void; onSaved: (id?: string) => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ chassi: '', placa: '', marca: '', modelo: '', ano_modelo: '', cor: '', origem: 'compra_pf', valor_aquisicao: '' })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_criar', {
      p_company_id: companyId,
      p_veiculo: { chassi: f.chassi.trim(), placa: f.placa.trim() || null, marca: f.marca.trim() || null, modelo: f.modelo.trim() || null, ano_modelo: f.ano_modelo ? Number(f.ano_modelo) : null, cor: f.cor.trim() || null, origem: f.origem, valor_aquisicao: f.valor_aquisicao ? Number(f.valor_aquisicao) : null },
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; id?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'chassi_ja_cadastrado' ? 'Chassi já cadastrado nesta empresa.' : r?.erro === 'chassi_obrigatorio' ? 'Chassi é obrigatório.' : (error?.message || 'Falha ao salvar')); return }
    onSaved(r.id)
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(520px,100%)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Novo veículo</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value })} placeholder="chassi (obrigatório)" style={{ ...inp, gridColumn: '1 / -1' }} />
          <input value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value })} placeholder="placa (opcional — carro sem placa existe)" style={inp} />
          <input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} placeholder="marca" style={inp} />
          <input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} placeholder="modelo" style={inp} />
          <input value={f.ano_modelo} onChange={(e) => setF({ ...f, ano_modelo: e.target.value })} placeholder="ano modelo" style={inp} />
          <input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} placeholder="cor" style={inp} />
          <select value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} style={inp}>
            <option value="compra_pf">compra PF</option><option value="compra_pj">compra PJ</option><option value="consignacao">consignação</option><option value="troca">troca</option>
          </select>
          <input value={f.valor_aquisicao} onChange={(e) => setF({ ...f, valor_aquisicao: e.target.value })} placeholder="valor de aquisição" style={{ ...inp, gridColumn: '1 / -1' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={!f.chassi.trim() || busy} onClick={() => void salvar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: f.chassi.trim() && !busy ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: f.chassi.trim() && !busy ? 'pointer' : 'not-allowed' }}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
