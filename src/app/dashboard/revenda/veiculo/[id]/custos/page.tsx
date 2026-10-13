'use client'

// Revenda · Onda R3 (Tela 7) — Custos do veículo. Lançamento por categoria (com "entra na base fiscal"),
// PREVISTO × REALIZADO (previsto vem da vistoria), bloco do CARREGO (3 componentes, badge honesto RD-51),
// alerta de custo FORA DA CURVA (> 2× a mediana da categoria no histórico da empresa) e o disparo para
// Contas a Pagar da GE como ÚNICO caminho (fn_veic_custo_salvar com gerar-pagar). RD-65: carrego vem do banco.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const CATS = ['aquisicao', 'documentacao', 'despachante', 'preparacao', 'peca', 'mao_de_obra', 'debito_assumido', 'frete', 'comissao', 'outro']

type Custo = { id: string; categoria: string; descricao: string | null; valor: number; fornecedor_nome: string | null; data_custo: string; entra_base_fiscal: boolean | null; pagar_id: string | null }
type Comp3 = { valor: number | null; status: string }
type Carrego = { ok?: boolean; dias_parado: number | null; total: number | null; total_status: string
  ocupacao: Comp3; capital: Comp3; depreciacao: Comp3 & { fonte?: string }; sangria_dia: number | null }

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export default function CustosPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const params = useParams()
  const veiculoId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  const [veic, setVeic] = useState<{ company_id: string; marca: string | null; modelo: string | null; placa: string | null } | null>(null)
  const [custos, setCustos] = useState<Custo[]>([])
  const [previsao, setPrevisao] = useState<number | null>(null)
  const [carrego, setCarrego] = useState<Carrego | null>(null)
  const [medianas, setMedianas] = useState<Record<string, number>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!veiculoId) return
    const { data: v } = await supabase.from('veic_veiculo').select('company_id, marca, modelo, placa').eq('id', veiculoId).maybeSingle()
    const vv = v as { company_id: string; marca: string | null; modelo: string | null; placa: string | null } | null
    setVeic(vv)
    const { data: cs } = await supabase.from('veic_custo').select('id,categoria,descricao,valor,fornecedor_nome,data_custo,entra_base_fiscal,pagar_id').eq('veiculo_id', veiculoId).is('deleted_at', null).order('data_custo')
    setCustos((cs as Custo[]) ?? [])
    const { data: iv } = await supabase.from('insp_vistoria').select('previsao_total').eq('alvo_tabela', 'veic_veiculo').eq('alvo_id', veiculoId).eq('situacao', 'concluida').order('concluida_em', { ascending: false }).limit(1).maybeSingle()
    setPrevisao((iv as { previsao_total: number | null } | null)?.previsao_total ?? null)
    const { data: cg } = await supabase.rpc('fn_veic_carrego', { p_veiculo_id: veiculoId })
    const cgr = cg as Carrego | null; setCarrego(cgr?.ok ? cgr : null)
    // fora da curva: mediana por categoria no histórico da empresa
    if (vv?.company_id) {
      const { data: hist } = await supabase.from('veic_custo').select('categoria,valor').eq('company_id', vv.company_id).is('deleted_at', null)
      const porCat: Record<string, number[]> = {}
      ;((hist as { categoria: string; valor: number }[]) ?? []).forEach((h) => { (porCat[h.categoria] ||= []).push(Number(h.valor) || 0) })
      const md: Record<string, number> = {}
      Object.entries(porCat).forEach(([cat, xs]) => { if (xs.length >= 3) { const m = mediana(xs); if (m && m > 0) md[cat] = m } })
      setMedianas(md)
    }
  }, [veiculoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const realizado = useMemo(() => custos.reduce((s, c) => s + (Number(c.valor) || 0), 0), [custos])
  const porCategoria = useMemo(() => {
    const m: Record<string, number> = {}
    custos.forEach((c) => { m[c.categoria] = (m[c.categoria] || 0) + (Number(c.valor) || 0) })
    return m
  }, [custos])

  if (!veic) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>{erro ?? 'Carregando custos…'}</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 720, margin: '0 auto', padding: '18px 16px 48px' }}>
      <a href={`/dashboard/revenda/veiculo/${veiculoId}`} style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar à ficha</a>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700, marginTop: 8 }}>Custos do veículo</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 14px' }}>{veic.marca} {veic.modelo} {veic.placa ? `· ${veic.placa}` : ''}</h1>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setErro(null)}>{erro}</div>}

      {/* PREVISTO × REALIZADO */}
      <Bloco titulo="Previsto × realizado" hint="O previsto vem da vistoria; o realizado é a soma dos custos lançados.">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 10.5, textTransform: 'uppercase', color: C.espM }}>Previsto (vistoria)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{previsao != null ? brl(previsao) : <span style={{ fontSize: 13, color: C.amber }}>sem vistoria</span>}</div></div>
          <div><div style={{ fontSize: 10.5, textTransform: 'uppercase', color: C.espM }}>Realizado (custos)</div><div style={{ fontSize: 20, fontWeight: 700 }}>{brl(realizado)}</div></div>
          {previsao != null && (
            <div><div style={{ fontSize: 10.5, textTransform: 'uppercase', color: C.espM }}>Diferença</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: realizado > previsao ? C.red : C.green }}>{realizado > previsao ? '+' : ''}{brl(realizado - previsao)}</div></div>
          )}
        </div>
      </Bloco>

      {/* CARREGO */}
      <Bloco titulo="Carrego do veículo" hint="O que este carro custa só por estar parado (fonte única fn_veic_carrego).">
        {carrego ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <CompCarrego l="Ocupação" c={carrego.ocupacao} />
            <CompCarrego l="Capital" c={carrego.capital} />
            <CompCarrego l="Depreciação" c={carrego.depreciacao} />
            <div style={{ marginLeft: 'auto' }}><span style={{ color: C.espM }}>total ({carrego.dias_parado ?? '—'} dias): </span><b>{brl(carrego.total)}</b>{carrego.total_status !== 'ok' && <span style={{ color: C.amber, fontSize: 11 }}> · parcial</span>}</div>
          </div>
        ) : <div style={{ fontSize: 12.5, color: C.espM }}>Carrego não configurado. <a href="/dashboard/revenda/config" style={{ color: C.gold, textDecoration: 'underline' }}>configurar a garagem</a></div>}
      </Bloco>

      {/* LANÇAR CUSTO */}
      <Bloco titulo="Lançar custo" hint="O título em Contas a Pagar da GE nasce daqui (único caminho).">
        <NovoCusto veiculoId={veiculoId} onSaved={() => { setMsg('Custo lançado.'); void carregar() }} onErro={setErro} />
      </Bloco>

      {/* CUSTOS LANÇADOS */}
      <Bloco titulo="Custos lançados" hint="⚠️ Custo acima de 2× a mediana da categoria (no histórico da empresa) é sinalizado como “fora da curva”.">
        {custos.length === 0 ? <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Nenhum custo ainda.</div> : (
          <div>
            {custos.map((c) => {
              const md = medianas[c.categoria]
              const foraCurva = md != null && (Number(c.valor) || 0) > 2 * md
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderTop: `1px solid ${C.cream}`, padding: '7px 0', flexWrap: 'wrap' }}>
                  <b style={{ minWidth: 110 }}>{c.categoria.replace('_', ' ')}</b>
                  <span>{brl(c.valor)}</span>
                  {c.descricao && <span style={{ color: C.espM }}>· {c.descricao}</span>}
                  <span style={{ color: C.espL, fontSize: 11 }}>{brDate(c.data_custo)}</span>
                  {c.entra_base_fiscal === null
                    ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber }}>aguarda contador</span>
                    : c.entra_base_fiscal
                      ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.greenBg, color: C.green }}>entra na base fiscal</span>
                      : <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM }}>fora da base</span>}
                  {c.pagar_id
                    ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM }}>tem título</span>
                    : <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espL }}>sem título</span>}
                  {foraCurva && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.redBg, color: C.red, fontWeight: 700 }} title={`Mais que 2× a mediana da categoria (${brl(md)}) no histórico da empresa`}>⚠️ fora da curva</span>}
                </div>
              )
            })}
            <div style={{ borderTop: `2px solid ${C.cream}`, marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <b>Realizado total</b><b>{brl(realizado)}</b>
            </div>
            {/* por categoria */}
            <div style={{ marginTop: 8, fontSize: 11.5, color: C.espM, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(porCategoria).map(([cat, val]) => <span key={cat}>{cat.replace('_', ' ')}: <b style={{ color: C.esp }}>{brl(val)}</b></span>)}
            </div>
          </div>
        )}
      </Bloco>
    </div>
  )
}

