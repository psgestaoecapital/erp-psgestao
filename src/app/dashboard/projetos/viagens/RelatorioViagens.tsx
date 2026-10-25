'use client'

// Relatório de custo de viagem (Eng. Chefe 24/10 · onda 2): por obra e por viagem, só leitura do fn_viagem_relatorio —
// a MESMA conta do Resultado da obra (v_viagem_custo_obra). A tela não calcula nada: mostra e confere ("Confere").
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF'
type Obra = { id: string; numero: string; nome: string }
type RelObra = { obra_id: string; numero: string; nome: string; viagens: number; custo_periodo: number; custo_direto: number; custo_rateado: number; custo_todas_viagens: number; custo_no_resultado: number; confere: boolean }
type RelViagem = { viagem_id: string; numero: number; colaborador: string; periodo_inicio: string; status: string; total: number; km_rodado: number | null; custo_km: number | null }
type Rel = { viagens: RelViagem[]; obras: RelObra[]; totais: { viagens: number; total: number; km_rodado: number; custo_km: number | null }; confere: boolean }
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (s: string) => s.split('-').reverse().join('/')
const campo = 'w-full rounded-lg border px-2 py-1.5 text-sm'

export function RelatorioViagens({ empresa, obras }: { empresa: string; obras: Obra[] }) {
  const [ini, setIni] = useState('')
  const [fim, setFim] = useState('')
  const [obra, setObra] = useState('')
  const [rel, setRel] = useState<Rel | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_viagem_relatorio', { p_company_id: empresa, p_ini: ini || null, p_fim: fim || null, p_obra_id: obra || null })
    if (error) { setErro(error.message); setRel(null); return }
    setErro(''); setRel(data as Rel)
  }, [empresa, ini, fim, obra])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- recarrega ao mudar os filtros
  useEffect(() => { carregar() }, [carregar])

  return (
    <section className="mt-6 space-y-3" aria-label="Relatório de custo de viagem">
      <h2 className="text-lg font-semibold">Custo de viagem por obra</h2>
      <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-3" style={{ borderColor: LINE }}>
        <Filtro rotulo="Saída de" ajuda="projetos.viagem.rel_periodo"><input type="date" className={campo} value={ini} onChange={(e) => setIni(e.target.value)} /></Filtro>
        <Filtro rotulo="Saída até" ajuda="projetos.viagem.rel_periodo"><input type="date" className={campo} value={fim} onChange={(e) => setFim(e.target.value)} /></Filtro>
        <Filtro rotulo="Obra" ajuda="projetos.viagem.rel_obra"><select className={campo} value={obra} onChange={(e) => setObra(e.target.value)}><option value="">Todas as obras</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select></Filtro>
      </div>
      {erro && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{erro}</div>}
      {rel && (rel.viagens.length === 0
        ? <p className="rounded-xl border bg-white p-6 text-center text-sm" style={{ borderColor: LINE }}>Nenhuma viagem neste filtro.</p>
        : <>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Indicador rotulo="Viagens" ajuda="projetos.viagem.rel_viagens" valor={String(rel.totais.viagens)} />
            <Indicador rotulo="Custo das viagens" ajuda="projetos.viagem.rel_total" valor={brl(rel.totais.total)} />
            <Indicador rotulo="Km rodado" ajuda="projetos.viagem.rel_km" valor={`${rel.totais.km_rodado ?? 0} km`} />
            <Indicador rotulo="Custo por km" ajuda="projetos.viagem.rel_custo_km" valor={rel.totais.custo_km != null ? brl(rel.totais.custo_km) : '—'} />
          </div>
          <ul className="space-y-2">{rel.obras.map((o) => (
            <li key={o.obra_id} className="rounded-xl border bg-white p-3 text-sm" style={{ borderColor: LINE }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><b>{o.numero} · {o.nome}</b>
                <span className="text-xs font-medium" style={{ color: o.confere ? ESP : '#B42318' }}>{o.confere ? 'Confere com o Resultado' : 'Não confere — avise o suporte'}<AjudaCampo chave="projetos.viagem.rel_confere" /></span></div>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>Viagens<AjudaCampo chave="projetos.viagem.rel_viagens" /><br /><b>{o.viagens}</b></div>
                <div>No período<AjudaCampo chave="projetos.viagem.rel_custo_obra" /><br /><b>{brl(o.custo_periodo)}</b></div>
                <div>Dividido entre obras<AjudaCampo chave="projetos.viagem.lanc_rateio" /><br /><b>{brl(o.custo_rateado)}</b></div>
                <div>No Resultado da obra<AjudaCampo chave="projetos.viagem.rel_confere" /><br /><b style={{ color: GOLD }}>{brl(o.custo_no_resultado)}</b></div>
              </div></li>))}</ul>
          <div className="overflow-x-auto rounded-xl border bg-white" style={{ borderColor: LINE }}>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs opacity-70">
              <th className="p-2">Viagem<AjudaCampo chave="projetos.viagem.card_viagem" /></th><th className="p-2">Custo<AjudaCampo chave="projetos.viagem.rel_total" /></th>
              <th className="p-2">Km<AjudaCampo chave="projetos.viagem.rel_km" /></th><th className="p-2">Custo/km<AjudaCampo chave="projetos.viagem.rel_custo_km" /></th></tr></thead>
              <tbody>{rel.viagens.map((v) => (
                <tr key={v.viagem_id} className="border-t" style={{ borderColor: LINE }}>
                  <td className="p-2"><b>{v.numero}</b> · {v.colaborador}<br /><span className="text-xs opacity-60">{dt(v.periodo_inicio)} · {v.status}</span></td>
                  <td className="p-2">{brl(v.total)}</td><td className="p-2">{v.km_rodado ?? '—'}</td><td className="p-2">{v.custo_km != null ? brl(v.custo_km) : '—'}</td></tr>))}</tbody></table>
          </div>
        </>)}
    </section>
  )
}

function Filtro({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs"><span>{rotulo}<AjudaCampo chave={ajuda} /></span>{children}</label>
}
function Indicador({ rotulo, ajuda, valor }: { rotulo: string; ajuda: string; valor: string }) {
  return <div className="rounded-xl border bg-white p-3" style={{ borderColor: LINE }}>{rotulo}<AjudaCampo chave={ajuda} /><br /><b>{valor}</b></div>
}
