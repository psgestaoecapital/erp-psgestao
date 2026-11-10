'use client'

// Gestão de Obras (CEO 01/11) · Custos em lançamento simples por obra (centro de custo = obra).
// Lança uma despesa da obra (material, mão de obra avulsa, terceiros, equipamento) direto no financeiro da
// empresa (erp_pagar) com o centro de custo da obra, pelas funções fn_obra_custo_lancar/_listar/_excluir.
// A despesa soma no "Total de custos da obra" (lista abaixo). A ligação automática desses lançamentos ao
// "Custo realizado" do Resultado por obra agora está FECHADA: v_obra_resultado_alocado consolida erp_pagar
// POR CENTRO DE CUSTO da obra (coluna custo_contas_pagar) — uma conta a pagar com o centro da obra entra
// sozinha no custo realizado e reflete na margem. MO POR HORA continua em "Lançar horas".
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C', VERDE = '#2E7D32'
// RD-95: a ajuda "?" é carregada por rota exata (fn_ajuda_campo_listar). Esta tela é rota dinâmica (/obras/[id]/custos):
// usePathname() traria o UUID real, que nunca casa com a linha de ajuda (gravada no padrão [id]). Fixamos a rota no padrão
// [id] para as chaves próprias (projetos.obra_custos.*) e, para os 2 KPIs reusados da tela "Resultado por obra"
// (Orçado/Saldo do custo), apontamos para a rota onde essas chaves de fato vivem.
const ROTA = '/dashboard/projetos/obras/[id]/custos'
const ROTA_RESULTADO = '/dashboard/projetos/obras/resultado'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const n = (v: unknown) => Number(v ?? 0)
const hoje = () => new Date().toISOString().slice(0, 10)
const CATEGORIAS = ['Material', 'Mão de obra', 'Terceiros', 'Equipamento', 'Outros'] as const

type Custo = { id: string; data: string; categoria: string; descricao: string; fornecedor_nome: string | null; valor: number; status: string; pago: boolean }
// ONDA 2 Hub — Orçado × Realizado × Saldo da obra, lido de v_obra_resultado_alocado (mesma fonte do Resultado por obra).
// Realizado = custo real alocado de TODAS as fontes (material, mão de obra, viagem/frota, custo fixo rateado), diferente
// do "Total de custos" da lista abaixo (só os lançamentos desta tela). Saldo = orçado − realizado (sem orçado → "—").
type ResumoObra = { custo_previsto: number; realizado: number; material: number; mao_obra: number; viagens: number; rateio: number; contas_pagar: number }

