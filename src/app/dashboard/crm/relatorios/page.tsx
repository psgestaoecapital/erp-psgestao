'use client'
// PS CRM · Relatórios do funil (fn_crm_relatorio): quantos chegaram a cada etapa (conversão), quanto tempo ficam em
// cada uma, ranking por vendedor e por que se perde. Vendedor vê só os números da própria carteira (o banco filtra).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { C, Campo, Titulo, Cabecalho, Pagina, Aviso, Vazio, SemEmpresa, inp, cartao, brl, useCrm } from '@/components/crm/crmUi'

type Rel = {
  total: number; ganhos: number; perdidos: number; valor_ganho: number
  funil: { etapa: string; qtd: number }[]
  tempo_por_etapa: { etapa: string; dias_medio: number; passagens: number }[]
  ranking: { responsavel: string; ganhos: number; perdidos: number; abertos: number; valor_ganho: number }[]
  motivos_perda: { motivo: string; qtd: number }[]
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function CrmRelatoriosPage() {
  const { empresa, cfg, erro: erroCfg, carregando } = useCrm()
  const funis = useMemo(() => cfg?.funis ?? [], [cfg])
  const [funilId, setFunilId] = useState('')
  const [de, setDe] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 90); return iso(d) })
  const [ate, setAte] = useState(() => iso(new Date()))
  const [rel, setRel] = useState<Rel | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { if (!funilId && funis.length) setFunilId(funis[0].id) }, [funis, funilId])
  const carregar = useCallback(async () => {
    if (!empresa || !funilId || !de || !ate) return
    const { data, error } = await supabase.rpc('fn_crm_relatorio', { p_company_id: empresa, p_funil_id: funilId, p_de: de, p_ate: ate })
    if (error) { setErro(erroAmigavel(error)); return }
    setErro(null); setRel(data as Rel)
  }, [empresa, funilId, de, ate])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/sincronia ao trocar empresa, funil ou filtro
  useEffect(() => { void carregar() }, [carregar])

  if (carregando) return <Pagina><div style={{ color: C.TEXTM }}>Carregando…</div></Pagina>
  if (!empresa) return <Pagina><Cabecalho titulo="Relatórios" /><SemEmpresa /></Pagina>
  if (!cfg) return <Pagina><Cabecalho titulo="Relatórios" /><Aviso texto={erroCfg ?? 'Não foi possível abrir o CRM.'} /></Pagina>

  const fechados = rel ? rel.ganhos + rel.perdidos : 0
  const taxa = rel && fechados > 0 ? Math.round((rel.ganhos / fechados) * 100) : null
  const maxFunil = Math.max(1, ...(rel?.funil.map((f) => f.qtd) ?? [1]))
  const maxTempo = Math.max(1, ...(rel?.tempo_por_etapa.map((t) => Number(t.dias_medio)) ?? [1]))
  const maxMotivo = Math.max(1, ...(rel?.motivos_perda.map((m) => m.qtd) ?? [1]))
  const barra = (v: number, max: number, cor: string) => (
    <div style={{ flex: 1, background: C.OFFWHITE, borderRadius: 6, height: 14, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: cor, height: '100%', borderRadius: 6 }} />
    </div>
  )
  const linha = { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }

  return (
    <Pagina>
      <Cabecalho titulo="Relatórios" subtitulo="Negócios criados no período escolhido." />
      <Aviso texto={erro} onFechar={() => setErro(null)} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Campo rotulo="Funil" ajuda="crm.relatorios.funil" largura={200}>
          <select style={inp} value={funilId} onChange={(e) => setFunilId(e.target.value)}>
            {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="De" ajuda="crm.relatorios.periodo" largura={150}><input style={inp} type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo rotulo="Até" ajuda="crm.relatorios.periodo" largura={150}><input style={inp} type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
      </div>

      {rel && rel.total === 0 && <Vazio texto="Nenhum negócio criado neste período. Amplie as datas ou escolha outro funil." />}
      {rel && rel.total > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Negócios', v: String(rel.total) }, { l: 'Ganhos', v: String(rel.ganhos) }, { l: 'Perdidos', v: String(rel.perdidos) },
              { l: 'Taxa de ganho', v: taxa == null ? '—' : `${taxa}%` }, { l: 'Valor ganho', v: brl(rel.valor_ganho) },
            ].map((k) => (
              <div key={k.l} style={{ ...cartao, padding: 12 }}>
                <div style={{ fontSize: 12, color: C.TEXTM }}>{k.l}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <section style={cartao} data-testid="crm-rel-conversao">
              <Titulo texto="Até onde os negócios chegam" ajuda="crm.relatorios.conversao" />
              {rel.funil.map((f, i) => (
                <div key={f.etapa} style={linha}>
                  <span style={{ width: 120, flex: '0 0 auto' }}>{f.etapa}</span>
                  {barra(f.qtd, maxFunil, C.DOURADO)}
                  <span style={{ width: 70, textAlign: 'right', flex: '0 0 auto' }}>{f.qtd}{i > 0 && rel.funil[0].qtd > 0 ? ` · ${Math.round((f.qtd / rel.funil[0].qtd) * 100)}%` : ''}</span>
                </div>
              ))}
            </section>
            <section style={cartao}>
              <Titulo texto="Tempo médio em cada etapa" ajuda="crm.relatorios.tempo" />
              {rel.tempo_por_etapa.length === 0 && <div style={{ fontSize: 13, color: C.TEXTM }}>Ainda sem movimentações no período.</div>}
              {rel.tempo_por_etapa.map((t) => (
                <div key={t.etapa} style={linha}>
                  <span style={{ width: 120, flex: '0 0 auto' }}>{t.etapa}</span>
                  {barra(Number(t.dias_medio), maxTempo, C.ESPRESSO)}
                  <span style={{ width: 70, textAlign: 'right', flex: '0 0 auto' }}>{Number(t.dias_medio).toLocaleString('pt-BR')} d</span>
                </div>
              ))}
            </section>
            <section style={cartao}>
              <Titulo texto="Por vendedor" ajuda="crm.relatorios.ranking" />
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: C.TEXTM, textAlign: 'left' }}><th>Vendedor</th><th>Ganhos</th><th>Perdidos</th><th>Abertos</th><th style={{ textAlign: 'right' }}>Valor ganho</th></tr></thead>
                <tbody>
                  {rel.ranking.map((r) => (
                    <tr key={r.responsavel} style={{ borderTop: `1px solid ${C.BORDA}` }}>
                      <td style={{ padding: '6px 0' }}>{r.responsavel}</td><td>{r.ganhos}</td><td>{r.perdidos}</td><td>{r.abertos}</td><td style={{ textAlign: 'right' }}>{brl(r.valor_ganho)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section style={cartao}>
              <Titulo texto="Por que perdemos" ajuda="crm.relatorios.motivos" />
              {rel.motivos_perda.length === 0 && <div style={{ fontSize: 13, color: C.TEXTM }}>Nenhum negócio perdido no período.</div>}
              {rel.motivos_perda.map((m) => (
                <div key={m.motivo} style={linha}>
                  <span style={{ width: 120, flex: '0 0 auto' }}>{m.motivo}</span>
                  {barra(m.qtd, maxMotivo, C.RED)}
                  <span style={{ width: 40, textAlign: 'right', flex: '0 0 auto' }}>{m.qtd}</span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </Pagina>
  )
}
