'use client'

// #6714 (Oficina) · Custos avulsos (sem nota fiscal) de uma OS.
// Fornecedores que não emitem NF por serviço prestado: lançar o custo aqui para o custo real
// da OS ficar completo (hoje só vem das notas de entrada). Incluir / editar / excluir (RD-98),
// "?" em cada campo (RD-95). Escopo por empresa garantido pela RLS + guarda das RPCs.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { Plus, PencilLine, Trash2, X } from 'lucide-react'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80',
  white: '#FFFFFF', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15',
  red: '#EF4444', neutralBg: '#F5F2EB',
}
const fmtBRL = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (d?: string | null) => {
  if (!d) return '—'
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  return y && m && dd ? `${dd}/${m}/${y}` : String(d)
}
// "1.234,56" / "1234.56" → número
const parseBRL = (s: string) => {
  const t = s.trim().replace(/\s/g, '')
  if (!t) return NaN
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return Number(norm)
}

interface Custo {
  id: string
  descricao: string
  fornecedor: string | null
  categoria: string | null
  valor: number
  data_custo: string
  observacao: string | null
}

const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function OSCustosAvulsos({ companyId, osId }: { companyId: string; osId: string }) {
  const [itens, setItens] = useState<Custo[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [dataCusto, setDataCusto] = useState(hojeISO())
  const [observacao, setObservacao] = useState('')

  const carregar = useCallback(async () => {
    if (!companyId || !osId) return
    setCarregando(true)
    const { data, error } = await supabase.rpc('fn_os_custo_avulso_listar', { p_company_id: companyId, p_os_id: osId })
    setCarregando(false)
    if (error) { setErro('Não consegui carregar os custos avulsos agora.'); return }
    const r = (data ?? {}) as { ok?: boolean; itens?: Custo[]; total?: number }
    if (r.ok) { setItens(r.itens ?? []); setTotal(Number(r.total ?? 0)); setErro(null) }
  }, [companyId, osId])

  useEffect(() => { void carregar() }, [carregar])

  function limpar() {
    setDescricao(''); setValor(''); setFornecedor(''); setDataCusto(hojeISO()); setObservacao('')
    setEditId(null); setForm(false)
  }

  function abrirEdicao(c: Custo) {
    setEditId(c.id); setForm(true); setErro(null)
    setDescricao(c.descricao); setValor(String(c.valor).replace('.', ','))
    setFornecedor(c.fornecedor ?? ''); setDataCusto((c.data_custo || hojeISO()).slice(0, 10))
    setObservacao(c.observacao ?? '')
  }

  async function salvar() {
    const v = parseBRL(valor)
    if (!descricao.trim()) { setErro('Informe a descrição do custo.'); return }
    if (!Number.isFinite(v) || v <= 0) { setErro('Informe um valor maior que zero.'); return }
    setSalvando(true); setErro(null)
    const comum = {
      p_descricao: descricao.trim(), p_valor: v,
      p_fornecedor: fornecedor.trim() || null, p_categoria: null,
      p_data_custo: dataCusto || null, p_observacao: observacao.trim() || null,
    }
    const { data, error } = editId
      ? await supabase.rpc('fn_os_custo_avulso_editar', { p_id: editId, ...comum })
      : await supabase.rpc('fn_os_custo_avulso_adicionar', { p_company_id: companyId, p_os_id: osId, ...comum })
    setSalvando(false)
    if (error) { setErro('Não consegui salvar o custo agora. Tente de novo.'); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível salvar.'); return }
    limpar(); await carregar()
  }

  async function excluir(c: Custo) {
    if (!confirm(`Excluir o custo "${c.descricao}" (${fmtBRL(c.valor)})?`)) return
    const { data, error } = await supabase.rpc('fn_os_custo_avulso_excluir', { p_id: c.id })
    if (error) { setErro('Não consegui excluir agora. Tente de novo.'); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível excluir.'); return }
    await carregar()
  }

  const lbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: C.espressoM, marginBottom: 2 }
  const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', minHeight: 40, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.espresso, background: C.white, boxSizing: 'border-box' }
  const botao = (bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: bg === 'none' ? C.gold : C.white, background: bg, border: bg === 'none' ? `1px solid ${C.gold}` : 'none', borderRadius: 8, padding: '8px 12px', minHeight: 40, cursor: 'pointer' })

  return (
    <div data-testid="os-custos-avulsos" style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, background: C.white, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.espresso, flex: 1 }}>
          Custos avulsos (sem nota) {itens.length > 0 && <span style={{ color: C.espressoL, fontWeight: 500 }}>· {itens.length}</span>}
        </div>
        {total > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{fmtBRL(total)}</span>}
        {!form && (
          <button type="button" data-testid="os-custo-incluir" onClick={() => { setForm(true); setEditId(null); setErro(null) }} style={botao('none')}>
            <Plus size={14} strokeWidth={1.75} /> Incluir custo
          </button>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 11, color: C.espressoL }}>
        Para custos pagos a fornecedores que não emitem nota fiscal. Entram no custo real desta OS.
      </p>

      {carregando && <span style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic' }}>Carregando…</span>}

      {!carregando && itens.length === 0 && !form && (
        <div style={{ fontSize: 12, color: C.espressoM, background: C.neutralBg, borderRadius: 8, padding: '10px 12px' }}>
          Nenhum custo avulso lançado. Use <strong>Incluir custo</strong> para lançar um gasto sem nota (ex.: mão de obra de terceiro).
        </div>
      )}

      {itens.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.espressoL }}>
              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Descrição</th>
              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Fornecedor</th>
              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Data</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Valor</th>
              <th style={{ padding: '4px 6px', fontWeight: 600 }}></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '6px', color: C.espresso }}>
                  {c.descricao}
                  {c.observacao && <span style={{ display: 'block', fontSize: 10, color: C.espressoL }}>{c.observacao}</span>}
                </td>
                <td style={{ padding: '6px', color: C.espressoM }}>{c.fornecedor ?? '—'}</td>
                <td style={{ padding: '6px', color: C.espressoM, whiteSpace: 'nowrap' }}>{fmtData(c.data_custo)}</td>
                <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: C.espresso, whiteSpace: 'nowrap' }}>{fmtBRL(c.valor)}</td>
                <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                  <button type="button" aria-label="Editar custo" onClick={() => abrirEdicao(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.gold, padding: 4, minHeight: 32 }}>
                    <PencilLine size={15} strokeWidth={1.5} />
                  </button>
                  <button type="button" aria-label="Excluir custo" data-testid="os-custo-excluir" onClick={() => void excluir(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, padding: 4, minHeight: 32 }}>
                    <Trash2 size={15} strokeWidth={1.5} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div data-testid="os-custo-form" style={{ display: 'flex', flexDirection: 'column', gap: 8, background: C.neutralBg, borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ flex: 1, fontSize: 12, color: C.espresso }}>{editId ? 'Editar custo' : 'Novo custo avulso'}</strong>
            <button type="button" aria-label="Cancelar" onClick={limpar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM, padding: 4 }}><X size={16} /></button>
          </div>

          <label>
            <span style={lbl}>Descrição do custo <AjudaCampo chave="oficina.os.custo_avulso.descricao" rota="/dashboard/os" /></span>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Mão de obra de terceiro — funilaria" style={inp} />
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 120px' }}>
              <span style={lbl}>Valor (R$) <AjudaCampo chave="oficina.os.custo_avulso.valor" rota="/dashboard/os" /></span>
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" style={inp} />
            </label>
            <label style={{ flex: '1 1 140px' }}>
              <span style={lbl}>Fornecedor (opcional) <AjudaCampo chave="oficina.os.custo_avulso.fornecedor" rota="/dashboard/os" /></span>
              <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Quem recebeu" style={inp} />
            </label>
            <label style={{ flex: '1 1 130px' }}>
              <span style={lbl}>Data do custo <AjudaCampo chave="oficina.os.custo_avulso.data" rota="/dashboard/os" /></span>
              <input type="date" value={dataCusto} onChange={(e) => setDataCusto(e.target.value)} style={inp} />
            </label>
          </div>

          <label>
            <span style={lbl}>Observação (opcional) <AjudaCampo chave="oficina.os.custo_avulso.observacao" rota="/dashboard/os" /></span>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Ex.: Recibo nº 42, pago em dinheiro" style={{ ...inp, resize: 'vertical' }} />
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={limpar} style={botao('none')}>Cancelar</button>
            <button type="button" data-testid="os-custo-salvar" disabled={salvando} onClick={() => void salvar()} style={{ ...botao(C.gold), opacity: salvando ? 0.6 : 1 }}>
              {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Adicionar custo'}
            </button>
          </div>
        </div>
      )}

      {erro && <p style={{ margin: 0, fontSize: 12, color: C.red }}>❌ {erro}</p>}
    </div>
  )
}
