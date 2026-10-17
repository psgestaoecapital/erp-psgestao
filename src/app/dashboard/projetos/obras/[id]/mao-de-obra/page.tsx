'use client'

// HB1 · Lançar horas de mão de obra na obra — usa fn_obra_mao_obra_apontar / fn_obra_mao_obra_excluir (#2687).
// O custo entra na v_obra_resultado_alocado (Resultado por obra). Incluir, listar e excluir (exclusão lógica).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const campo: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' }

type Funcao = { id: string; nome: string; custo_hora_manual: number | null }
type Apont = { id: string; data: string; funcao_id: string | null; descricao: string | null; horas: number; custo_hora: number; valor: number }

export default function MaoDeObraObraPage() {
  const { id: obraId } = useParams<{ id: string }>()
  const { companyIds } = useCompanyIds()
  const [funcoes, setFuncoes] = useState<Funcao[]>([])
  const [itens, setItens] = useState<Apont[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ data: new Date().toISOString().slice(0, 10), funcao_id: '', descricao: '', horas: '', custo_hora: '' })

  const carregar = useCallback(async () => {
    if (!companyIds?.length || !obraId) { setLoading(false); return }
    setLoading(true); setErro('')
    const [a, fn] = await Promise.all([
      supabase.from('projetos_obra_mao_obra_apontamento').select('id,data,funcao_id,descricao,horas,custo_hora,valor')
        .eq('obra_id', obraId).is('excluido_em', null).order('data', { ascending: false }),
      supabase.from('erp_funcao_mao_obra').select('id,nome,custo_hora_manual').in('company_id', companyIds).eq('ativo', true).order('nome'),
    ])
    if (a.error) setErro(a.error.message)
    else { setItens((a.data ?? []) as Apont[]); setFuncoes((fn.data ?? []) as Funcao[]) }
    setLoading(false)
  }, [companyIds, obraId])
  useEffect(() => { carregar() }, [carregar])

  const escolherFuncao = (fid: string) => {
    const fu = funcoes.find(x => x.id === fid)
    setF(p => ({ ...p, funcao_id: fid, custo_hora: fu?.custo_hora_manual ? String(fu.custo_hora_manual) : p.custo_hora }))
  }

  const lancar = async () => {
    const horas = Number(f.horas.replace(',', '.')), custo = Number(f.custo_hora.replace(',', '.'))
    if (!(horas > 0)) { setErro('Informe as horas (maior que zero).'); return }
    if (!(custo >= 0) || f.custo_hora === '') { setErro('Informe o custo da hora.'); return }
    setBusy(true); setErro('')
    const { error } = await supabase.rpc('fn_obra_mao_obra_apontar', {
      p_obra_id: obraId,
      p_dados: { data: f.data, funcao_id: f.funcao_id || '', descricao: f.descricao.trim() || null, horas, custo_hora: custo },
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setF(p => ({ ...p, descricao: '', horas: '' }))
    carregar()
  }

  const excluir = async (id: string) => {
    if (!window.confirm('Excluir este lançamento de horas? O custo sai do resultado da obra.')) return
    const { error } = await supabase.rpc('fn_obra_mao_obra_excluir', { p_id: id })
    if (error) { setErro(error.message); return }
    carregar()
  }

  const total = itens.reduce((s, i) => s + Number(i.valor ?? 0), 0)
  const rot: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, color: MUT }
  const nomeFuncao = (id: string | null) => funcoes.find(x => x.id === id)?.nome ?? '—'

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }} data-testid="obra-mao-de-obra">
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${obraId}/cockpit`} style={{ color: GOLD, fontSize: 13 }}>← Cockpit da obra</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Mão de obra da obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>Lance as horas da equipe: o custo entra no resultado da obra.</p>

        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
          <label style={rot}><span>Data<AjudaCampo chave="projetos.obra_mo.data" /></span>
            <input type="date" data-testid="mo-data" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} style={campo} /></label>
          <label style={rot}><span>Função<AjudaCampo chave="projetos.obra_mo.funcao" /></span>
            <select data-testid="mo-funcao" value={f.funcao_id} onChange={e => escolherFuncao(e.target.value)} style={campo}>
              <option value="">Sem função (informar o custo)</option>
              {funcoes.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select></label>
          <label style={rot}><span>Horas<AjudaCampo chave="projetos.obra_mo.horas" /></span>
            <input inputMode="decimal" data-testid="mo-horas" value={f.horas} onChange={e => setF({ ...f, horas: e.target.value })} style={campo} placeholder="8" /></label>
          <label style={rot}><span>Custo da hora (R$)<AjudaCampo chave="projetos.obra_mo.custo_hora" /></span>
            <input inputMode="decimal" data-testid="mo-custo" value={f.custo_hora} onChange={e => setF({ ...f, custo_hora: e.target.value })} style={campo} placeholder="30,00" /></label>
          <label style={rot}><span>Observação<AjudaCampo chave="projetos.obra_mo.descricao" /></span>
            <input data-testid="mo-descricao" value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} style={campo} /></label>
          {erro && <p role="alert" style={{ color: VERM, margin: 0, fontSize: 13 }}>{erro}</p>}
          <button data-testid="mo-lancar" onClick={lancar} disabled={busy}
            style={{ padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontWeight: 600 }}>
            {busy ? 'Lançando…' : 'Lançar horas'}</button>
        </div>

        <h2 style={{ fontSize: 16, margin: '18px 0 8px' }}>Lançamentos <AjudaCampo chave="projetos.obra_mo.lista" /></h2>
        {loading && <p>Carregando…</p>}
        {!loading && itens.length === 0 && <p data-testid="mo-vazio" style={{ color: MUT }}>Nenhuma hora lançada nesta obra. Preencha o formulário acima: o custo aparece no Resultado por obra.</p>}
        {itens.map(i => (
          <div key={i.id} data-testid="mo-item" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13 }}>
              <strong>{nomeFuncao(i.funcao_id)}</strong> · {new Date(i.data + 'T12:00:00').toLocaleDateString('pt-BR')}
              <div style={{ color: MUT }}>{i.horas} h × {fmtR(Number(i.custo_hora))}{i.descricao ? ` · ${i.descricao}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>{fmtR(Number(i.valor))}</div>
              <button onClick={() => excluir(i.id)} aria-label="Excluir lançamento" style={{ border: 'none', background: 'none', color: VERM, fontSize: 12 }}>Excluir</button>
            </div>
          </div>
        ))}
        {itens.length > 0 && <p data-testid="mo-total" style={{ textAlign: 'right', fontWeight: 700 }}>Total: {fmtR(total)}</p>}
        <Link href="/dashboard/projetos/obras/resultado" style={{ color: GOLD, fontSize: 13 }}>Ver o Resultado por obra →</Link>
      </div>
    </div>
  )
}
