'use client'

// HB1 · Lançar horas na obra — grava pelas funções da #2687 (fn_obra_mao_obra_apontar / _excluir), fonte única do custo de MO por obra.
// Incluir e excluir (exclusão lógica, com confirmação); o custo entra sozinho no Resultado por obra.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
// Moeda com centavos (padrão das telas irmãs de obra: Obras lista e Resultado) — R$ 100,00
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Funcao = { id: string; nome: string; custo_hora_manual: number | null }
type Apont = { id: string; data: string; funcao_id: string | null; descricao: string | null; horas: number; custo_hora: number; valor: number }

const hoje = () => new Date().toISOString().slice(0, 10)

export default function LancarHorasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { companyIds } = useCompanyIds()
  const [funcoes, setFuncoes] = useState<Funcao[]>([])
  const [itens, setItens] = useState<Apont[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [f, setF] = useState({ data: hoje(), funcao_id: '', descricao: '', horas: '', custo_hora: '' })

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro('')
    try {
      const [a, b] = await Promise.all([
        comPrazo(async () => await supabase.from('projetos_obra_mao_obra_apontamento')
          .select('id,data,funcao_id,descricao,horas,custo_hora,valor').eq('obra_id', id).is('excluido_em', null).order('data', { ascending: false }),
          { ms: 8000, tentativas: 1, label: 'apontamentos' }),
        comPrazo(async () => await supabase.from('erp_funcao_mao_obra').select('id,nome,custo_hora_manual').in('company_id', companyIds).eq('ativo', true).order('nome'),
          { ms: 8000, tentativas: 1, label: 'funcoes' }),
      ])
      if (a.error) { setErro(erroAmigavel(a.error, 'Não foi possível carregar os lançamentos. Tente de novo.')); return }
      setItens((a.data ?? []) as Apont[]); setFuncoes((b.data ?? []) as Funcao[])
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds, id])
  useEffect(() => { carregar() }, [carregar])

  const escolherFuncao = (fid: string) => {
    const fn = funcoes.find(x => x.id === fid)
    setF(p => ({ ...p, funcao_id: fid, custo_hora: fn?.custo_hora_manual != null && !p.custo_hora ? String(fn.custo_hora_manual) : p.custo_hora }))
  }

  const lancar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro('')
    const horas = Number(f.horas.replace(',', '.')), custo = Number(f.custo_hora.replace(',', '.'))
    if (!(horas > 0)) { setErro('Informe as horas trabalhadas (maior que zero).'); return }
    if (!(custo >= 0) || f.custo_hora === '') { setErro('Informe o custo da hora.'); return }
    setSalvando(true)
    const { error } = await supabase.rpc('fn_obra_mao_obra_apontar', { p_obra_id: id, p_dados: { data: f.data, funcao_id: f.funcao_id, descricao: f.descricao || null, horas, custo_hora: custo } })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error)); return }
    setF({ data: f.data, funcao_id: f.funcao_id, descricao: '', horas: '', custo_hora: f.custo_hora })
    carregar()
  }

  const excluir = async (a: Apont) => {
    if (!window.confirm(`Excluir o lançamento de ${a.horas} h em ${a.data}? Ele sai do custo da obra.`)) return
    const { error } = await supabase.rpc('fn_obra_mao_obra_excluir', { p_id: a.id })
    if (error) { setErro(erroAmigavel(error)); return }
    carregar()
  }

  const total = itens.reduce((s, a) => s + Number(a.valor ?? 0), 0)
  const nomeFn = (fid: string | null) => funcoes.find(x => x.id === fid)?.nome ?? '—'
  const inp: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const lab: React.CSSProperties = { fontSize: 12, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ color: GOLD, fontSize: 13 }}>← Cockpit da obra</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Lançar horas na obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>Cada lançamento vira custo de mão de obra e aparece no Resultado por obra.</p>

        <form onSubmit={lancar} data-testid="horas-form" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <div><label style={lab}>Data</label>
            <input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} style={inp} data-testid="horas-data" /> <AjudaCampo chave="projetos.horas_obra.data" /></div>
          <div><label style={lab}>Função</label>
            <AjudaCampo chave="projetos.horas_obra.funcao" /> <select value={f.funcao_id} onChange={e => escolherFuncao(e.target.value)} style={inp} data-testid="horas-funcao">
              <option value="">Sem função</option>{funcoes.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></div>
          <div><label style={lab}>Horas</label>
            <input inputMode="decimal" value={f.horas} onChange={e => setF({ ...f, horas: e.target.value })} style={inp} data-testid="horas-horas" /> <AjudaCampo chave="projetos.horas_obra.horas" /></div>
          <div><label style={lab}>Custo da hora (R$)</label>
            <input inputMode="decimal" value={f.custo_hora} onChange={e => setF({ ...f, custo_hora: e.target.value })} style={inp} data-testid="horas-custo" /> <AjudaCampo chave="projetos.horas_obra.custo_hora" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lab}>O que foi feito</label>
            <input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} style={inp} data-testid="horas-descricao" /> <AjudaCampo chave="projetos.horas_obra.descricao" /></div>
          <div><button type="submit" disabled={salvando} data-testid="horas-lancar" style={{ padding: '9px 16px', background: ESP, color: '#fff', border: 0, borderRadius: 8, fontWeight: 600 }}>{salvando ? 'Lançando…' : 'Lançar horas'}</button>
            <AjudaCampo chave="projetos.horas_obra.lancar" /></div>
        </form>

        {erro && <p role="alert" style={{ color: VERM }}>{erro}</p>}
        {loading && <p data-testid="horas-carregando">Carregando…</p>}
        {!loading && itens.length === 0 && <p data-testid="horas-vazio">Nenhuma hora lançada ainda. Preencha o formulário acima: o custo aparece no Resultado por obra.</p>}
        {!loading && itens.length > 0 && (
          <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, marginTop: 12 }}>
            <table data-testid="horas-tabela" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `1px solid ${LINE}`, color: MUT, textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Data</th><th style={{ padding: 8 }}>Função</th><th style={{ padding: 8 }}>Atividade</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Horas</th><th style={{ padding: 8, textAlign: 'right' }}>R$/h</th><th style={{ padding: 8, textAlign: 'right' }}>Custo</th><th /></tr></thead>
              <tbody>
                {itens.map(a => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: 8 }}>{a.data}</td><td style={{ padding: 8 }}>{nomeFn(a.funcao_id)}</td><td style={{ padding: 8 }}>{a.descricao ?? ''}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{a.horas}</td><td style={{ padding: 8, textAlign: 'right' }}>{brl(Number(a.custo_hora))}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{brl(Number(a.valor))}</td>
                    <td style={{ padding: 8 }}><button onClick={() => excluir(a)} data-testid="horas-excluir" style={{ color: VERM, background: 'none', border: 0, cursor: 'pointer' }}>Excluir</button></td>
                  </tr>))}
                <tr style={{ fontWeight: 700 }}><td colSpan={5} style={{ padding: 8 }}>Total de mão de obra</td><td style={{ padding: 8, textAlign: 'right' }} data-testid="horas-total">{brl(total)}</td><td /></tr>
              </tbody>
            </table>
          </div>)}
      </div>
    </div>
  )
}
