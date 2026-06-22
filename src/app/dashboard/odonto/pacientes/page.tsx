'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, X, UploadCloud, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

type Paciente = {
  id: string
  nome: string
  cpf: string | null
  data_nascimento: string | null
  sexo: 'F' | 'M' | 'O' | null
  telefone: string | null
  celular: string | null
  email: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  responsavel_nome: string | null
  responsavel_cpf: string | null
  responsavel_parentesco: string | null
  convenio_nome: string | null
  convenio_carteirinha: string | null
  alergias: string | null
  observacao: string | null
}

const EMPTY: Paciente = {
  id: '', nome: '', cpf: null, data_nascimento: null, sexo: null,
  telefone: null, celular: null, email: null,
  cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null,
  responsavel_nome: null, responsavel_cpf: null, responsavel_parentesco: null,
  convenio_nome: null, convenio_carteirinha: null, alergias: null, observacao: null,
}

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => {
      const v = read()
      setId((prev) => (prev === v ? prev : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function PacientesPage() {
  const companyId = useCompanyId()
  const [rows, setRows] = useState<Paciente[]>([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Paciente | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('erp_odonto_paciente')
      .select('*')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .order('nome')
    setRows((data as Paciente[]) ?? [])
    setLoading(false)
  }, [companyId])
  useEffect(() => { load() }, [load])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.nome.toLowerCase().includes(q) ||
      (r.cpf ?? '').includes(q.replace(/\D/g, '')) ||
      (r.celular ?? '').includes(q),
    )
  }, [rows, busca])

  const salvar = async (p: Paciente) => {
    if (!companyId) return
    if (!p.nome.trim()) { setMsg('Nome é obrigatório.'); return }
    const cpfClean = (p.cpf ?? '').replace(/\D/g, '') || null
    const payload = {
      ...p,
      company_id: companyId,
      nome: p.nome.trim(),
      cpf: cpfClean,
    }
    const isNew = !p.id
    let error: { code?: string; message: string } | null = null
    if (isNew) {
      const { id: _drop, ...insertPayload } = payload
      void _drop
      const res = await supabase.from('erp_odonto_paciente').insert(insertPayload)
      error = res.error
    } else {
      const res = await supabase.from('erp_odonto_paciente').update(payload).eq('id', p.id)
      error = res.error
    }
    if (error) {
      if (error.code === '23505') setMsg('Já existe paciente com este CPF nesta empresa.')
      else setMsg(error.message)
      return
    }
    setEdit(null)
    setMsg(isNew ? 'Paciente cadastrado.' : 'Paciente atualizado.')
    setTimeout(() => setMsg(null), 3000)
    load()
  }

  const inativar = async (p: Paciente) => {
    if (!confirm(`Inativar ${p.nome}?`)) return
    await supabase.from('erp_odonto_paciente').update({ ativo: false }).eq('id', p.id)
    setEdit(null); load()
  }

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Selecione uma empresa especifica no topo do menu para gerenciar pacientes.
    </div>
  )

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>
              <User size={14} /> Cadastro
            </div>
            <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Pacientes</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/odonto/migrar" className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>
              <UploadCloud size={15} /> Migrar do meu sistema
            </Link>
            <button onClick={() => setEdit({ ...EMPTY })} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>
              <Plus size={15} /> Novo paciente
            </button>
          </div>
        </div>

        <div className="rounded-2xl flex items-center gap-2 px-3 py-2 mb-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <Search size={16} style={{ color: ESP60 }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF ou celular" className="flex-1 bg-transparent outline-none text-sm" style={{ color: ESP }} />
        </div>

        {msg && (
          <div className="rounded-xl p-3 text-sm mb-3" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>{msg}</div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm" style={{ color: ESP60 }}>Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-2xl p-10 text-center" style={{ border: `1px dashed ${LINE}`, background: '#fff', color: ESP60 }}>
            {rows.length === 0
              ? 'Nenhum paciente ainda — migre do seu sistema atual ou cadastre o primeiro.'
              : 'Nenhum paciente bate com a busca.'}
          </div>
        ) : (
          <ul className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            {filtrados.map((p, i) => (
              <li key={p.id}>
                {i > 0 && <div style={{ height: 1, background: LINE, marginLeft: 16 }} />}
                <button onClick={() => setEdit(p)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[rgba(200,148,26,0.06)] transition-colors">
                  <div className="rounded-full grid place-items-center" style={{ width: 36, height: 36, background: BG, color: ESP }}>
                    {p.nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.nome}</div>
                    <div className="text-xs truncate" style={{ color: ESP60 }}>
                      {p.celular || p.telefone || 'sem telefone'}
                      {p.convenio_nome ? ` · ${p.convenio_nome}` : ''}
                    </div>
                  </div>
                  {p.cpf && <span className="text-xs font-mono" style={{ color: ESP60 }}>{formatCpf(p.cpf)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {edit && (
        <Drawer onClose={() => setEdit(null)}>
          <FormPaciente
            initial={edit}
            onCancel={() => setEdit(null)}
            onSave={salvar}
            onInativar={edit.id ? () => inativar(edit) : undefined}
          />
        </Drawer>
      )}
    </div>
  )
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} className="fixed inset-0 flex items-end sm:items-center sm:justify-center p-0 sm:p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto" style={{ background: '#fff', boxShadow: '0 -20px 50px rgba(61,35,20,0.3)' }}>
        {children}
      </div>
    </div>
  )
}

function FormPaciente({ initial, onCancel, onSave, onInativar }: { initial: Paciente; onCancel: () => void; onSave: (p: Paciente) => void; onInativar?: () => void }) {
  const [p, setP] = useState<Paciente>(initial)
  const set = <K extends keyof Paciente>(k: K, v: Paciente[K]) => setP((s) => ({ ...s, [k]: v }))
  const titulo = initial.id ? 'Editar paciente' : 'Novo paciente'
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold" style={{ fontFamily: 'ui-serif,Georgia,serif', color: ESP }}>{titulo}</h3>
        <button onClick={onCancel} style={{ color: ESP60 }}><X size={20} /></button>
      </div>

      <Sec t="Identificação" />
      <Field label="Nome *"><Inp value={p.nome} onChange={(v) => set('nome', v)} placeholder="Nome completo" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPF"><Inp value={p.cpf ?? ''} onChange={(v) => set('cpf', v || null)} placeholder="000.000.000-00" /></Field>
        <Field label="Nascimento"><Inp type="date" value={p.data_nascimento ?? ''} onChange={(v) => set('data_nascimento', v || null)} /></Field>
      </div>
      <Field label="Sexo">
        <select value={p.sexo ?? ''} onChange={(e) => set('sexo', (e.target.value || null) as Paciente['sexo'])} className="w-full rounded-xl px-3 py-2 text-sm outline-none bg-white" style={{ border: `1px solid ${LINE}`, color: ESP }}>
          <option value="">—</option><option value="F">Feminino</option><option value="M">Masculino</option><option value="O">Outro</option>
        </select>
      </Field>

      <Sec t="Contato" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Celular / WhatsApp"><Inp value={p.celular ?? ''} onChange={(v) => set('celular', v || null)} placeholder="(11) 90000-0000" /></Field>
        <Field label="Telefone"><Inp value={p.telefone ?? ''} onChange={(v) => set('telefone', v || null)} /></Field>
      </div>
      <Field label="E-mail"><Inp type="email" value={p.email ?? ''} onChange={(v) => set('email', v || null)} /></Field>

      <Sec t="Endereço" />
      <div className="grid grid-cols-3 gap-3">
        <Field label="CEP"><Inp value={p.cep ?? ''} onChange={(v) => set('cep', v || null)} /></Field>
        <Field label="Cidade"><Inp value={p.cidade ?? ''} onChange={(v) => set('cidade', v || null)} /></Field>
        <Field label="UF"><Inp value={p.uf ?? ''} onChange={(v) => set('uf', v || null)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Logradouro"><Inp value={p.logradouro ?? ''} onChange={(v) => set('logradouro', v || null)} /></Field>
        <Field label="Número"><Inp value={p.numero ?? ''} onChange={(v) => set('numero', v || null)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bairro"><Inp value={p.bairro ?? ''} onChange={(v) => set('bairro', v || null)} /></Field>
        <Field label="Complemento"><Inp value={p.complemento ?? ''} onChange={(v) => set('complemento', v || null)} /></Field>
      </div>

      <Sec t="Responsável" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome do responsável"><Inp value={p.responsavel_nome ?? ''} onChange={(v) => set('responsavel_nome', v || null)} /></Field>
        <Field label="Parentesco"><Inp value={p.responsavel_parentesco ?? ''} onChange={(v) => set('responsavel_parentesco', v || null)} /></Field>
      </div>
      <Field label="CPF do responsável"><Inp value={p.responsavel_cpf ?? ''} onChange={(v) => set('responsavel_cpf', v || null)} /></Field>

      <Sec t="Convênio" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Convênio"><Inp value={p.convenio_nome ?? ''} onChange={(v) => set('convenio_nome', v || null)} /></Field>
        <Field label="Carteirinha"><Inp value={p.convenio_carteirinha ?? ''} onChange={(v) => set('convenio_carteirinha', v || null)} /></Field>
      </div>

      <Sec t="Alertas (LGPD art.11 · sensível)" />
      <Field label="Alergias"><Inp value={p.alergias ?? ''} onChange={(v) => set('alergias', v || null)} placeholder="Ex.: penicilina, látex" /></Field>
      <Field label="Observação"><Inp value={p.observacao ?? ''} onChange={(v) => set('observacao', v || null)} /></Field>

      <div className="flex gap-2 mt-5">
        <button onClick={() => onSave(p)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>Salvar</button>
        {onInativar && <button onClick={onInativar} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: '#fff', border: `1px solid ${LINE}`, color: '#A65A3A' }}>Inativar</button>}
      </div>
    </div>
  )
}

function Sec({ t }: { t: string }) {
  return <div className="text-xs font-semibold uppercase tracking-wider mt-4 mb-2" style={{ color: ESP60 }}>{t}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <label className="block text-xs font-medium mb-1" style={{ color: ESP }}>{label}</label>
      {children}
    </div>
  )
}
function Inp({ value, onChange, type = 'text', placeholder }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ border: `1px solid ${LINE}`, color: ESP, background: '#fff' }} />
}

function formatCpf(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length !== 11) return s
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
