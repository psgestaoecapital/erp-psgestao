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
type MarcaGrupo = { nome: string; n: number; capital: number; dias_medio: number | null; sem_marca: boolean }
type SugestaoGrafia = { grafias: string[]; veiculos: number; placas: string[] }
type VendaModelo = { modelo: string; qtd: number; afirma_media: boolean; dias_medio: number | null; margem_media: number | null }
type Resumo = { ok: boolean; total_veiculos: number; capital: number; marcas: MarcaGrupo[]; sugestoes_grafia: SugestaoGrafia[]; vendas_total: number; vendas_por_modelo: VendaModelo[] }

export default function DemandaPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [itens, setItens] = useState<Item[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [dias, setDias] = useState(90)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modal, setModal] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setItens([]); setResumo(null); setLoading(false); return }
    setLoading(true)
    const [d, r] = await Promise.all([
      supabase.rpc('fn_veic_demanda_nao_atendida', { p_company_id: companyId, p_dias: dias }),
      supabase.rpc('fn_veic_patio_resumo', { p_company_id: companyId }),
    ])
    if (d.error) { setErro(d.error.message); setLoading(false); return }
    const dr = d.data as { ok?: boolean; itens?: Item[] } | null
    setItens(dr?.ok ? (dr.itens ?? []) : [])
    const rr = r.data as Resumo | null
    setResumo(rr?.ok ? rr : null)
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

      {loading ? (
        <div style={{ color: C.espM, fontSize: 13, marginTop: 16 }}>Carregando…</div>
      ) : (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          {/* ordem: procuras primeiro quando houver; senão pátio + histórico primeiro (a tela nunca abre vazia) */}
          {itens.length > 0 && <ProcurasBloco itens={itens} faixaAno={faixaAno} />}
          {resumo && <PatioBloco r={resumo} />}
          {resumo && <VendasBloco r={resumo} />}
          {itens.length === 0 && (
            <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '24px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>Nenhuma procura registrada ainda.</div>
              <div style={{ fontSize: 12.5, color: C.espM, lineHeight: 1.55, margin: '6px auto 0', maxWidth: 480 }}>Quando um cliente procurar um carro que você não tem, registre aqui. Depois de algumas, esta tela mostra o que vale a pena comprar.</div>
              <button onClick={() => setModal(true)} style={{ marginTop: 12, padding: '9px 16px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Registrar procura</button>
            </div>
          )}
        </div>
      )}

      {modal && <ProcuraModal companyId={companyId} onClose={() => setModal(false)} onSaved={() => { setModal(false); void carregar() }} onErro={setErro} />}
    </div>
  )
}

function Bloco({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espM, fontWeight: 700 }}>{titulo}</div>
      {sub && <div style={{ fontSize: 13, fontWeight: 700, margin: '2px 0 8px' }}>{sub}</div>}
      <div style={{ marginTop: sub ? 0 : 8 }}>{children}</div>
    </div>
  )
}

