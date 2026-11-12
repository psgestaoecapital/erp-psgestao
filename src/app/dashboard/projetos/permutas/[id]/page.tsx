'use client'

// Hub · Permuta — extrato (F1). Mostra como o saldo é formado: valor do contrato + reajuste do índice (CUB) =
// valor atualizado; menos os movimentos (quitações) = saldo. Movimentos agrupados por mês de competência (medição
// mensal), com nota fiscal de origem e empresa emissora (multi-CNPJ). Incluir/excluir movimento (RD-98 rastreável).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel, ehUuid, MSG_ENDERECO_INVALIDO } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/projetos/permutas/[id]'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', RED = '#B42318', REDBG = '#FCEBEB', AMBER = '#BA7517'

const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const fmtMes = (d: string | null) => { if (!d) return 'Sem mês'; const [y, m] = d.slice(0, 7).split('-'); return `${m}/${y}` }
const fmtData = (d: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '—'
const TIPO_MOV: Record<string, string> = { dinheiro: 'Dinheiro', obra: 'Obra', servico: 'Serviço', material: 'Material', imovel: 'Imóvel' }
const SITU: Record<string, { rot: string; cor: string; bg: string }> = {
  a_iniciar: { rot: 'A iniciar', cor: MUT, bg: '#F0ECE3' },
  saldo_devedor: { rot: 'Saldo devedor', cor: AMBER, bg: '#FAEEDA' },
  quitado: { rot: 'Quitado', cor: GREEN, bg: '#ECFDF5' },
  pagou_a_mais: { rot: 'Pagou a mais', cor: RED, bg: REDBG },
}

type Extrato = {
  ok: boolean; erro?: string
  permuta: { id: string; contratante: string; ativo_descr: string; tipo_contrato: string; valor_permuta: number; valor_dinheiro: number; indice_reajuste: string | null; data_base: string | null; observacao: string | null }
  reajuste: { indice: string | null; fator: number; acumulado: number; tem_serie: boolean }
  valor_atualizado: number; quitado: number; saldo: number; status: string
  por_mes: { competencia: string | null; total: number }[]
  movimentos: { id: string; tipo: string; valor: number; data: string; competencia: string | null; num_nota: string | null; cnpj_emissor: string | null; empresa_emissora: string | null; ref_tipo: string | null; observacao: string | null }[]
}

export default function PermutaExtratoPage() {
  const params = useParams()
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string)
  const [ext, setExt] = useState<Extrato | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [novoMov, setNovoMov] = useState(false)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setErro(MSG_ENDERECO_INVALIDO); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_extrato', { p_id: id })
    if (error) { setErro(erroAmigavel(error)); setLoading(false); return }
    const r = data as Extrato
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Permuta não encontrada ou sem acesso.' : 'Não foi possível carregar o extrato.'); setLoading(false); return }
    setExt(r); setLoading(false)
  }, [id])

  useEffect(() => { void carregar() }, [carregar])

  async function excluirMov(movId: string) {
    if (!confirm('Excluir este movimento? Fica arquivado (rastreável), não é apagado.')) return
    const { data, error } = await supabase.rpc('fn_permuta_movimento_excluir', { p_id: movId })
    if (error || !(data as any)?.ok) { alert(erroAmigavel(error)); return }
    void carregar()
  }

  if (loading) return <Casca><div style={{ padding: 30, color: MUT, textAlign: 'center' }}>Carregando…</div></Casca>
  if (erro) return <Casca><div style={{ padding: 24, color: RED, background: REDBG, borderRadius: 12, textAlign: 'center' }}>{erro} <Link href="/dashboard/projetos/permutas" style={{ color: GOLD, fontWeight: 700 }}>Voltar</Link></div></Casca>
  if (!ext) return null

  const s = SITU[ext.status] ?? SITU.a_iniciar
  const p = ext.permuta

  return (
    <Casca>
      <Link href="/dashboard/projetos/permutas" style={{ fontSize: 13, color: MUT, textDecoration: 'none' }}>← Permutas</Link>
      <header style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
        <div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, margin: 0 }}>{p.contratante}</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0' }}>{p.ativo_descr}</p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: s.cor, background: s.bg, borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>{s.rot}</span>
      </header>

      {/* Como o saldo é formado */}
      <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '16px 18px', marginTop: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: 0.5 }}>Como o saldo é formado</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
          <Linha rot="Valor do contrato" v={brl(p.valor_permuta)} />
          <Linha rot={`Reajuste ${p.indice_reajuste ? `(${p.indice_reajuste})` : ''}`} v={ext.reajuste.tem_serie ? `+ ${brl(ext.reajuste.acumulado)}` : '—'} sub={!ext.reajuste.tem_serie && p.indice_reajuste ? 'série do índice ainda não cadastrada' : undefined} />
          <Linha rot="Valor atualizado" v={brl(ext.valor_atualizado)} chave="permuta.extrato.valor_atualizado" forte />
          <Linha rot="Quitado" v={`− ${brl(ext.quitado)}`} cor={GREEN} />
          <Linha rot="Saldo" v={brl(ext.saldo)} cor={ext.saldo < -0.005 ? RED : ESP} forte />
        </div>
      </section>

      {/* Movimentos */}
      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Movimentos (quitações)</h2>
          <button onClick={() => setNovoMov(true)} data-testid="mov-novo" style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Lançar movimento</button>
        </div>

        {ext.movimentos.length === 0 ? (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '24px 16px', textAlign: 'center', color: MUT, marginTop: 10 }}>
            Nenhum movimento ainda. Lance a primeira quitação (dinheiro, obra, serviço, material ou imóvel) para começar a abater o saldo.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
            {ext.por_mes.map(m => {
              const movs = ext.movimentos.filter(x => fmtMes(x.competencia) === fmtMes(m.competencia))
              return (
                <div key={m.competencia ?? 'sem'} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', background: '#FBF7EE', fontSize: 12.5, fontWeight: 700 }}>
                    <span>{fmtMes(m.competencia)} <AjudaCampo chave="permuta.mov.competencia" rota={ROTA} /></span><span>{brl(m.total)}</span>
                  </div>
                  {movs.map(x => (
                    <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderTop: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{TIPO_MOV[x.tipo] ?? x.tipo} · {brl(x.valor)}</div>
                        <div style={{ fontSize: 11.5, color: MUT }}>{fmtData(x.data)}{x.num_nota ? ` · ${x.num_nota}` : ''}{x.empresa_emissora ? ` · ${x.empresa_emissora}` : ''}{x.observacao ? ` · ${x.observacao}` : ''}</div>
                      </div>
                      <button onClick={() => excluirMov(x.id)} data-testid={`mov-excluir-${x.id}`} style={{ background: 'none', border: 'none', color: RED, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Excluir</button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {novoMov && <ModalMovimento permutaId={id} onClose={() => setNovoMov(false)} onSalvo={() => { setNovoMov(false); void carregar() }} />}
    </Casca>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)', color: ESP }}><div style={{ maxWidth: 940, margin: '0 auto' }}>{children}</div></div>
}
function Linha({ rot, v, cor = ESP, forte, chave, sub }: { rot: string; v: string; cor?: string; forte?: boolean; chave?: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: MUT }}>{rot} {chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
      <div style={{ fontSize: forte ? 19 : 15, fontWeight: 700, color: cor, marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 10.5, color: AMBER }}>{sub}</div>}
    </div>
  )
}

const lab: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: ESP, marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, outline: 'none', boxSizing: 'border-box' }

function ModalMovimento({ permutaId, onClose, onSalvo }: { permutaId: string; onClose: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({ tipo: 'servico', valor: '', data: new Date().toISOString().slice(0, 10), competencia: '', num_nota: '', cnpj_emissor: '', observacao: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }))

  async function salvar() {
    if (!f.valor || Number(f.valor) <= 0) { setErro('Informe o valor do movimento.'); return }
    setSalvando(true); setErro(null)
    const comp = f.competencia ? `${f.competencia}-01` : null
    const { data, error } = await supabase.rpc('fn_permuta_movimento_add', { p_dados: { ...f, permuta_id: permutaId, competencia: comp } })
    if (error || !(data as any)?.ok) { setErro(erroAmigavel(error)); setSalvando(false); return }
    onSalvo()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG, borderRadius: 16, padding: '20px', width: 'min(520px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 19, fontWeight: 400, margin: 0 }}>Lançar movimento</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', fontSize: 20, color: MUT, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 11 }}>
          <label style={lab}>Tipo <AjudaCampo chave="permuta.mov.tipo" rota={ROTA} />
            <select style={inp} value={f.tipo} onChange={e => set('tipo', e.target.value)} data-testid="mov-tipo">
              <option value="servico">Serviço</option><option value="obra">Obra</option><option value="material">Material</option><option value="dinheiro">Dinheiro</option><option value="imovel">Imóvel</option>
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lab}>Valor (R$) <AjudaCampo chave="permuta.mov.valor" rota={ROTA} /><input style={inp} type="number" min="0" step="0.01" value={f.valor} onChange={e => set('valor', e.target.value)} data-testid="mov-valor" /></label>
            <label style={lab}>Data <AjudaCampo chave="permuta.mov.data" rota={ROTA} /><input style={inp} type="date" value={f.data} onChange={e => set('data', e.target.value)} /></label>
          </div>
          <label style={lab}>Competência (mês) <AjudaCampo chave="permuta.mov.competencia" rota={ROTA} /><input style={inp} type="month" value={f.competencia} onChange={e => set('competencia', e.target.value)} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lab}>Nota fiscal <AjudaCampo chave="permuta.mov.num_nota" rota={ROTA} /><input style={inp} value={f.num_nota} onChange={e => set('num_nota', e.target.value)} placeholder="Nº da NF (opcional)" /></label>
            <label style={lab}>CNPJ emissor <AjudaCampo chave="permuta.mov.cnpj_emissor" rota={ROTA} /><input style={inp} value={f.cnpj_emissor} onChange={e => set('cnpj_emissor', e.target.value)} placeholder="Opcional" /></label>
          </div>
          <label style={lab}>Observação <AjudaCampo chave="permuta.mov.observacao" rota={ROTA} /><input style={inp} value={f.observacao} onChange={e => set('observacao', e.target.value)} /></label>
          {erro && <div style={{ fontSize: 12.5, color: RED, background: REDBG, borderRadius: 8, padding: '8px 10px' }}>{erro}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: MUT, fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: '9px 14px' }}>Cancelar</button>
            <button onClick={salvar} disabled={salvando} data-testid="mov-salvar" style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Salvando…' : 'Lançar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
