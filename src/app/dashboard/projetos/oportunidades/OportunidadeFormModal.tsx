'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

type ClienteOpt = { id: string; nome: string; cpf_cnpj: string | null }
type UserOpt = { id: string; email: string | null }

export type OportunidadeRow = {
  id?: string
  company_id?: string
  cliente_id: string | null
  titulo: string
  etapa: string
  valor_estimado: number | null
  origem: string | null
  obra_endereco: string | null
  obra_cidade: string | null
  obra_bairro: string | null
  responsavel_id: string | null
  data_prevista_fechamento: string | null
  probabilidade: number | null
  observacoes: string | null
}

const ETAPAS: { v: string; l: string }[] = [
  { v: 'prospeccao',       l: 'Prospecção' },
  { v: 'visita_agendada',  l: 'Visita agendada' },
  { v: 'visita_feita',     l: 'Visita feita' },
  { v: 'orcando',          l: 'Orçando' },
  { v: 'proposta_enviada', l: 'Proposta enviada' },
  { v: 'negociacao',       l: 'Negociação' },
  { v: 'ganho',            l: 'Ganho' },
  { v: 'perdido',          l: 'Perdido' },
]

const ORIGENS = ['indicacao', 'instagram', 'site', 'obra_vizinha', 'outro']

const empty = (): OportunidadeRow => ({
  cliente_id: null, titulo: '', etapa: 'prospeccao',
  valor_estimado: null, origem: null,
  obra_endereco: null, obra_cidade: null, obra_bairro: null,
  responsavel_id: null, data_prevista_fechamento: null,
  probabilidade: 50, observacoes: null,
})

interface Props {
  companyId: string
  initial?: OportunidadeRow | null
  onClose: () => void
  onSaved: (id: string) => void
}

