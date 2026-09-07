'use client'

// Revenda de Veículos · Onda 10 (§4.3) — "O que comprar". A demanda que a loja NÃO atendeu:
// procuras sem estoque agrupadas por marca+modelo (fn_veic_demanda_nao_atendida). É a tela que
// transforma o CRM em decisão de compra. <2 procuras do mesmo modelo = caso isolado (não afirma demanda).

import { useCallback, useEffect, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number | null) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Item = { marca: string | null; modelo: string | null; procuras: number; demanda: boolean; ano_min: number | null; ano_max: number | null; valor_ate: number | null; estoque_qtd: number; estoque_preco_min: number | null }

export default function DemandaPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [itens, setItens] = useState<Item[]>([])
  const [dias, setDias] = useState(90)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modal, setModal] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setItens([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_veic_demanda_nao_atendida', { p_company_id: companyId, p_dias: dias })
    if (error) { setErro(error.message); setLoading(false); return }
    const r = data as { ok?: boolean; itens?: Item[] } | null
    setItens(r?.ok ? (r.itens ?? []) : [])
    setLoading(false)
  }, [companyId, dias])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const faixaAno = (i: Item) => i.ano_min && i.ano_max ? `${i.ano_min}-${i.ano_max}` : i.ano_min ? `${i.ano_min}+` : i.ano_max ? `até ${i.ano_max}` : ''

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 880, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>← voltar ao pátio</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🏆 Comércio · Revenda</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>O que comprar</h1>
          <p style={{ color: C.espM, fontSize: 13, margin: '4px 0 0' }}>A demanda que você não atendeu — o que o cliente procurou e você não tinha.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: C.espM }}>últimos&nbsp;
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={inp}>
              <option value={30}>30 dias</option><option value={90}>90 dias</option><option value={180}>180 dias</option><option value={365}>1 ano</option>
            </select>
          </label>
          <button onClick={() => setModal(true)} style={{ padding: '9px 14px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Registrar procura</button>
        </div>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, margin: '12px 0' }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ color: C.espM, fontSize: 13 }}>Carregando…</div>
        ) : itens.length === 0 ? (
          <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>
            Nenhuma procura registrada neste período. Registre o que os clientes pedem e não encontram — é o que vira decisão de compra.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {itens.map((i, ix) => (
              <div key={ix} style={{ background: C.white, border: `1px solid ${i.demanda ? C.gold + '66' : C.border}`, borderLeft: `4px solid ${i.demanda ? C.gold : C.border}`, borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{[i.marca, i.modelo].filter(Boolean).join(' ') || 'Sem descrição'}</div>
                  {faixaAno(i) && <span style={{ fontSize: 12.5, color: C.espM }}>{faixaAno(i)}</span>}
                  {i.valor_ate != null && <span style={{ fontSize: 12.5, color: C.espM }}>até {brl(i.valor_ate)}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: i.demanda ? C.gold : C.espM }}>{i.procuras} procura{i.procuras > 1 ? 's' : ''}</span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 6, color: i.estoque_qtd === 0 ? C.red : C.green }}>
                  {i.estoque_qtd === 0
                    ? 'Você não tem nenhum no pátio'
                    : `Você tem ${i.estoque_qtd}${i.estoque_preco_min != null ? ` · anunciado ${brl(i.estoque_preco_min)}` : ' (nenhum precificado)'}`}
                </div>
                {!i.demanda && <div style={{ fontSize: 11, color: C.espL, marginTop: 4, fontStyle: 'italic' }}>caso isolado — 1 procura só; ainda não é padrão de demanda</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && <ProcuraModal companyId={companyId} onClose={() => setModal(false)} onSaved={() => { setModal(false); void carregar() }} onErro={setErro} />}
    </div>
  )
}

function ProcuraModal({ companyId, onClose, onSaved, onErro }: { companyId: string; onClose: () => void; onSaved: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ cliente_nome: '', contato: '', marca: '', modelo: '', ano_min: '', ano_max: '', valor_ate: '', cambio: '', observacao: '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const podeEnviar = (!!f.marca.trim() || !!f.modelo.trim()) && !busy
  async function salvar() {
    setErro(null)
    if (!f.marca.trim() && !f.modelo.trim()) { setErro('Informe ao menos marca ou modelo.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_procura_registrar', {
      p_company_id: companyId,
      p_dados: { cliente_nome: f.cliente_nome.trim() || null, contato: f.contato.trim() || null, marca: f.marca.trim() || null, modelo: f.modelo.trim() || null, ano_min: f.ano_min || null, ano_max: f.ano_max || null, valor_ate: f.valor_ate || null, cambio: f.cambio.trim() || null, observacao: f.observacao.trim() || null },
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { onErro(error?.message || r?.erro || 'Falha ao registrar a procura.'); return }
    onSaved()
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(520px,100%)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Registrar procura</div>
        <div style={{ fontSize: 12, color: C.espM, marginBottom: 10 }}>O que o cliente procurou e a loja não tinha. Vira demanda em &quot;O que comprar&quot;.</div>
        {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={f.cliente_nome} onChange={(e) => setF({ ...f, cliente_nome: e.target.value })} placeholder="cliente" style={inp} />
          <input value={f.contato} onChange={(e) => setF({ ...f, contato: e.target.value })} placeholder="contato" inputMode="tel" style={inp} />
          <input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} placeholder="marca *" style={inp} />
          <input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} placeholder="modelo *" style={inp} />
          <input value={f.ano_min} onChange={(e) => setF({ ...f, ano_min: e.target.value })} placeholder="ano de" inputMode="numeric" style={inp} />
          <input value={f.ano_max} onChange={(e) => setF({ ...f, ano_max: e.target.value })} placeholder="ano até" inputMode="numeric" style={inp} />
          <input value={f.valor_ate} onChange={(e) => setF({ ...f, valor_ate: e.target.value })} placeholder="até R$" inputMode="decimal" style={inp} />
          <input value={f.cambio} onChange={(e) => setF({ ...f, cambio: e.target.value })} placeholder="câmbio" style={inp} />
          <input value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="observação" style={{ ...inp, gridColumn: '1 / -1' }} />
        </div>
        <div style={{ fontSize: 11, color: C.espL, marginTop: 6 }}>* marca ou modelo é obrigatório.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={!podeEnviar} onClick={() => void salvar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: !podeEnviar ? C.espL : C.gold, color: C.white, fontWeight: 700, cursor: !podeEnviar ? 'not-allowed' : 'pointer' }}>{busy ? 'Salvando…' : 'Registrar'}</button>
        </div>
      </div>
    </div>
  )
}
