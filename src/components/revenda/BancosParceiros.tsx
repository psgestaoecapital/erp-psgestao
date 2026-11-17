'use client'

// Revenda · Chamado #8162 (etapa 2) — Cadastro de "Bancos parceiros" de financiamento.
// Seção nova da Configuração da garagem (/dashboard/revenda/config), separada das contas
// bancárias da própria empresa (erp_banco_*). Grava em veic_banco_parceiro (tabela aditiva da
// etapa 1, RLS por company_id). Aqui a garagem cadastra os bancos que pagam retorno sobre o
// financiamento: nome, % de retorno sobre o valor financiado e prazo médio de pagamento (dias).
// A seleção do banco na venda e a geração da receita vêm nas etapas seguintes.
// RD-98: incluir/editar/excluir visíveis. RD-95: "?" em cada campo. Erro sempre em linguagem
// do usuário (RD-98 e) — nunca a mensagem crua do Postgres.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parseNumBR } from '@/lib/num'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5',
  red: '#A32D2D', redBg: '#FDECEC',
}
const ROTA = '/dashboard/revenda/config'

type Banco = {
  id: string
  nome: string
  retorno_pct: number | null
  prazo_dias: number | null
  ativo: boolean
}
type Form = { nome: string; retorno_pct: string; prazo_dias: string; ativo: boolean }
const VAZIO: Form = { nome: '', retorno_pct: '', prazo_dias: '', ativo: true }

// Chamado #5660: aceitar vírgula como separador decimal (e ponto de milhar) no % de
// retorno. Reusa a fonte única parseNumBR (src/lib/num.ts): "2,5"→2.5, "1.234,56"→1234.56.
// Antes, Number("1.234,56".replace(',','.'))="1.234.56"→NaN zerava o valor silenciosamente.
const decOrNull = (s: string): number | null => parseNumBR(s)
const intOrNull = (s: string): number | null => {
  const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}
const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)

