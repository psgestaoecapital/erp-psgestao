'use client'

// HB2 · Vínculo com o catálogo: cada serviço do contrato aponta para um serviço do catálogo; o custo da CPU vem de lá.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
// m², m2, M^2 → m2; ml → m: a comparação de unidade ignora grafia, só avisa quando a grandeza difere.
const normUn = (u?: string | null) => (u ?? '').toLowerCase().replace(/²/g, '2').replace(/³/g, '3').replace(/[^a-z0-9]/g, '').replace(/^ml$/, 'm')
const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export type VinculoCpu = { servico_ref: string; custo_unitario: number | null }
type Vinculo = { servico_ref: string; catalogo_id: string; codigo: string | null; nome: string; unidade?: string | null; custo_unitario: number | null }
type Catalogo = { id: string; codigo: string | null; nome: string; unidade: string | null }

export function VinculoCatalogo({ tabelaId, companyId, servicos, podeGravar, onCpu }: {
  tabelaId: string; companyId: string; podeGravar: boolean
  servicos: { ref: string; nome: string; unidade: string }[]
  onCpu: (v: VinculoCpu[]) => void
}) {
  const [vinc, setVinc] = useState<Vinculo[]>([])
  const [cat, setCat] = useState<Catalogo[]>([])
  const [erro, setErro] = useState('')
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_tabela_preco_vinculos', { p_tabela: tabelaId })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar os vínculos com o catálogo.')); return }
    setErro('')
    const l = ((data as { linhas: Vinculo[] }).linhas ?? []).map(x => ({ ...x, custo_unitario: x.custo_unitario == null ? null : Number(x.custo_unitario) }))
    setVinc(l); onCpu(l.map(x => ({ servico_ref: x.servico_ref, custo_unitario: x.custo_unitario })))
  }, [tabelaId, onCpu])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    supabase.from('projetos_servicos').select('id,codigo,nome,unidade').or(`company_id.eq.${companyId},is_publico.eq.true`).eq('ativo', true).order('nome').limit(500)
      .then(({ data }) => setCat((data ?? []) as Catalogo[]))
  }, [companyId])
  const gravar = async (ref: string, id: string) => {
    const { error } = await supabase.rpc('fn_tabela_preco_vinculo_gravar', { p_tabela: tabelaId, p_servico_ref: ref, p_catalogo: id || null })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível gravar o vínculo.')); return }
    carregar()
  }
  return (
    <section data-testid="tp-vinculo" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16, display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 17, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>Vínculo com o catálogo <AjudaCampo chave="hub.tabela_preco.vinculo" /></h2>
      <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Ligue cada serviço do contrato ao serviço do catálogo: o custo da CPU vem de lá e a margem sai sozinha.</p>
      {erro && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{erro}</p>}
      {servicos.map(s => {
        const v = vinc.find(x => x.servico_ref === s.ref)
        return (
          <div key={s.ref} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
            <span style={{ flex: '1 1 200px', color: ESP }}>{s.nome} ({s.unidade})</span>
            {podeGravar ? (
              <label style={{ fontSize: 12, color: MUT, flex: '1 1 220px' }}>Serviço do catálogo <AjudaCampo chave="hub.tabela_preco.vinculo_catalogo" />
                <select aria-label={`Catálogo de ${s.nome}`} data-testid={`vinc-${s.ref}`} value={v?.catalogo_id ?? ''} onChange={e => gravar(s.ref, e.target.value)}
                  style={{ display: 'block', width: '100%', padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP }}>
                  <option value="">Sem vínculo</option>
                  {cat.map(c => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nome}{c.unidade ? ` (${c.unidade})` : ''}</option>)}
                </select></label>
            ) : <span style={{ color: MUT }}>{v ? v.nome : 'Sem vínculo'}</span>}
            <span style={{ fontSize: 13, color: MUT, minWidth: 110 }}>{v ? (v.custo_unitario != null ? `CPU ${fmtR(v.custo_unitario)}` : 'Sem custo no catálogo') : ''}</span>
            {v && v.unidade && normUn(v.unidade) !== normUn(s.unidade) && (
              <span role="alert" data-testid={`vinc-un-${s.ref}`} style={{ flexBasis: '100%', fontSize: 13, color: '#B45309' }}>
                Atenção: o contrato cobra em {s.unidade} e o catálogo custa em {v.unidade}. A margem só vale com a mesma unidade.
              </span>
            )}
          </div>
        )
      })}
    </section>
  )
}
