'use client'

// HB2 · Cadastro/edição do contrato de preços do cliente: regimes (adicional %), serviços com faixas de quantidade e
// código do cliente por regime. Grava tudo de uma vez por fn_tabela_preco_salvar (guarda de empresa no banco).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

export type FaixaE = { de: string; ate: string; preco: string }
export type ServicoE = { ref: string; nome: string; unidade: string; faixas: FaixaE[]; codigos: Record<string, string> }
export type RegimeE = { nome: string; pct: string }
export type ContratoE = { id: string | null; nome: string; ini: string; fim: string; regimes: RegimeE[]; servicos: ServicoE[] }

export const contratoVazio = (): ContratoE => ({
  id: null, nome: '', ini: new Date().toISOString().slice(0, 10), fim: '',
  regimes: [{ nome: 'noturno', pct: '20' }, { nome: 'sabado', pct: '50' }, { nome: 'domingo_feriado', pct: '100' }],
  servicos: [{ ref: '', nome: '', unidade: 'm²', faixas: [{ de: '0', ate: '', preco: '' }], codigos: {} }],
})

const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'))
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function ContratoEditor({ companyId, inicial, onSalvo, onCancelar }: { companyId: string; inicial: ContratoE; onSalvo: (id: string) => void; onCancelar: () => void }) {
  const [c, setC] = useState<ContratoE>(inicial)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const campo: React.CSSProperties = { padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP, width: '100%', minWidth: 0 }
  const rot: React.CSSProperties = { fontSize: 13, color: MUT, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }
  const setServ = (i: number, p: Partial<ServicoE>) => setC(x => ({ ...x, servicos: x.servicos.map((s, k) => (k === i ? { ...s, ...p } : s)) }))
  const setFaixa = (i: number, j: number, p: Partial<FaixaE>) => setC(x => ({ ...x, servicos: x.servicos.map((s, k) => (k === i ? { ...s, faixas: s.faixas.map((f, m) => (m === j ? { ...f, ...p } : f)) } : s)) }))
  const regimesValidos = c.regimes.filter(r => r.nome.trim())
  const colunas = ['normal', ...regimesValidos.map(r => r.nome.trim())]

  const validar = (): string => {
    if (c.nome.trim().length < 2) return 'Informe o nome do contrato.'
    if (c.fim && c.fim < c.ini) return 'A vigência termina antes de começar.'
    const refs = new Set<string>()
    for (const s of c.servicos) {
      if (!s.nome.trim()) return 'Todo serviço precisa de nome.'
      const ref = s.ref.trim() || slug(s.nome)
      if (refs.has(ref)) return `A referência "${ref}" está repetida.`
      refs.add(ref)
      if (s.faixas.some(f => f.preco.trim() === '' || !Number.isFinite(num(f.preco)) || num(f.preco) < 0)) return `Preencha o preço de todas as faixas de ${s.nome}.`
      const fx = s.faixas.map(f => ({ de: num(f.de || '0'), ate: f.ate.trim() ? num(f.ate) : null }))
      fx.sort((a, b) => a.de - b.de)
      for (let i = 0; i < fx.length; i++) {
        if (fx[i].ate != null && fx[i].ate! <= fx[i].de) return `Faixa inválida em ${s.nome}: o fim precisa ser maior que o início.`
        if (i > 0 && fx[i - 1].ate !== fx[i].de) return `Faixas de ${s.nome} com buraco ou sobreposição: cada faixa começa onde a anterior termina.`
      }
    }
    return ''
  }

  const salvar = async () => {
    const v = validar(); if (v) { setErro(v); return }
    setSalvando(true); setErro('')
    const dados = {
      nome: c.nome.trim(), vigencia_inicio: c.ini, vigencia_fim: c.fim || null,
      condicoes: regimesValidos.map(r => ({ condicao: r.nome.trim(), percentual: num(r.pct || '0') })),
      itens: c.servicos.flatMap(s => s.faixas.map(f => ({ servico_ref: s.ref.trim() || slug(s.nome), servico_nome: s.nome.trim(), unidade: s.unidade.trim() || 'm²', faixa_de: num(f.de || '0'), faixa_ate: f.ate.trim() ? num(f.ate) : null, preco_base: num(f.preco) }))),
      codigos: c.servicos.flatMap(s => colunas.filter(k => (s.codigos[k] ?? '').trim()).map(k => ({ servico_ref: s.ref.trim() || slug(s.nome), condicao: k, codigo_externo: s.codigos[k].trim() }))),
    }
    const { data, error } = await supabase.rpc('fn_tabela_preco_salvar', { p_company: companyId, p_tabela: c.id, p_dados: dados })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível salvar o contrato.')); return }
    onSalvo((data as { id: string }).id)
  }

  return (
    <section data-testid="tp-editor" style={{ background: '#fff', border: `1px solid ${GOLD}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
      <h2 style={{ fontSize: 18, margin: 0 }}>{c.id ? 'Editar contrato' : 'Novo contrato de preços'}</h2>
      <label><span style={rot}>Nome do contrato <AjudaCampo chave="hub.tabela_preco.nome" /></span>
        <input data-testid="tpe-nome" style={campo} value={c.nome} onChange={e => setC({ ...c, nome: e.target.value })} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <label><span style={rot}>Início da vigência <AjudaCampo chave="hub.tabela_preco.vigencia_ini" /></span>
          <input type="date" style={campo} value={c.ini} onChange={e => setC({ ...c, ini: e.target.value })} /></label>
        <label><span style={rot}>Fim da vigência <AjudaCampo chave="hub.tabela_preco.vigencia_fim" /></span>
          <input type="date" style={campo} value={c.fim} onChange={e => setC({ ...c, fim: e.target.value })} /></label>
      </div>
      <div>
        <span style={rot}>Regimes (adicional sobre o preço normal) <AjudaCampo chave="hub.tabela_preco.regime" /></span>
        {c.regimes.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input aria-label="Nome do regime" style={campo} value={r.nome} onChange={e => setC({ ...c, regimes: c.regimes.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)) })} />
            <input aria-label="Adicional em %" inputMode="decimal" style={{ ...campo, width: 90 }} value={r.pct} onChange={e => setC({ ...c, regimes: c.regimes.map((x, k) => (k === i ? { ...x, pct: e.target.value } : x)) })} />
            <span style={{ alignSelf: 'center', color: MUT }}>%</span>
            <AjudaCampo chave="hub.tabela_preco.regime" /><button type="button" aria-label="Remover regime" onClick={() => setC({ ...c, regimes: c.regimes.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setC({ ...c, regimes: [...c.regimes, { nome: '', pct: '0' }] })}>+ Regime</button>
      </div>
      {c.servicos.map((s, i) => (
        <div key={i} data-testid="tpe-servico" style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            <label><span style={rot}>Serviço <AjudaCampo chave="hub.tabela_preco.servico_novo" /></span>
              <input data-testid="tpe-serv-nome" style={campo} value={s.nome} onChange={e => setServ(i, { nome: e.target.value })} /></label>
            <label><span style={rot}>Unidade <AjudaCampo chave="hub.tabela_preco.servico_novo" /></span><input style={campo} value={s.unidade} onChange={e => setServ(i, { unidade: e.target.value })} /></label>
          </div>
          <div>
            <span style={rot}>Faixas de quantidade e preço <AjudaCampo chave="hub.tabela_preco.faixa" /></span>
            {s.faixas.map((f, j) => (
              <div key={j} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: 6, marginBottom: 6 }}>
                <input aria-label="De" inputMode="decimal" placeholder="de" style={campo} value={f.de} onChange={e => setFaixa(i, j, { de: e.target.value })} />
                <input aria-label="Até" inputMode="decimal" placeholder="até (vazio = em diante)" style={campo} value={f.ate} onChange={e => setFaixa(i, j, { ate: e.target.value })} />
                <input aria-label="Preço" data-testid="tpe-preco" inputMode="decimal" placeholder="R$/un" style={campo} value={f.preco} onChange={e => setFaixa(i, j, { preco: e.target.value })} />
                <AjudaCampo chave="hub.tabela_preco.faixa" /><button type="button" aria-label="Remover faixa" onClick={() => setServ(i, { faixas: s.faixas.filter((_, m) => m !== j) })}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => { const u = s.faixas[s.faixas.length - 1]; setServ(i, { faixas: [...s.faixas, { de: u?.ate ?? '', ate: '', preco: '' }] }) }}>+ Faixa</button>
          </div>
          <div>
            <span style={rot}>Código no cliente, por regime <AjudaCampo chave="hub.tabela_preco.codigo" /></span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 6 }}>
              {colunas.map(k => (
                <label key={k} style={{ fontSize: 12, color: MUT }}>{k} <AjudaCampo chave="hub.tabela_preco.codigo" />
                  <input style={campo} value={s.codigos[k] ?? ''} onChange={e => setServ(i, { codigos: { ...s.codigos, [k]: e.target.value } })} /></label>
              ))}
            </div>
          </div>
          {c.servicos.length > 1 && <button type="button" onClick={() => setC({ ...c, servicos: c.servicos.filter((_, k) => k !== i) })}>Remover serviço</button>}
        </div>
      ))}
      <button type="button" data-testid="tpe-add-servico" onClick={() => setC({ ...c, servicos: [...c.servicos, { ref: '', nome: '', unidade: 'm²', faixas: [{ de: '0', ate: '', preco: '' }], codigos: {} }] })}>+ Serviço</button>
      {erro && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{erro}</p>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" data-testid="tpe-salvar" disabled={salvando} onClick={salvar} style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '12px 20px', fontSize: 15, fontWeight: 700, minHeight: 44 }}>
          {salvando ? 'Salvando…' : 'Salvar contrato'}</button>
        <AjudaCampo chave="hub.tabela_preco.salvar" />
        <button type="button" onClick={onCancelar} style={{ minHeight: 44 }}>Cancelar</button>
      </div>
    </section>
  )
}