export default function OportunidadeFormModal({ companyId, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<OportunidadeRow>(initial ?? empty())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isEdit = !!initial?.id

  // Cliente autocomplete
  const [buscaCli, setBuscaCli] = useState('')
  const [cliOpts, setCliOpts] = useState<ClienteOpt[]>([])
  const [cliSel, setCliSel] = useState<ClienteOpt | null>(null)
  const [showOpts, setShowOpts] = useState(false)

  // Quick add cliente
  const [novoCliOpen, setNovoCliOpen] = useState(false)
  const [novoCliNome, setNovoCliNome] = useState('')
  const [novoCliTel, setNovoCliTel] = useState('')
  const [novoCliSaving, setNovoCliSaving] = useState(false)

  // Responsavel
  const [users, setUsers] = useState<UserOpt[]>([])

  // Load initial cliente label
  useEffect(() => {
    if (!form.cliente_id) return
    supabase
      .from('erp_clientes')
      .select('id, razao_social, nome_fantasia, cpf_cnpj')
      .eq('id', form.cliente_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const d = data as { id: string; razao_social: string | null; nome_fantasia: string | null; cpf_cnpj: string | null }
        const nome = d.nome_fantasia || d.razao_social || ''
        setCliSel({ id: d.id, nome, cpf_cnpj: d.cpf_cnpj })
        setBuscaCli(nome)
      })
  }, [form.cliente_id])

  // Load users
  useEffect(() => {
    supabase
      .from('user_companies')
      .select('users(id, email)')
      .eq('company_id', companyId)
      .then(({ data }) => {
        const list = (data ?? []) as unknown as Array<{ users: UserOpt | UserOpt[] | null }>
        const flat: UserOpt[] = []
        for (const r of list) {
          const u = Array.isArray(r.users) ? r.users[0] : r.users
          if (u) flat.push(u)
        }
        setUsers(flat)
      })
  }, [companyId])

  // Cliente search
  useEffect(() => {
    if (buscaCli.length < 2 || cliSel) { setCliOpts([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('erp_clientes')
        .select('id, razao_social, nome_fantasia, cpf_cnpj')
        .eq('company_id', companyId)
        .or(`razao_social.ilike.%${buscaCli}%,nome_fantasia.ilike.%${buscaCli}%`)
        .limit(8)
      const list = (data ?? []) as Array<{ id: string; razao_social: string | null; nome_fantasia: string | null; cpf_cnpj: string | null }>
      setCliOpts(list.map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || '—', cpf_cnpj: c.cpf_cnpj })))
    }, 250)
    return () => clearTimeout(t)
  }, [buscaCli, companyId, cliSel])

  const setF = <K extends keyof OportunidadeRow>(k: K, v: OportunidadeRow[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  function escolherCliente(c: ClienteOpt) {
    setCliSel(c)
    setBuscaCli(c.nome)
    setShowOpts(false)
    setF('cliente_id', c.id)
  }

  function limparCliente() {
    setCliSel(null)
    setBuscaCli('')
    setF('cliente_id', null)
  }

  async function criarClienteRapido() {
    if (!novoCliNome.trim()) { setErr('Nome do cliente obrigatorio.'); return }
    setNovoCliSaving(true)
    setErr(null)
    const { data, error } = await supabase
      .from('erp_clientes')
      .insert({ company_id: companyId, nome_fantasia: novoCliNome.trim(), telefone: novoCliTel.trim() || null })
      .select('id, nome_fantasia, cpf_cnpj')
      .single()
    setNovoCliSaving(false)
    if (error) { setErr(`Erro ao criar cliente: ${error.message}`); return }
    const d = data as { id: string; nome_fantasia: string | null; cpf_cnpj: string | null }
    escolherCliente({ id: d.id, nome: d.nome_fantasia ?? novoCliNome.trim(), cpf_cnpj: d.cpf_cnpj })
    setNovoCliOpen(false)
    setNovoCliNome('')
    setNovoCliTel('')
  }

  async function salvar() {
    if (!form.titulo.trim()) { setErr('Titulo obrigatorio.'); return }
    setSaving(true)
    setErr(null)
    const payload = { ...form, company_id: companyId }
    if (isEdit && initial?.id) {
      const { error } = await supabase.from('erp_crm_oportunidade').update(payload).eq('id', initial.id)
      setSaving(false)
      if (error) { setErr(error.message); return }
      onSaved(initial.id)
    } else {
      const { data, error } = await supabase
        .from('erp_crm_oportunidade')
        .insert(payload)
        .select('id')
        .single()
      setSaving(false)
      if (error) { setErr(error.message); return }
      onSaved((data as { id: string }).id)
    }
  }

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', margin: 0 }}>
            {isEdit ? 'Editar oportunidade' : 'Nova oportunidade'}
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>

        {/* Titulo */}
        <label style={lbl}>
          Título *
          <input
            value={form.titulo}
            onChange={(e) => setF('titulo', e.target.value)}
            placeholder="Forro gesso · Residência X"
            style={inp}
          />
        </label>

        {/* Cliente autocomplete */}
        <div style={{ marginTop: 12 }}>
          <div style={lblTxt}>Cliente</div>
          {cliSel ? (
            <div style={selectedRow}>
              <span style={{ fontSize: 13, color: '#3D2314' }}>
                {cliSel.nome}{cliSel.cpf_cnpj ? ` · ${cliSel.cpf_cnpj}` : ''}
              </span>
              <button onClick={limparCliente} style={linkBtn}>trocar</button>
            </div>
          ) : (
            <>
              <input
                value={buscaCli}
                onChange={(e) => { setBuscaCli(e.target.value); setShowOpts(true) }}
                onFocus={() => setShowOpts(true)}
                placeholder="Digite o nome do cliente…"
                style={inp}
              />
              {showOpts && cliOpts.length > 0 && (
                <div style={dropdown}>
                  {cliOpts.map((c) => (
                    <button key={c.id} onClick={() => escolherCliente(c)} style={dropItem}>
                      <span style={{ color: '#3D2314' }}>{c.nome}</span>
                      {c.cpf_cnpj && <span style={{ color: '#6b5444', fontSize: 11, marginLeft: 6 }}>· {c.cpf_cnpj}</span>}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setNovoCliOpen((v) => !v)} style={linkBtn}>
                {novoCliOpen ? '− Cancelar' : '+ Novo cliente rápido'}
              </button>
              {novoCliOpen && (
                <div style={quickAddBox}>
                  <input
                    value={novoCliNome}
                    onChange={(e) => setNovoCliNome(e.target.value)}
                    placeholder="Nome do cliente *"
                    style={inp}
                  />
                  <input
                    value={novoCliTel}
                    onChange={(e) => setNovoCliTel(e.target.value)}
                    placeholder="Telefone (opcional)"
                    style={{ ...inp, marginTop: 6 }}
                  />
                  <button
                    onClick={criarClienteRapido}
                    disabled={novoCliSaving || !novoCliNome.trim()}
                    style={{ ...btnPrimary, marginTop: 8 }}
                  >
                    {novoCliSaving ? 'Criando…' : 'CRIAR cliente'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Grid: etapa | valor | origem | data_prevista | probabilidade | responsavel */}
        <div style={grid}>
          <label style={lbl}>
            Etapa
            <select value={form.etapa} onChange={(e) => setF('etapa', e.target.value)} style={inp}>
              {ETAPAS.map((e) => <option key={e.v} value={e.v}>{e.l}</option>)}
            </select>
          </label>
          <label style={lbl}>
            Valor estimado (R$)
            <input
              type="number" step="0.01"
              value={form.valor_estimado ?? ''}
              onChange={(e) => setF('valor_estimado', e.target.value === '' ? null : Number(e.target.value))}
              style={inp}
            />
          </label>
          <label style={lbl}>
            Origem
            <select value={form.origem ?? ''} onChange={(e) => setF('origem', e.target.value || null)} style={inp}>
              <option value="">—</option>
              {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label style={lbl}>
            Data prevista de fechamento
            <input
              type="date"
              value={form.data_prevista_fechamento ?? ''}
              onChange={(e) => setF('data_prevista_fechamento', e.target.value || null)}
              style={inp}
            />
          </label>
          <label style={lbl}>
            Probabilidade (%)
            <input
              type="number" min={0} max={100}
              value={form.probabilidade ?? ''}
              onChange={(e) => setF('probabilidade', e.target.value === '' ? null : Number(e.target.value))}
              style={inp}
            />
          </label>
          <label style={lbl}>
            Responsável
            <select
              value={form.responsavel_id ?? ''}
              onChange={(e) => setF('responsavel_id', e.target.value || null)}
              style={inp}
            >
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email ?? u.id.slice(0, 8)}</option>)}
            </select>
          </label>
        </div>

        {/* Obra */}
        <div style={{ marginTop: 14 }}>
          <div style={secHead}>Obra</div>
          <div style={grid}>
            <label style={lbl}>
              Endereço
              <input
                value={form.obra_endereco ?? ''}
                onChange={(e) => setF('obra_endereco', e.target.value || null)}
                style={inp}
              />
            </label>
            <label style={lbl}>
              Cidade
              <input
                value={form.obra_cidade ?? ''}
                onChange={(e) => setF('obra_cidade', e.target.value || null)}
                style={inp}
              />
            </label>
            <label style={lbl}>
              Bairro
              <input
                value={form.obra_bairro ?? ''}
                onChange={(e) => setF('obra_bairro', e.target.value || null)}
                style={inp}
              />
            </label>
          </div>
        </div>

        <label style={{ ...lbl, marginTop: 12 }}>
          Observações
          <textarea
            rows={3}
            value={form.observacoes ?? ''}
            onChange={(e) => setF('observacoes', e.target.value || null)}
            style={{ ...inp, resize: 'vertical' }}
          />
        </label>

        {err && <p style={{ color: '#b00', fontSize: 13, marginTop: 8 }}>Erro: {err}</p>}

        <div style={actions}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button onClick={salvar} disabled={saving} style={btnPrimary}>
            {saving ? 'Salvando…' : isEdit ? 'ALTERAR' : 'CRIAR'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: 16, zIndex: 50, overflow: 'auto',
}
const card: CSSProperties = {
  background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 720,
}
const head: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
}
const closeBtn: CSSProperties = {
  border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', minWidth: 44, minHeight: 44,
}
const secHead: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#C8941A', marginBottom: 8,
  borderBottom: '1px solid #efe9e2', paddingBottom: 4,
}
const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8,
}
const lbl: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b6b6b',
}
const lblTxt: CSSProperties = { fontSize: 12, color: '#6b6b6b', marginBottom: 4 }
const inp: CSSProperties = {
  border: '1px solid #E7DED3', borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40,
  background: '#fff', color: '#3D2314',
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
const selectedRow: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  border: '1px solid #E7DED3', borderRadius: 8, padding: '8px 10px',
  background: '#fff', color: '#3D2314',
}
const linkBtn: CSSProperties = {
  background: 'none', border: 'none', color: '#C8941A', fontSize: 12,
  cursor: 'pointer', padding: '6px 0', textAlign: 'left',
}
const dropdown: CSSProperties = {
  border: '1px solid #E7DED3', borderRadius: 8, marginTop: 4,
  background: '#fff', maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.06)',
}
const dropItem: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  border: 'none', background: 'none', padding: '8px 10px', fontSize: 13, cursor: 'pointer',
}
const quickAddBox: CSSProperties = {
  border: '1px dashed #E7DED3', borderRadius: 8, padding: 10, marginTop: 6, background: '#FAF7F2',
}
const actions: CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16,
}
const btnGhost: CSSProperties = {
  border: '1px solid #E7DED3', background: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', minHeight: 44,
}
const btnPrimary: CSSProperties = {
  border: 'none', background: '#C8941A', color: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', fontWeight: 600, minHeight: 44,
}