// Procuras — o que já estava previsto (fn_veic_demanda_nao_atendida), cruzado com o pátio
function ProcurasBloco({ itens, faixaAno }: { itens: Item[]; faixaAno: (i: Item) => string }) {
  return (
    <Bloco titulo="Procuras" sub="Demanda que você não atendeu">
      <div style={{ display: 'grid', gap: 10 }}>
        {itens.map((i, ix) => (
          <div key={ix} style={{ border: `1px solid ${i.demanda ? C.gold + '66' : C.border}`, borderLeft: `4px solid ${i.demanda ? C.gold : C.border}`, borderRadius: 10, padding: '11px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{[i.marca, i.modelo].filter(Boolean).join(' ') || 'Sem descrição'}</div>
              {faixaAno(i) && <span style={{ fontSize: 12.5, color: C.espM }}>{faixaAno(i)}</span>}
              {i.valor_ate != null && <span style={{ fontSize: 12.5, color: C.espM }}>até {brl(i.valor_ate)}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: i.demanda ? C.gold : C.espM }}>{i.procuras} procura{i.procuras > 1 ? 's' : ''}</span>
            </div>
            <div style={{ fontSize: 12.5, marginTop: 6, color: i.estoque_qtd === 0 ? C.red : C.green }}>
              {i.estoque_qtd === 0 ? 'Você não tem nenhum no pátio' : `Você tem ${i.estoque_qtd}${i.estoque_preco_min != null ? ` · anunciado ${brl(i.estoque_preco_min)}` : ' (nenhum precificado)'}`}
            </div>
            {!i.demanda && <div style={{ fontSize: 11, color: C.espL, marginTop: 4, fontStyle: 'italic' }}>caso isolado — 1 procura só; ainda não é padrão de demanda</div>}
          </div>
        ))}
      </div>
    </Bloco>
  )
}

// Seu pátio hoje — o que já se tem (fn_veic_patio_resumo). Grupos por marca LITERAL (número é fato).
// Sugestões de grafia (trigram) aparecem como AVISO separado acima — se a heurística errar, erra no aviso.
function PatioBloco({ r }: { r: Resumo }) {
  return (
    <Bloco titulo="Seu pátio hoje" sub={`${r.total_veiculos} veículos · ${brl(r.capital)} parados`}>
      {/* avisos de grafia (heurística) — separados dos números */}
      {(r.sugestoes_grafia ?? []).map((s, ix) => (
        <div key={ix} style={{ background: C.amberBg, border: `1px solid ${C.amber}55`, borderLeft: `4px solid ${C.amber}`, borderRadius: 8, padding: '9px 11px', marginBottom: 8, fontSize: 12, color: '#8A4B08', lineHeight: 1.5 }}>
          ⚠️ <b>{s.grafias.length} grafias parecem ser a mesma marca</b> ({s.grafias.join(' · ')}) — <b>{s.veiculos} veículos</b> no total. Padronize no cadastro.
          {s.placas.length > 0 && <div style={{ fontSize: 11, color: C.espM, marginTop: 3, fontFamily: 'monospace' }}>{s.placas.join(' · ')}</div>}
          <a href="/dashboard/revenda/patio" style={{ display: 'inline-block', marginTop: 4, fontSize: 11.5, color: C.blue, textDecoration: 'none', fontWeight: 700 }}>ver no pátio →</a>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
        {r.marcas.map((m, ix) => (
          <div key={ix} style={{ border: `1px solid ${m.sem_marca ? C.amber + '66' : C.border}`, borderRadius: 9, padding: '8px 10px', background: m.sem_marca ? C.amberBg : C.white }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{m.nome}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: C.esp }}>{m.n}</span>
            </div>
            <div style={{ fontSize: 11, color: C.espM, marginTop: 2 }}>{brl(m.capital)}{m.dias_medio != null ? ` · ${m.dias_medio} dias médios` : ''}</div>
            {m.sem_marca && <div style={{ fontSize: 10.5, color: '#8A4B08', marginTop: 4, fontWeight: 600 }}>⚠️ {m.n} veículo(s) sem marca cadastrada</div>}
          </div>
        ))}
      </div>
    </Bloco>
  )
}

// O que você já vendeu — histórico por modelo (fn_veic_patio_resumo). <2 vendas não afirma média.
function VendasBloco({ r }: { r: Resumo }) {
  return (
    <Bloco titulo="O que você já vendeu">
      {r.vendas_por_modelo.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Nenhuma venda registrada ainda.</div>
      ) : r.vendas_total < 2 ? (
        <div style={{ fontSize: 12.5, color: C.espM }}>{r.vendas_total} venda registrada — ainda sem histórico para comparar.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {r.vendas_por_modelo.map((v, ix) => (
            <div key={ix} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: ix ? `1px solid ${C.cream}` : 'none', padding: '6px 0', fontSize: 13 }}>
              <span style={{ fontWeight: 700, minWidth: 150 }}>{v.modelo}</span>
              <span style={{ color: C.espM }}>{v.qtd} venda{v.qtd > 1 ? 's' : ''}</span>
              {v.afirma_media ? (
                <>
                  {v.dias_medio != null && <span style={{ color: C.espM }}>· {v.dias_medio} dias até vender</span>}
                  {v.margem_media != null && <span style={{ marginLeft: 'auto', fontWeight: 700, color: v.margem_media >= 0 ? C.green : C.red }}>margem média {brl(v.margem_media)}</span>}
                </>
              ) : <span style={{ color: C.espL, fontStyle: 'italic' }}>· 1 venda só — sem média</span>}
            </div>
          ))}
        </div>
      )}
    </Bloco>
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
