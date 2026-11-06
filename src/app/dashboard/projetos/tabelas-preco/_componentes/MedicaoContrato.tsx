'use client'

// HB2 · Medição ao cliente (tela 273): quantidade medida × serviço × regime → faixa, adicional, preço, código do cliente
// e total. Cada linha sai por fn_tabela_preco_medir, a MESMA regra do contrato (o número bate com a tabela).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { SaldoContrato } from './SaldoContrato'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// Data sempre em dd/mm/aaaa (o seletor nativo <input type="date"> segue a língua do navegador e,
// num navegador em inglês, mostra mm/dd — o eco abaixo deixa o formato BR explícito).
const fmtData = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '')

type Linha = { servico_ref: string; quantidade: string; condicao: string }
type Res = { ok: boolean; erro?: string; servico_ref?: string; quantidade: number; faixa_de?: number; faixa_ate?: number | null; condicao?: string; preco_unitario?: number; total?: number; codigo_externo?: string | null; unidade?: string }

export function MedicaoContrato({ tabelaId, servicos, regimes, podeGravar }: { tabelaId: string; podeGravar: boolean; servicos: { ref: string; nome: string; unidade: string }[]; regimes: string[] }) {
  const [linhas, setLinhas] = useState<Linha[]>([{ servico_ref: servicos[0]?.ref ?? '', quantidade: '', condicao: 'normal' }])
  const [res, setRes] = useState<{ linhas: Res[]; total: number } | null>(null)
  const [erro, setErro] = useState('')
  const [desc, setDesc] = useState('')
  const [ini, setIni] = useState('')
  const [fim, setFim] = useState('')
  const [msg, setMsg] = useState('')
  const [versao, setVersao] = useState(0)
  const [salvas, setSalvas] = useState<{ id: string; descricao: string; periodo_inicio: string | null; periodo_fim: string | null; total: number }[]>([])
  const carregarSalvas = useCallback(async () => {
    const { data } = await supabase.from('erp_medicao_cliente').select('id,descricao,periodo_inicio,periodo_fim,total').eq('tabela_id', tabelaId).is('deleted_at', null).order('criado_em', { ascending: false }).limit(20)
    setSalvas(((data ?? []) as typeof salvas).map(x => ({ ...x, total: Number(x.total) })))
  }, [tabelaId])
  useEffect(() => { carregarSalvas() }, [carregarSalvas])
  const linhasValidas = () => linhas.filter(l => l.servico_ref && Number(l.quantidade.replace(',', '.')) > 0).map(l => ({ servico_ref: l.servico_ref, quantidade: Number(l.quantidade.replace(',', '.')), condicao: l.condicao }))
  const gravar = async () => {
    setErro(''); setMsg('')
    if (!desc.trim()) { setErro('Dê um nome à medição para salvar.'); return }
    const v = linhasValidas()
    if (!v.length) { setErro('Informe a quantidade medida de pelo menos um serviço.'); return }
    const { data, error } = await supabase.rpc('fn_medicao_cliente_salvar', { p_tabela: tabelaId, p_dados: { descricao: desc, periodo_inicio: ini, periodo_fim: fim, linhas: v } })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível salvar a medição.')); return }
    setMsg(`Medição salva: ${fmtR(Number((data as { total: number }).total))}.`); setDesc(''); carregarSalvas(); setVersao(v => v + 1)
  }
  // Detalhe da medição salva (linhas) e conferência: recalcula pelo contrato de hoje e compara com o total salvo.
  type ItemSalvo = { servico_ref: string; quantidade: number; condicao: string; preco_unitario: number; total: number; codigo_externo: string | null }
  const [aberta, setAberta] = useState<{ id: string; itens: ItemSalvo[]; confere: string } | null>(null)
  const ver = async (m: { id: string; total: number }) => {
    if (aberta?.id === m.id) { setAberta(null); return }
    const { data, error } = await supabase.from('erp_medicao_cliente_item').select('servico_ref,quantidade,condicao,preco_unitario,total,codigo_externo').eq('medicao_id', m.id).order('servico_ref')
    if (error) { setErro(erroAmigavel(error, 'Não foi possível abrir a medição.')); return }
    setAberta({ id: m.id, itens: ((data ?? []) as ItemSalvo[]).map(x => ({ ...x, quantidade: Number(x.quantidade), preco_unitario: Number(x.preco_unitario), total: Number(x.total) })), confere: '' })
  }
  const conferir = async (m: { total: number }) => {
    if (!aberta) return
    const { data, error } = await supabase.rpc('fn_tabela_preco_medir', { p_tabela: tabelaId, p_linhas: aberta.itens.map(i => ({ servico_ref: i.servico_ref, quantidade: i.quantidade, condicao: i.condicao })) })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível conferir com o contrato.')); return }
    const novo = Number((data as { total: number }).total)
    const dif = Math.round((novo - m.total) * 100) / 100
    setAberta({ ...aberta, confere: dif === 0 ? `Bate com o contrato: ${fmtR(novo)}.` : `O contrato hoje dá ${fmtR(novo)} (diferença de ${fmtR(dif)} em relação à medição salva).` })
  }
  const excluir = async (id: string) => {
    if (!window.confirm('Excluir esta medição salva?')) return
    const { error } = await supabase.rpc('fn_medicao_cliente_excluir', { p_id: id })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível excluir a medição.')); return }
    carregarSalvas(); setVersao(v => v + 1)
  }

  // Exportação do extrato (XLS e PDF). PDF = janela de impressão do navegador ("Salvar como PDF"), sem biblioteca extra.
  type LinhaExp = { servico: string; qtd: number; regime: string; codigo: string; unitario: number; total: number }
  const exportar = async (formato: 'xls' | 'pdf', titulo: string, itens: LinhaExp[]) => {
    const total = itens.reduce((a, i) => a + i.total, 0)
    if (formato === 'xls') {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Medição')
      ws.addRow([titulo]); ws.addRow([])
      ws.addRow(['Serviço', 'Quantidade', 'Regime', 'Código do cliente', 'Unitário (R$)', 'Total (R$)'])
      itens.forEach(i => ws.addRow([i.servico, i.qtd, i.regime, i.codigo, i.unitario, i.total]))
      ws.addRow(['Total da medição', '', '', '', '', Math.round(total * 100) / 100])
      const buf = await wb.xlsx.writeBuffer()
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `${titulo.replace(/[^\w-]+/g, '_')}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
      return
    }
    const esc = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
    const w = window.open('', '_blank')
    if (!w) { setErro('O navegador bloqueou a janela do PDF. Libere pop-ups e tente de novo.'); return }
    w.document.write(`<html><head><title>${esc(titulo)}</title><style>body{font-family:sans-serif;color:#3D2314;padding:24px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #E7DECF;padding:6px;text-align:left}th:nth-child(n+5),td:nth-child(n+5){text-align:right}</style></head><body><h2>${esc(titulo)}</h2><div class="overflow-x-auto" style="overflow-x:auto"><table><tr><th>Serviço</th><th>Qtd</th><th>Regime</th><th>Código</th><th>Unitário</th><th>Total</th></tr>${itens.map(i => `<tr><td>${esc(i.servico)}</td><td>${i.qtd}</td><td>${esc(i.regime)}</td><td>${esc(i.codigo)}</td><td>${fmtR(i.unitario)}</td><td>${fmtR(i.total)}</td></tr>`).join('')}</table></div><h3 style="text-align:right">Total da medição: ${fmtR(total)}</h3></body></html>`)
    w.document.close(); w.focus(); w.print()
  }
  const BotoesExportar = ({ titulo, itens, id }: { titulo: string; itens: LinhaExp[]; id: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button type="button" data-testid={`${id}-xls`} onClick={() => exportar('xls', titulo, itens)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${GOLD}`, background: '#fff', color: ESP, fontWeight: 600 }}>Exportar XLS</button>
      <button type="button" data-testid={`${id}-pdf`} onClick={() => exportar('pdf', titulo, itens)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${GOLD}`, background: '#fff', color: ESP, fontWeight: 600 }}>Exportar PDF</button>
      <AjudaCampo chave="hub.tabela_preco.medicao_exportar" />
    </div>
  )
  const campo: React.CSSProperties = { padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP, width: '100%', minWidth: 0 }
  const nome = (r?: string) => servicos.find(s => s.ref === r)?.nome ?? r ?? ''
  const setL = (i: number, p: Partial<Linha>) => setLinhas(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))

  const medir = async () => {
    setErro('')
    const validas = linhas.filter(l => l.servico_ref && Number(l.quantidade.replace(',', '.')) > 0)
    if (!validas.length) { setErro('Informe a quantidade medida de pelo menos um serviço.'); return }
    const { data, error } = await supabase.rpc('fn_tabela_preco_medir', { p_tabela: tabelaId, p_linhas: validas.map(l => ({ servico_ref: l.servico_ref, quantidade: Number(l.quantidade.replace(',', '.')), condicao: l.condicao })) })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível calcular a medição.')); return }
    setRes(data as { linhas: Res[]; total: number })
  }

  return (
    <>
    <section data-testid="tp-medicao" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16, display: 'grid', gap: 12 }}>
      <h2 style={{ fontSize: 17, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>Medição ao cliente <AjudaCampo chave="hub.tabela_preco.medicao" /></h2>
      <p style={{ fontSize: 13, color: MUT, margin: 0, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>Informe o que foi medido no período: o preço sai pela faixa e pelo regime do contrato, com o código do cliente.<AjudaCampo chave="hub.tabela_preco.medicao_colunas" /></p>
      {linhas.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
          <label style={{ fontSize: 12, color: MUT }}>Serviço <AjudaCampo chave="hub.tabela_preco.servico" />
            <select aria-label="Serviço medido" style={campo} value={l.servico_ref} onChange={e => setL(i, { servico_ref: e.target.value })}>
              {servicos.map(s => <option key={s.ref} value={s.ref}>{s.nome} ({s.unidade})</option>)}
            </select></label>
          <label style={{ fontSize: 12, color: MUT }}>Quantidade <AjudaCampo chave="hub.tabela_preco.medicao_qtd" />
            <input aria-label="Quantidade medida" data-testid="med-qtd" inputMode="decimal" placeholder="quantidade" style={campo} value={l.quantidade} onChange={e => setL(i, { quantidade: e.target.value })} /></label>
          <label style={{ fontSize: 12, color: MUT }}>Regime <AjudaCampo chave="hub.tabela_preco.condicao" />
            <select aria-label="Regime" style={campo} value={l.condicao} onChange={e => setL(i, { condicao: e.target.value })}>
              <option value="normal">Normal</option>{regimes.map(r => <option key={r} value={r}>{r}</option>)}
            </select></label>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={{ minHeight: 44 }} onClick={() => setLinhas(ls => [...ls, { servico_ref: servicos[0]?.ref ?? '', quantidade: '', condicao: 'normal' }])}>+ Linha</button>
        <button type="button" data-testid="med-calcular" onClick={medir} style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '12px 20px', fontWeight: 700, minHeight: 44 }}>Calcular medição</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        <label style={{ fontSize: 12, color: MUT }}>Descrição <AjudaCampo chave="hub.tabela_preco.medicao_descricao" />
          <input aria-label="Descrição da medição" data-testid="med-desc" style={campo} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Medição outubro/2026" /></label>
        <label style={{ fontSize: 12, color: MUT }}>Período <AjudaCampo chave="hub.tabela_preco.medicao_periodo" />
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" aria-label="Início do período" style={campo} value={ini} onChange={e => setIni(e.target.value)} />
            <input type="date" aria-label="Fim do período" style={campo} value={fim} onChange={e => setFim(e.target.value)} />
          </div>
          <span data-testid="med-periodo-br" style={{ fontSize: 11, color: MUT, display: 'block', marginTop: 3 }}>
            {ini || fim ? `${fmtData(ini) || '—'} a ${fmtData(fim) || '—'}` : 'Formato dd/mm/aaaa'}
          </span></label>
      </div>
      {podeGravar && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" data-testid="med-salvar" onClick={gravar} style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${GOLD}`, background: '#fff', color: ESP, fontWeight: 700 }}>Salvar medição</button>
        <AjudaCampo chave="hub.tabela_preco.medicao_salvar" />
      </div>}
      {msg && <p role="status" data-testid="med-msg" style={{ margin: 0, color: GOLD, fontWeight: 600 }}>{msg}</p>}
      {erro && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{erro}</p>}
      {res && (
        <div data-testid="med-extrato" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 520 }}>
            <thead><tr style={{ color: MUT, textAlign: 'left' }}><th>Serviço</th><th>Qtd</th><th>Regime</th><th>Código</th><th style={{ textAlign: 'right' }}>Unitário</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>{res.linhas.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td>{nome(r.servico_ref)}</td><td>{r.quantidade}</td><td>{r.condicao ?? ''}</td>
                <td>{r.ok ? (r.codigo_externo ?? 'sem código') : ''}</td>
                <td style={{ textAlign: 'right' }}>{r.ok ? fmtR(r.preco_unitario!) : r.erro}</td>
                <td style={{ textAlign: 'right' }}>{r.ok ? fmtR(r.total!) : '—'}</td>
              </tr>))}</tbody>
          </table>
          <div style={{ textAlign: 'right', fontSize: 18, marginTop: 8 }} data-testid="med-total">Total da medição: <b>{fmtR(res.total)}</b></div>
          <BotoesExportar id="med-calc" titulo={desc.trim() || 'Medição ao cliente'} itens={res.linhas.filter(r => r.ok).map(r => ({ servico: nome(r.servico_ref), qtd: r.quantidade, regime: r.condicao ?? '', codigo: r.codigo_externo ?? 'sem código', unitario: r.preco_unitario!, total: r.total! }))} />
        </div>
      )}
      {salvas.length > 0 && (
        <div data-testid="med-salvas" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>Medições salvas <AjudaCampo chave="hub.tabela_preco.medicao_salvas" /></div>
          {salvas.map(m => (
            <div key={m.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${LINE}`, fontSize: 14 }}>
              <span>{m.descricao}{m.periodo_inicio ? ` · ${new Date(`${m.periodo_inicio}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}{m.periodo_fim ? ` a ${new Date(`${m.periodo_fim}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><b>{fmtR(m.total)}</b>
                <button type="button" data-testid="med-ver" onClick={() => ver(m)} style={{ background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, color: GOLD, fontWeight: 600 }}>{aberta?.id === m.id ? 'Fechar' : 'Ver itens'}</button>
                <AjudaCampo chave="hub.tabela_preco.medicao_ver" />
                {podeGravar && <button type="button" onClick={() => excluir(m.id)} style={{ color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44 }}>Excluir</button>}</span>
            </div>
            {aberta?.id === m.id && (
              <div data-testid="med-detalhe" style={{ padding: '8px 0', overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 480 }}>
                  <thead><tr style={{ color: MUT, textAlign: 'left' }}><th>Serviço</th><th>Qtd</th><th>Regime</th><th>Código</th><th style={{ textAlign: 'right' }}>Unitário</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>{aberta.itens.map((i, k) => (
                    <tr key={k} style={{ borderTop: `1px solid ${LINE}` }}><td>{nome(i.servico_ref)}</td><td>{i.quantidade}</td><td>{i.condicao}</td><td>{i.codigo_externo ?? 'sem código'}</td><td style={{ textAlign: 'right' }}>{fmtR(i.preco_unitario)}</td><td style={{ textAlign: 'right' }}>{fmtR(i.total)}</td></tr>))}</tbody>
                </table>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <button type="button" data-testid="med-conferir" onClick={() => conferir(m)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${GOLD}`, background: '#fff', color: ESP, fontWeight: 600 }}>Conferir com o contrato</button>
                  <AjudaCampo chave="hub.tabela_preco.medicao_conferir" />
                </div>
                <BotoesExportar id="med-salva" titulo={m.descricao} itens={aberta.itens.map(i => ({ servico: nome(i.servico_ref), qtd: i.quantidade, regime: i.condicao, codigo: i.codigo_externo ?? 'sem código', unitario: i.preco_unitario, total: i.total }))} />
                {aberta.confere && <p role="status" data-testid="med-confere" style={{ margin: '6px 0 0', color: GOLD, fontWeight: 600 }}>{aberta.confere}</p>}
              </div>
            )}
            </div>
          ))}
        </div>
      )}
    </section>
    <SaldoContrato tabelaId={tabelaId} servicos={servicos} podeGravar={podeGravar} recarregar={versao} />
    </>
  )
}