function CompCarrego({ l, c }: { l: string; c: Comp3 }) {
  const txt = c.status === 'ok' ? brl(c.valor) : c.status === 'travado_d7' ? 'FIPE em breve' : c.status === 'nao_calcular' ? 'não calcula' : 'não configurado'
  const cor = c.status === 'ok' ? C.esp : c.status === 'nao_calcular' ? C.espL : C.amber
  return <div><span style={{ color: C.espM }}>{l}: </span><b style={{ color: cor }}>{txt}</b>
    {(c.status !== 'ok' && c.status !== 'nao_calcular' && c.status !== 'travado_d7') && <> <a href="/dashboard/revenda/config" style={{ color: C.gold, fontSize: 11, textDecoration: 'underline' }}>configurar</a></>}
  </div>
}

function Bloco({ titulo, hint, children }: { titulo: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{titulo}</div>
      {hint && <div style={{ fontSize: 11.5, color: C.espL, margin: '2px 0 10px', lineHeight: 1.45 }}>{hint}</div>}
      {children}
    </div>
  )
}

// Lançamento por categoria, com opção de gerar o título em Contas a Pagar (único caminho — RD-65).
function NovoCusto({ veiculoId, onSaved, onErro }: { veiculoId: string; onSaved: () => void; onErro: (m: string) => void }) {
  const vazio = { categoria: 'preparacao', valor: '', descricao: '', fornecedor_nome: '', data_custo: '', gerar: false, vencimento: '' }
  const [f, setF] = useState(vazio)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const valorNum = Number(String(f.valor).replace(',', '.'))
  const valorOk = f.valor.trim() !== '' && Number.isFinite(valorNum) && valorNum > 0
  const podeEnviar = valorOk && !!f.categoria.trim() && !!f.descricao.trim() && (!f.gerar || !!f.vencimento) && !busy
  async function salvar() {
    setErro(null)
    if (!valorOk) { setErro('Informe um valor maior que zero.'); return }
    if (!f.descricao.trim()) { setErro('Descreva o custo.'); return }
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
    const { data, error } = await supabase.rpc('fn_veic_custo_salvar', {
      p_veiculo_id: veiculoId,
      p_custo: { categoria: f.categoria, valor: valorNum, descricao: f.descricao.trim(), fornecedor_nome: f.fornecedor_nome.trim() || null, data_custo: f.data_custo || null },
      p_gerar_pagar: f.gerar, p_vencimento: f.gerar ? (f.vencimento || null) : null, p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { if (error && !r) { onErro('Não foi possível salvar agora.'); return } setErro(r?.erro || 'Falha ao salvar.'); return }
    setF(vazio); onSaved()
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} style={inp}>{CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select>
        <input value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="valor *" inputMode="decimal" style={{ ...inp, width: 90 }} />
        <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="descrição *" style={{ ...inp, width: 170 }} />
        <input value={f.fornecedor_nome} onChange={(e) => setF({ ...f, fornecedor_nome: e.target.value })} placeholder="fornecedor" style={{ ...inp, width: 130 }} />
        <input type="date" value={f.data_custo} onChange={(e) => setF({ ...f, data_custo: e.target.value })} style={inp} />
        <label style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={f.gerar} onChange={(e) => setF({ ...f, gerar: e.target.checked })} /> gerar título em contas a pagar
        </label>
        {f.gerar && <label style={{ fontSize: 11, color: C.espM }}>venc.<input type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} style={{ ...inp, marginLeft: 4 }} /></label>}
        <button disabled={!podeEnviar} onClick={() => void salvar()} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: podeEnviar ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: podeEnviar ? 'pointer' : 'not-allowed' }}>{busy ? 'Salvando…' : '+ Custo'}</button>
      </div>
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 7, fontSize: 12, marginTop: 6, display: 'inline-block' }}>{erro}</div>}
      <div style={{ fontSize: 10.5, color: C.espL, marginTop: 4 }}>* valor, categoria e descrição são obrigatórios. Contas a Pagar da GE só nasce por aqui.</div>
    </div>
  )
}