export default function CustosObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { companyIds } = useCompanyIds()
  const [itens, setItens] = useState<Custo[]>([])
  const [resumo, setResumo] = useState<ResumoObra | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [f, setF] = useState({ data: hoje(), categoria: 'Material' as string, descricao: '', valor: '', fornecedor_nome: '' })
  // RD-98 p2 · editar custo EM ABERTO (pago/conciliado é travado no servidor). `ed` = custo em edição; `ef` = o form.
  const [ed, setEd] = useState<Custo | null>(null)
  const [ef, setEf] = useState({ data: hoje(), categoria: 'Material' as string, descricao: '', valor: '', fornecedor_nome: '' })
  const [salvandoEd, setSalvandoEd] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro('')
    try {
      const r = await comPrazo(async () => await supabase.rpc('fn_obra_custo_listar', { p_obra_id: id }), { ms: 8000, tentativas: 1, label: 'custos' })
      if (r.error) { setErro(erroAmigavel(r.error, 'Não foi possível carregar os custos. Tente de novo.')); return }
      setItens((r.data ?? []) as Custo[])
      // Resumo Orçado × Realizado × Saldo da obra (mesma fonte do Resultado por obra). Falha aqui não quebra a lista.
      try {
        const rr = await supabase.from('v_obra_resultado_alocado')
          .select('custo_previsto,custo_material,custo_viagens,custo_mao_obra,custo_rateio,custo_contas_pagar')
          .eq('obra_id', id).in('company_id', companyIds).maybeSingle()
        if (!rr.error && rr.data) {
          const d = rr.data as Record<string, unknown>
          setResumo({ custo_previsto: n(d.custo_previsto), realizado: n(d.custo_material) + n(d.custo_viagens) + n(d.custo_mao_obra) + n(d.custo_rateio) + n(d.custo_contas_pagar), material: n(d.custo_material), mao_obra: n(d.custo_mao_obra), viagens: n(d.custo_viagens), rateio: n(d.custo_rateio), contas_pagar: n(d.custo_contas_pagar) })
        } else setResumo(null)
      } catch { setResumo(null) }
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds, id])
  useEffect(() => { carregar() }, [carregar])

  const lancar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro('')
    const valor = Number(f.valor.replace(/\./g, '').replace(',', '.'))
    if (!f.descricao.trim()) { setErro('Informe a descrição do custo.'); return }
    if (!(valor > 0)) { setErro('Informe um valor maior que zero.'); return }
    setSalvando(true)
    const { error } = await supabase.rpc('fn_obra_custo_lancar', {
      p_obra_id: id,
      p_dados: { data: f.data, categoria: f.categoria, descricao: f.descricao.trim(), valor, fornecedor_nome: f.fornecedor_nome.trim() || null },
    })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error)); return }
    setF({ data: f.data, categoria: f.categoria, descricao: '', valor: '', fornecedor_nome: '' })
    carregar()
  }

  const excluir = async (c: Custo) => {
    if (c.pago) { setErro('Este custo já foi pago/conciliado — não pode ser excluído aqui. Trate no financeiro.'); return }
    if (!window.confirm(`Excluir o custo "${c.descricao}" de ${brl(c.valor)}? Ele sai do custo da obra.`)) return
    const { error } = await supabase.rpc('fn_obra_custo_excluir', { p_pagar_id: c.id })
    if (error) { setErro(erroAmigavel(error)); return }
    carregar()
  }

  // RD-98 p2 · abre o editor pré-preenchido com o custo (valor em pt-BR); só custo EM ABERTO.
  const abrirEditar = (c: Custo) => {
    if (c.pago) { setErro('Este custo já foi pago/conciliado — não pode ser editado aqui. Trate no financeiro.'); return }
    setErro('')
    setEf({
      data: (c.data ?? hoje()).slice(0, 10),
      categoria: c.categoria || 'Material',
      descricao: c.descricao || '',
      valor: Number(c.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      fornecedor_nome: c.fornecedor_nome ?? '',
    })
    setEd(c)
  }
  const salvarEditar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ed) return
    setErro('')
    const valor = Number(ef.valor.replace(/\./g, '').replace(',', '.'))
    if (!ef.descricao.trim()) { setErro('Informe a descrição do custo.'); return }
    if (!(valor > 0)) { setErro('Informe um valor maior que zero.'); return }
    setSalvandoEd(true)
    const { error } = await supabase.rpc('fn_obra_custo_editar', {
      p_pagar_id: ed.id,
      p_dados: { data: ef.data, categoria: ef.categoria, descricao: ef.descricao.trim(), valor, fornecedor_nome: ef.fornecedor_nome.trim() },
    })
    setSalvandoEd(false)
    if (error) { setErro(erroAmigavel(error)); return }
    setEd(null)
    carregar()
  }

  const total = itens.reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const inp: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const lab: React.CSSProperties = { fontSize: 12, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ color: GOLD, fontSize: 13 }}>← Cockpit da obra</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Custos da obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>
          Cada custo lançado vira uma despesa no financeiro da empresa, com o centro de custo desta obra, e soma no Total de custos da obra (lista abaixo).
          Para mão de obra por hora, use <Link href={`/dashboard/projetos/obras/${id}/horas?area=hub`} style={{ color: GOLD }}>Lançar horas</Link>.
        </p>

        {resumo && (() => {
          const temOrcamento = resumo.custo_previsto > 0
          const saldo = resumo.custo_previsto - resumo.realizado
          // Composição do "Custo realizado" (5 fontes consolidadas de v_obra_resultado_alocado):
          // mostrar cada parcela faz o número grande se explicar sozinho e reconciliar com a lista abaixo (auditoria: os dois totais confundiam).
          const comp = [
            { k: 'Material', v: resumo.material },
            { k: 'Mão de obra', v: resumo.mao_obra },
            { k: 'Viagens', v: resumo.viagens },
            { k: 'Rateio', v: resumo.rateio },
            { k: 'Contas a pagar', v: resumo.contas_pagar },
          ].filter(c => c.v > 0)
          const cardS: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', flex: '1 1 160px' }
          const rotS: React.CSSProperties = { fontSize: 11, color: MUT, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }
          const valS: React.CSSProperties = { fontSize: 18, fontWeight: 700 }
          return (
            <div data-testid="custos-resumo" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div style={cardS}><div style={rotS}>Orçado <AjudaCampo chave="projetos.resultado_obra.custo_previsto" rota={ROTA_RESULTADO} /></div>
                <div style={valS} data-testid="custos-resumo-orcado">{temOrcamento ? brl(resumo.custo_previsto) : '—'}</div></div>
              <div style={{ ...cardS, flex: '1 1 240px' }}><div style={rotS}>Custo realizado (fontes consolidadas) <AjudaCampo chave="projetos.obra_custos.realizado" rota={ROTA} /></div>
                <div style={valS} data-testid="custos-resumo-realizado">{brl(resumo.realizado)}</div>
                <div data-testid="custos-resumo-composicao" style={{ fontSize: 10, color: MUT, marginTop: 3, lineHeight: 1.5 }}>
                  {comp.length > 0
                    ? <>{comp.map((c, i) => <span key={c.k}>{i > 0 ? ' · ' : ''}{c.k} {brl(c.v)}</span>)}</>
                    : <>Material, mão de obra, viagens, rateio e contas a pagar.</>}
                  <br />Não inclui as despesas diretas da lista abaixo — elas entram aqui conforme são conciliadas no financeiro.
                </div></div>
              <div style={cardS}><div style={rotS}>Saldo do custo <AjudaCampo chave="projetos.resultado_obra.saldo_custo" rota={ROTA_RESULTADO} /></div>
                <div style={{ ...valS, color: temOrcamento ? (saldo < 0 ? VERM : VERDE) : MUT }} data-testid="custos-resumo-saldo">{temOrcamento ? brl(saldo) : '—'}</div></div>
            </div>
          )
        })()}

        <form onSubmit={lancar} data-testid="custos-form" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <div><label style={lab}>Data</label>
            <input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} style={inp} data-testid="custos-data" /> <AjudaCampo chave="projetos.obra_custos.data" rota={ROTA} /></div>
          <div><label style={lab}>Categoria</label>
            <AjudaCampo chave="projetos.obra_custos.categoria" rota={ROTA} /> <select value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })} style={inp} data-testid="custos-categoria">
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label style={lab}>Valor (R$)</label>
            <input inputMode="decimal" value={f.valor} onChange={e => setF({ ...f, valor: e.target.value })} style={inp} data-testid="custos-valor" placeholder="0,00" /> <AjudaCampo chave="projetos.obra_custos.valor" rota={ROTA} /></div>
          <div><label style={lab}>Fornecedor</label>
            <input value={f.fornecedor_nome} onChange={e => setF({ ...f, fornecedor_nome: e.target.value })} style={inp} data-testid="custos-fornecedor" placeholder="Opcional" /> <AjudaCampo chave="projetos.obra_custos.fornecedor" rota={ROTA} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lab}>Descrição</label>
            <input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} style={inp} data-testid="custos-descricao" placeholder="O que foi comprado ou pago" /> <AjudaCampo chave="projetos.obra_custos.descricao" rota={ROTA} /></div>
          <div><button type="submit" disabled={salvando} data-testid="custos-lancar" style={{ padding: '9px 16px', background: ESP, color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}>{salvando ? 'Lançando…' : 'Lançar custo'}</button>
            <AjudaCampo chave="projetos.obra_custos.lancar" rota={ROTA} /></div>
        </form>

        {erro && <p role="alert" data-testid="custos-erro" style={{ color: VERM }}>{erro}</p>}
        {loading && <p data-testid="custos-carregando">Carregando…</p>}
        {!loading && itens.length === 0 && <p data-testid="custos-vazio">Nenhum custo lançado ainda. Preencha o formulário acima: a despesa entra no financeiro da empresa com o centro de custo desta obra e aparece no Total de custos da obra.</p>}
        {!loading && itens.length > 0 && (
          <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, marginTop: 12 }}>
            <table data-testid="custos-tabela" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `1px solid ${LINE}`, color: MUT, textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Data</th><th style={{ padding: 8 }}>Categoria</th><th style={{ padding: 8 }}>Descrição</th>
                <th style={{ padding: 8 }}>Fornecedor</th><th style={{ padding: 8, textAlign: 'right' }}>Valor</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Situação <AjudaCampo chave="projetos.obra_custos.total" rota={ROTA} /></th><th /></tr></thead>
              <tbody>
                {itens.map(c => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: 8 }}>{c.data}</td>
                    <td style={{ padding: 8 }}>{c.categoria}</td>
                    <td style={{ padding: 8 }}>{c.descricao}</td>
                    <td style={{ padding: 8 }}>{c.fornecedor_nome ?? '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{brl(Number(c.valor))}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{c.pago ? <span style={{ color: '#3B5A1E', fontWeight: 600 }}>Pago/conciliado</span> : <span style={{ color: MUT }}>Em aberto</span>}</td>
                    <td style={{ padding: 8 }}>
                      {c.pago
                        ? <span style={{ color: MUT, fontSize: 12 }} title="Custo pago/conciliado: trate no financeiro">—</span>
                        : <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                            <button onClick={() => abrirEditar(c)} data-testid="custos-editar" style={{ color: ESP, background: 'none', border: 0, cursor: 'pointer' }}>Editar <AjudaCampo chave="projetos.obra_custos.editar" rota={ROTA} /></button>
                            <button onClick={() => excluir(c)} data-testid="custos-excluir" style={{ color: VERM, background: 'none', border: 0, cursor: 'pointer' }}>Excluir <AjudaCampo chave="projetos.obra_custos.excluir" rota={ROTA} /></button>
                          </span>}
                    </td>
                  </tr>))}
                <tr style={{ fontWeight: 700 }}><td colSpan={4} style={{ padding: 8 }}>Total de despesas diretas lançadas aqui</td><td style={{ padding: 8, textAlign: 'right' }} data-testid="custos-total">{brl(total)}</td><td colSpan={2} /></tr>
              </tbody>
            </table>
          </div>)}
        {!loading && itens.length > 0 && (
          <p data-testid="custos-reconciliacao" style={{ fontSize: 12, color: MUT, marginTop: 8 }}>
            Este total soma <strong>só</strong> as despesas diretas lançadas nesta tela. O <strong>Custo realizado (fontes consolidadas)</strong> do card acima — e o do{' '}
            <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ color: GOLD }}>Cockpit</Link> — reúne material dos pedidos de compra, viagens e mão de obra por hora,
            por isso costuma ser bem maior que o desta lista. As despesas daqui passam a somar no custo realizado conforme são conciliadas no financeiro. <AjudaCampo chave="projetos.obra_custos.reconciliacao" rota={ROTA} />
          </p>)}
      </div>

      {ed && (
        <div role="dialog" aria-label="Editar custo da obra" onClick={() => !salvandoEd && setEd(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 16 }}>
          <form onSubmit={salvarEditar} onClick={e => e.stopPropagation()} data-testid="custos-editar-form"
            style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, width: '100%', maxWidth: 460, display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Editar custo da obra</div>
            <div><label style={lab}>Data</label>
              <input type="date" value={ef.data} onChange={e => setEf({ ...ef, data: e.target.value })} style={inp} data-testid="custos-editar-data" /> <AjudaCampo chave="projetos.obra_custos.data" rota={ROTA} /></div>
            <div><label style={lab}>Categoria</label>
              <AjudaCampo chave="projetos.obra_custos.categoria" rota={ROTA} /> <select value={ef.categoria} onChange={e => setEf({ ...ef, categoria: e.target.value })} style={inp} data-testid="custos-editar-categoria">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label style={lab}>Valor (R$)</label>
              <input inputMode="decimal" value={ef.valor} onChange={e => setEf({ ...ef, valor: e.target.value })} style={inp} data-testid="custos-editar-valor" placeholder="0,00" /> <AjudaCampo chave="projetos.obra_custos.valor" rota={ROTA} /></div>
            <div><label style={lab}>Fornecedor</label>
              <input value={ef.fornecedor_nome} onChange={e => setEf({ ...ef, fornecedor_nome: e.target.value })} style={inp} data-testid="custos-editar-fornecedor" placeholder="Opcional" /> <AjudaCampo chave="projetos.obra_custos.fornecedor" rota={ROTA} /></div>
            <div><label style={lab}>Descrição</label>
              <input value={ef.descricao} onChange={e => setEf({ ...ef, descricao: e.target.value })} style={inp} data-testid="custos-editar-descricao" placeholder="O que foi comprado ou pago" /> <AjudaCampo chave="projetos.obra_custos.descricao" rota={ROTA} /></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={() => setEd(null)} disabled={salvandoEd} style={{ padding: '9px 16px', background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 8, cursor: 'pointer' }}>Cancelar</button>
              <button type="submit" disabled={salvandoEd} data-testid="custos-editar-salvar" style={{ padding: '9px 16px', background: ESP, color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: salvandoEd ? 'wait' : 'pointer' }}>{salvandoEd ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        </div>)}
    </div>
  )
}