export function BancosParceiros({ companyId }: { companyId: string | null }) {
  const [lista, setLista] = useState<Banco[]>([])
  const [carregando, setCarregando] = useState(true)
  const [form, setForm] = useState<Form>(VAZIO)
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setLista([]); setCarregando(false); return }
    setCarregando(true)
    const { data, error } = await supabase
      .from('veic_banco_parceiro')
      .select('id, nome, retorno_pct, prazo_dias, ativo')
      .eq('company_id', companyId)
      .order('ativo', { ascending: false })
      .order('nome', { ascending: true })
    if (error) { setErro('Não foi possível carregar os bancos parceiros. Tente recarregar a página.'); setLista([]) }
    else { setErro(null); setLista((data ?? []) as Banco[]) }
    setCarregando(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  function limpar() { setForm(VAZIO); setEditId(null); setErro(null) }

  function editar(b: Banco) {
    setEditId(b.id)
    setForm({
      nome: b.nome ?? '',
      retorno_pct: b.retorno_pct == null ? '' : String(b.retorno_pct).replace('.', ','),
      prazo_dias: b.prazo_dias == null ? '' : String(b.prazo_dias),
      ativo: b.ativo,
    })
    setErro(null); setMsg(null)
  }

  async function salvar() {
    if (!companyId) { setErro('Selecione uma empresa para cadastrar bancos parceiros.'); return }
    const nome = form.nome.trim()
    if (!nome) { setErro('Informe o nome do banco parceiro.'); return }
    const retorno = decOrNull(form.retorno_pct)
    if (form.retorno_pct.trim() !== '' && (retorno == null || retorno < 0)) {
      setErro('O % de retorno deve ser um número válido (ex.: 2 ou 2,5). Nada foi gravado.'); return
    }
    const prazo = intOrNull(form.prazo_dias)
    if (form.prazo_dias.trim() !== '' && (prazo == null || prazo < 0)) {
      setErro('O prazo deve ser um número inteiro de dias (ex.: 30). Nada foi gravado.'); return
    }
    setBusy(true); setErro(null); setMsg(null)
    const payload = { nome, retorno_pct: retorno, prazo_dias: prazo, ativo: form.ativo }
    let dbErr
    if (editId) {
      const { error } = await supabase.from('veic_banco_parceiro').update(payload).eq('id', editId).eq('company_id', companyId)
      dbErr = error
    } else {
      const { error } = await supabase.from('veic_banco_parceiro').insert({ ...payload, company_id: companyId })
      dbErr = error
    }
    setBusy(false)
    if (dbErr) {
      const dup = (dbErr.code === '23505') || /duplicate|ux_veic_banco_parceiro_company_nome|unique/i.test(dbErr.message || '')
      setErro(dup
        ? `Já existe um banco parceiro chamado "${nome}" nesta empresa. Use outro nome ou edite o existente.`
        : 'Não foi possível salvar o banco parceiro. Confira os dados e tente de novo.')
      return
    }
    setMsg(editId ? 'Banco parceiro atualizado.' : 'Banco parceiro cadastrado.')
    limpar()
    await carregar()
  }

  async function excluir(b: Banco) {
    if (!companyId) return
    if (!window.confirm(`Excluir o banco parceiro "${b.nome}"? As vendas já registradas com ele não são alteradas.`)) return
    setBusy(true); setErro(null); setMsg(null)
    const { error } = await supabase.from('veic_banco_parceiro').delete().eq('id', b.id).eq('company_id', companyId)
    setBusy(false)
    if (error) { setErro('Não foi possível excluir. Tente novamente.'); return }
    setMsg('Banco parceiro excluído.')
    if (editId === b.id) limpar()
    await carregar()
  }

  async function alternarAtivo(b: Banco) {
    if (!companyId) return
    setBusy(true); setErro(null)
    const { error } = await supabase.from('veic_banco_parceiro').update({ ativo: !b.ativo }).eq('id', b.id).eq('company_id', companyId)
    setBusy(false)
    if (error) { setErro('Não foi possível alterar a situação. Tente novamente.'); return }
    await carregar()
  }

  const lbl: React.CSSProperties = { fontSize: 11.5, color: C.espM, display: 'block' }
  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 10, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
        Bancos parceiros (financiamento)
        <AjudaCampo chave="revenda.config.banco_parceiro.secao" rota={ROTA} />
      </div>
      <div style={{ fontSize: 11.5, color: C.espL, margin: '2px 0 10px', lineHeight: 1.45 }}>
        Bancos que pagam retorno sobre o financiamento do veículo. Não confunda com as contas bancárias da empresa.
        O % e o prazo cadastrados aqui são usados na venda para calcular e provisionar a receita de intermediação.
      </div>

      {carregando ? (
        <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic' }}>Carregando…</div>
      ) : lista.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.espL, fontStyle: 'italic', marginBottom: 10 }}>
          Nenhum banco parceiro cadastrado. Adicione o primeiro no formulário abaixo.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          {lista.map((b) => (
            <div key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px', opacity: b.ativo ? 1 : 0.6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.esp }}>{b.nome}{!b.ativo && <span style={{ fontSize: 10.5, color: C.espL, fontWeight: 400 }}> · inativo</span>}</div>
                <div style={{ fontSize: 11.5, color: C.espM }}>Retorno {pct(b.retorno_pct)} · prazo {b.prazo_dias == null ? '—' : `${b.prazo_dias} dia(s)`}</div>
              </div>
              <button onClick={() => void alternarAtivo(b)} disabled={busy} title={b.ativo ? 'inativar' : 'ativar'}
                style={{ border: `1px solid ${C.border}`, background: C.white, color: b.ativo ? C.espM : C.green, borderRadius: 6, padding: '4px 9px', cursor: busy ? 'wait' : 'pointer', fontSize: 11.5 }}>
                {b.ativo ? 'Inativar' : 'Ativar'}
              </button>
              <button onClick={() => editar(b)} disabled={busy} title="editar"
                style={{ border: `1px solid ${C.border}`, background: C.white, color: C.esp, borderRadius: 6, padding: '4px 9px', cursor: busy ? 'wait' : 'pointer', fontSize: 11.5 }}>
                Editar
              </button>
              <button onClick={() => void excluir(b)} disabled={busy} title="excluir"
                style={{ border: `1px solid ${C.border}`, background: C.white, color: C.red, borderRadius: 6, padding: '4px 9px', cursor: busy ? 'wait' : 'pointer', fontSize: 12 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.cream}`, paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.espM, marginBottom: 8 }}>{editId ? 'Editar banco parceiro' : 'Novo banco parceiro'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <label style={{ ...lbl, gridColumn: '1 / -1' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Nome do banco<AjudaCampo chave="revenda.config.banco_parceiro.nome" rota={ROTA} /></span>
            <input value={form.nome} onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))} placeholder="Ex.: Banco X Financiamentos" style={inp} />
          </label>
          <label style={lbl}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>% de retorno<AjudaCampo chave="revenda.config.banco_parceiro.retorno_pct" rota={ROTA} /></span>
            <input value={form.retorno_pct} onChange={(e) => setForm((s) => ({ ...s, retorno_pct: e.target.value }))} inputMode="decimal" placeholder="Ex.: 2" style={inp} />
          </label>
          <label style={lbl}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Prazo (dias)<AjudaCampo chave="revenda.config.banco_parceiro.prazo_dias" rota={ROTA} /></span>
            <input value={form.prazo_dias} onChange={(e) => setForm((s) => ({ ...s, prazo_dias: e.target.value }))} inputMode="numeric" placeholder="Ex.: 30" style={inp} />
          </label>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.esp, cursor: 'pointer', margin: '10px 0 2px' }}>
          <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((s) => ({ ...s, ativo: e.target.checked }))} style={{ width: 16, height: 16 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>Ativo (aparece para seleção na venda)<AjudaCampo chave="revenda.config.banco_parceiro.ativo" rota={ROTA} /></span>
        </label>

        {erro && <div style={{ marginTop: 10, background: C.redBg, border: `1px solid ${C.red}44`, borderRadius: 8, padding: '9px 11px', fontSize: 12.5, color: C.red }}>{erro}</div>}
        {msg && <div style={{ marginTop: 10, background: C.greenBg, border: `1px solid ${C.green}44`, borderRadius: 8, padding: '9px 11px', fontSize: 12.5, color: C.green }}>{msg}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => void salvar()} disabled={busy || !companyId}
            style={{ border: 'none', background: busy || !companyId ? C.espL : C.gold, color: '#fff', borderRadius: 9, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: busy || !companyId ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Salvando…' : editId ? 'Salvar alterações' : 'Adicionar banco'}
          </button>
          {editId && (
            <button onClick={limpar} disabled={busy}
              style={{ border: `1px solid ${C.border}`, background: C.white, color: C.espM, borderRadius: 9, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Cancelar
            </button>
          )}
        </div>
        {!companyId && <div style={{ fontSize: 11.5, color: C.espL, marginTop: 8, fontStyle: 'italic' }}>Selecione uma empresa (não consolidado) para cadastrar.</div>}
      </div>
    </div>
  )
}
