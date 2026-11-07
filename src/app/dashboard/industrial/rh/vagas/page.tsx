'use client'

// Indústria › RH › Vagas: o RH abre a vaga; só a diretoria aprova ou recusa (trava no banco: fn_rh_vaga_decidir).
// Os botões de decisão só aparecem para a diretoria, mas quem manda é o banco. Vaga aprovada = posição a preencher.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.6)'
const COR: Record<string, string> = { solicitada: '#B45309', aprovada: '#166534', recusada: '#A32D2D', cancelada: '#6B7280' }
const DIRETORIA = ['acesso_total', 'diretor', 'diretor_area', 'owner']
const brl = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

type Vaga = { id: string; setor_id: string | null; cargo_id: string | null; quantidade: number; custo_estimado: number | null; justificativa: string; status: string; solicitante_user_id: string; motivo_decisao: string | null; decidido_em: string | null; created_at: string }
type Opc = { id: string; nome: string }

export default function VagasPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && sel ? sel : null
  const [vagas, setVagas] = useState<Vaga[]>([])
  const [setores, setSetores] = useState<Opc[]>([])
  const [cargos, setCargos] = useState<Opc[]>([])
  const [papel, setPapel] = useState<string | null>(null)
  const [eu, setEu] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('solicitada')
  const [form, setForm] = useState({ setor: '', cargo: '', qtd: '1', custo: '', just: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'erro'; s: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const [v, s, c, p, u] = await Promise.all([
      supabase.from('rh_vaga').select('id,setor_id,cargo_id,quantidade,custo_estimado,justificativa,status,solicitante_user_id,motivo_decisao,decidido_em,created_at')
        .eq('company_id', empresa).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('prod_setor').select('id,nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
      supabase.from('prod_cargo').select('id,nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
      supabase.rpc('fn_rh_vaga_papel', { p_company_id: empresa }),
      supabase.auth.getUser(),
    ])
    setVagas((v.data ?? []) as Vaga[]); setSetores((s.data ?? []) as Opc[]); setCargos((c.data ?? []) as Opc[])
    setPapel((p.data as string | null) ?? null); setEu(u.data.user?.id ?? null)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const nome = (l: Opc[], id: string | null) => l.find(x => x.id === id)?.nome ?? '—'
  const lista = useMemo(() => vagas.filter(v => v.status === filtro), [vagas, filtro])
  const diretoria = papel != null && DIRETORIA.includes(papel)

  async function rodar(fn: string, args: Record<string, unknown>, okMsg: string) {
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setMsg({ t: 'erro', s: error.message }); return false }
    setMsg({ t: 'ok', s: okMsg }); await carregar(); return true
  }
  async function abrir() {
    if (!empresa) return
    const ok = await rodar('fn_rh_vaga_abrir', {
      p_company_id: empresa, p_setor_id: form.setor || null, p_cargo_id: form.cargo || null,
      p_quantidade: Number(form.qtd) || 1, p_custo_estimado: form.custo ? Number(form.custo) : null, p_justificativa: form.just,
    }, 'Vaga aberta. Aguarda a decisão da diretoria.')
    if (ok) setForm({ setor: '', cargo: '', qtd: '1', custo: '', just: '' })
  }
  async function motivoDe(acao: string) { return window.prompt(`Motivo para ${acao}:`)?.trim() ?? '' }
  async function decidir(id: string, aprovar: boolean) {
    const m = await motivoDe(aprovar ? 'aprovar' : 'recusar'); if (!m) return
    await rodar('fn_rh_vaga_decidir', { p_vaga_id: id, p_aprovar: aprovar, p_motivo: m }, aprovar ? 'Vaga aprovada.' : 'Vaga recusada.')
  }
  async function cancelar(id: string) {
    const m = await motivoDe('cancelar'); if (!m) return
    await rodar('fn_rh_vaga_cancelar', { p_vaga_id: id, p_motivo: m }, 'Vaga cancelada (fica no histórico).')
  }

  const campo = { width: '100%', padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontSize: 15, color: ESP } as const
  const rot = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 4 } as const

  if (!empresa) return <div style={{ padding: 24, background: BG, color: ESP }}>Escolha uma empresa para ver as vagas.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px', color: ESP, fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Vagas de mão de obra</h1>
        <p style={{ color: MUT, margin: '4px 0 20px' }}>O RH abre; só a diretoria aprova. Vaga aprovada vira posição a preencher no quadro de postos.</p>
        {msg && <div role="status" style={{ padding: 12, borderRadius: 8, marginBottom: 16, background: msg.t === 'ok' ? '#DCFCE7' : '#FCEBEB', color: msg.t === 'ok' ? '#166534' : '#A32D2D' }}>{msg.s}</div>}

        <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Abrir vaga</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label><span style={rot}>Setor <AjudaCampo chave="industria.vagas.setor" /></span>
              <select style={campo} value={form.setor} onChange={e => setForm({ ...form, setor: e.target.value })}><option value="">Selecione</option>{setores.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></label>
            <label><span style={rot}>Cargo <AjudaCampo chave="industria.vagas.cargo" /></span>
              <select style={campo} value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })}><option value="">Selecione</option>{cargos.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></label>
            <label><span style={rot}>Quantidade <AjudaCampo chave="industria.vagas.quantidade" /></span>
              <input style={campo} type="number" min={1} value={form.qtd} onChange={e => setForm({ ...form, qtd: e.target.value })} /></label>
            <label><span style={rot}>Custo estimado (por pessoa) <AjudaCampo chave="industria.vagas.custo" /></span>
              <input style={campo} type="number" min={0} step="0.01" value={form.custo} onChange={e => setForm({ ...form, custo: e.target.value })} /></label>
          </div>
          <label style={{ display: 'block', marginTop: 12 }}><span style={rot}>Justificativa <AjudaCampo chave="industria.vagas.justificativa" /></span>
            <textarea style={{ ...campo, minHeight: 72 }} value={form.just} onChange={e => setForm({ ...form, just: e.target.value })} /></label>
          <button onClick={abrir} disabled={busy || !form.just.trim()} style={{ marginTop: 12, padding: '12px 20px', background: GOLD, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, minHeight: 44, opacity: busy || !form.just.trim() ? 0.5 : 1 }}>Abrir vaga</button>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={rot}>Situação <AjudaCampo chave="industria.vagas.status" /></span>
          {Object.keys(COR).map(s => (
            <button key={s} onClick={() => setFiltro(s)} style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${filtro === s ? COR[s] : LINE}`, background: filtro === s ? COR[s] : '#fff', color: filtro === s ? '#fff' : ESP, minHeight: 40, textTransform: 'capitalize' }}>
              {s} ({vagas.filter(v => v.status === s).length})
            </button>
          ))}
        </div>

        {lista.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: MUT, background: '#fff', borderRadius: 12, border: `1px solid ${LINE}` }}>Nenhuma vaga {filtro}. {filtro === 'solicitada' ? 'Use “Abrir vaga” acima.' : ''}</div>}
        <div style={{ display: 'grid', gap: 12 }}>
          {lista.map(v => (
            <article key={v.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderLeft: `4px solid ${COR[v.status]}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{v.quantidade}× {nome(cargos, v.cargo_id)} · {nome(setores, v.setor_id)}</strong>
                <span style={{ color: COR[v.status], fontWeight: 700, textTransform: 'capitalize' }}>{v.status === 'aprovada' ? 'Aprovada · posição a preencher' : v.status}</span>
              </div>
              <div style={{ color: MUT, fontSize: 14, margin: '6px 0' }}>Custo estimado por pessoa: {brl(v.custo_estimado)} · aberta em {new Date(v.created_at).toLocaleDateString('pt-BR')}</div>
              <p style={{ margin: '6px 0' }}>{v.justificativa}</p>
              {v.motivo_decisao && <p style={{ margin: '6px 0', fontSize: 14, color: MUT }}>Motivo: {v.motivo_decisao}</p>}
              {v.status === 'solicitada' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {diretoria && v.solicitante_user_id !== eu && <>
                    <button disabled={busy} onClick={() => decidir(v.id, true)} style={{ padding: '10px 16px', background: '#166534', color: '#fff', border: 0, borderRadius: 8, minHeight: 44 }}>Aprovar</button>
                    <button disabled={busy} onClick={() => decidir(v.id, false)} style={{ padding: '10px 16px', background: '#A32D2D', color: '#fff', border: 0, borderRadius: 8, minHeight: 44 }}>Recusar</button>
                    <AjudaCampo chave="industria.vagas.aprovar" />
                  </>}
                  {(v.solicitante_user_id === eu || diretoria) && <>
                    <button disabled={busy} onClick={() => cancelar(v.id)} style={{ padding: '10px 16px', background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 8, minHeight: 44 }}>Cancelar vaga</button>
                    <AjudaCampo chave="industria.vagas.cancelar" />
                  </>}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
