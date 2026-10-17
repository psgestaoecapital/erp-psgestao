'use client'

// HB1 · Lançar horas na obra — apontamento de mão de obra (fn_obra_mao_obra_apontar / _excluir, #2687).
// O custo entra no Resultado por obra (v_obra_resultado_alocado). Incluir e excluir (lógico); para corrigir, exclui e refaz.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'

type Obra = { id: string; numero: string; nome: string }
type Funcao = { id: string; nome: string; custo_hora_manual: number | null }
type Apont = { id: string; data: string; descricao: string | null; horas: number; custo_hora: number; valor: number; funcao_id: string | null }

const hoje = () => new Date().toISOString().slice(0, 10)

export default function LancarHorasObraPage() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [funcoes, setFuncoes] = useState<Funcao[]>([])
  const [obraId, setObraId] = useState('')
  const [lista, setLista] = useState<Apont[]>([])
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [f, setF] = useState({ data: hoje(), funcao_id: '', horas: '', custo_hora: '', descricao: '' })

  const carregarBase = useCallback(async () => {
    if (!companyIds?.length) return
    setErro('')
    try {
      const [o, fu] = await Promise.all([
        comPrazo(async () => await supabase.from('projetos_obras').select('id,numero,nome').in('company_id', companyIds).order('numero', { ascending: false }), { ms: 8000, tentativas: 1, label: 'obras' }),
        comPrazo(async () => await supabase.from('erp_funcao_mao_obra').select('id,nome,custo_hora_manual').in('company_id', companyIds).eq('ativo', true).order('nome'), { ms: 8000, tentativas: 1, label: 'funcoes' }),
      ])
      if (o.error) { setErro(o.error.message); return }
      setObras((o.data ?? []) as Obra[]); setFuncoes((fu.data ?? []) as Funcao[])
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) }
  }, [companyIds])
  useEffect(() => { carregarBase() }, [carregarBase])

  const carregarLista = useCallback(async () => {
    if (!obraId) { setLista([]); return }
    const r = await supabase.from('projetos_obra_mao_obra_apontamento')
      .select('id,data,descricao,horas,custo_hora,valor,funcao_id').eq('obra_id', obraId).is('excluido_em', null).order('data', { ascending: false })
    if (r.error) { setErro(r.error.message); return }
    setLista((r.data ?? []) as Apont[])
  }, [obraId])
  useEffect(() => { carregarLista() }, [carregarLista])

  const escolherFuncao = (id: string) => {
    const fn = funcoes.find(x => x.id === id)
    setF(p => ({ ...p, funcao_id: id, custo_hora: fn?.custo_hora_manual != null && !p.custo_hora ? String(fn.custo_hora_manual) : p.custo_hora }))
  }

  const horas = Number(f.horas.replace(',', '.')), custoHora = Number(f.custo_hora.replace(',', '.'))
  const valido = !!obraId && horas > 0 && custoHora >= 0 && f.custo_hora !== ''

  const lancar = async () => {
    if (!valido || salvando) return
    setSalvando(true); setErro('')
    const r = await supabase.rpc('fn_obra_mao_obra_apontar', { p_obra_id: obraId, p_dados: { data: f.data, funcao_id: f.funcao_id, descricao: f.descricao || null, horas, custo_hora: custoHora } })
    setSalvando(false)
    if (r.error) { setErro(r.error.message); return }
    setF({ data: hoje(), funcao_id: '', horas: '', custo_hora: '', descricao: '' })
    carregarLista()
  }

  const excluir = async (id: string) => {
    if (!window.confirm('Excluir este lançamento de horas? O valor sai do custo da obra.')) return
    const r = await supabase.rpc('fn_obra_mao_obra_excluir', { p_id: id })
    if (r.error) { setErro(r.error.message); return }
    carregarLista()
  }

  const campo: React.CSSProperties = { padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', width: '100%', fontSize: 14 }
  const rot: React.CSSProperties = { display: 'block', fontSize: 12, color: MUT }
  const total = lista.reduce((a, l) => a + Number(l.valor ?? 0), 0)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/obras/resultado" style={{ color: GOLD, fontSize: 13 }}>← Resultado por obra</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Lançar horas na obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>As horas vezes o custo da hora entram no custo e na margem da obra.</p>
        {erro && <p role="alert" style={{ color: VERM }}>{erro}</p>}
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={rot}>Obra <AjudaCampo chave="projetos.horas_obra.obra" /> <select data-testid="horas-obra" value={obraId} onChange={e => setObraId(e.target.value)} style={campo}>
              <option value="">Escolha a obra</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}
            </select></label>
          </div>
          <div><label style={rot}>Data <AjudaCampo chave="projetos.horas_obra.data" /> <input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} style={campo} /></label></div>
          <div><label style={rot}>Função <AjudaCampo chave="projetos.horas_obra.funcao" /> <select value={f.funcao_id} onChange={e => escolherFuncao(e.target.value)} style={campo}>
              <option value="">Sem função</option>
              {funcoes.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select></label></div>
          <div><label style={rot}>Horas <AjudaCampo chave="projetos.horas_obra.horas" /> <input data-testid="horas-qtd" inputMode="decimal" value={f.horas} onChange={e => setF({ ...f, horas: e.target.value })} style={campo} placeholder="8" /></label></div>
          <div><label style={rot}>Custo da hora (R$) <AjudaCampo chave="projetos.horas_obra.custo_hora" /> <input data-testid="horas-custo" inputMode="decimal" value={f.custo_hora} onChange={e => setF({ ...f, custo_hora: e.target.value })} style={campo} placeholder="30,00" /></label></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={rot}>Descrição <AjudaCampo chave="projetos.horas_obra.descricao" /> <input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} style={campo} /></label></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button data-testid="horas-lancar" disabled={!valido || salvando} onClick={lancar}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: valido ? ESP : LINE, color: '#fff', fontWeight: 600 }}>
              {salvando ? 'Lançando…' : 'Lançar horas'}</button>
            <AjudaCampo chave="projetos.horas_obra.lancar" />
            {valido && <span style={{ fontSize: 13, color: MUT }}>Valor: {fmtR(horas * custoHora)}</span>}
          </div>
        </div>

        {obraId && (
          <div style={{ marginTop: 16 }}>
            {lista.length === 0
              ? <p data-testid="horas-vazio" style={{ fontSize: 13 }}>Nenhuma hora lançada nesta obra ainda. Preencha acima e clique em Lançar horas.</p>
              : (
                <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
                  <table data-testid="horas-tabela" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ color: MUT, textAlign: 'left' }}><th style={{ padding: 8 }}>Data</th><th>Descrição</th><th>Horas</th><th>Custo/h</th><th>Valor</th><th /></tr></thead>
                    <tbody>
                      {lista.map(l => (
                        <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                          <td style={{ padding: 8 }}>{l.data.split('-').reverse().join('/')}</td><td>{l.descricao ?? '—'}</td>
                          <td>{Number(l.horas)}</td><td>{fmtR(Number(l.custo_hora))}</td><td>{fmtR(Number(l.valor))}</td>
                          <td><button onClick={() => excluir(l.id)} style={{ color: VERM, background: 'none', border: 'none' }}>Excluir</button> <AjudaCampo chave="projetos.horas_obra.excluir" /></td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px solid ${LINE}`, fontWeight: 700 }}><td style={{ padding: 8 }} colSpan={4}>Total da obra</td><td>{fmtR(total)}</td><td /></tr>
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
