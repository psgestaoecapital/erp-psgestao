'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, X, UploadCloud, User, Pencil, MessageCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SaldoBadge } from '@/components/odonto/ui'

// idade a partir da data de nascimento (RD-51: sem data → null)
function calcIdade(nasc: string | null | undefined): number | null {
  if (!nasc) return null
  const d = new Date(nasc); if (isNaN(d.getTime())) return null
  const hoje = new Date(); let i = hoje.getFullYear() - d.getFullYear()
  const m = hoje.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) i--
  return i >= 0 && i < 130 ? i : null
}
// link WhatsApp (55 + dígitos) — padrão do app
function waLink(fone: string | null | undefined): string | null {
  const t = (fone ?? '').replace(/\D/g, ''); if (t.length < 10) return null
  return `https://wa.me/${t.length <= 11 ? '55' + t : t}`
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

type Paciente = {
  id: string
  nome: string
  cpf: string | null
  rg: string | null
  numero_paciente: string | null
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
  id: '', nome: '', cpf: null, rg: null, numero_paciente: null, data_nascimento: null, sexo: null,
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
  const [ultConsulta, setUltConsulta] = useState<Record<string, string>>({})

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
    // última consulta por paciente = agendamento mais recente (limite defensivo; clínicas não são gigantes)
    const { data: ags } = await supabase
      .from('erp_odonto_agendamento')
      .select('paciente_id, data')
      .eq('company_id', companyId)
      .not('paciente_id', 'is', null)
      .order('data', { ascending: false })
      .limit(3000)
    const ult: Record<string, string> = {}
    for (const a of ((ags as { paciente_id: string | null; data: string }[] | null) ?? [])) {
      if (a.paciente_id && !ult[a.paciente_id]) ult[a.paciente_id] = a.data
    }
    setUltConsulta(ult)
    // deep-link ?edit=<id> vindo da Ficha (botão Editar do header) → abre o cadastro direto (1x).
    if (typeof window !== 'undefined') {
      const editId = new URLSearchParams(window.location.search).get('edit')
      if (editId) {
        const alvo = ((data as Paciente[] | null) ?? []).find((r) => r.id === editId)
        if (alvo) setEdit(alvo)
        window.history.replaceState(null, '', '/dashboard/odonto/pacientes')
      }
    }
  }, [companyId])
  useEffect(() => { load() }, [load])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.nome.toLowerCase().includes(q) ||
      (r.cpf ?? '').includes(q.replace(/\D/g, '')) ||
      (r.celular ?? '').includes(q) ||
      (r.numero_paciente ?? '').includes(q),
    )
  }, [rows, busca])

  const salvar = async (p: Paciente) => {
    if (!companyId) return
    if (!p.nome.trim()) { setMsg('Nome é obrigatório.'); return }
    const isNew = !p.id
    // FRONTEIRA GE (RD-25): salva via RPC que cria/vincula o cliente GE (cliente_id) — ponte pro O0.
    const { data, error } = await supabase.rpc('fn_odonto_paciente_salvar', {
      p_company_id: companyId,
      p_id: p.id || null,
      p_dados: {
        nome: p.nome.trim(), cpf: (p.cpf ?? '').replace(/\D/g, ''), rg: (p.rg ?? '').trim(), data_nascimento: p.data_nascimento ?? '',
        sexo: p.sexo ?? '', telefone: p.telefone ?? '', celular: p.celular ?? '', email: p.email ?? '',
        cep: (p.cep ?? '').replace(/\D/g, ''), logradouro: p.logradouro ?? '', numero: p.numero ?? '', complemento: p.complemento ?? '',
        bairro: p.bairro ?? '', cidade: p.cidade ?? '', uf: p.uf ?? '',
        responsavel_nome: p.responsavel_nome ?? '', responsavel_cpf: (p.responsavel_cpf ?? '').replace(/\D/g, ''), responsavel_parentesco: p.responsavel_parentesco ?? '',
        convenio_nome: p.convenio_nome ?? '', convenio_carteirinha: p.convenio_carteirinha ?? '',
        alergias: p.alergias ?? '', observacao: p.observacao ?? '',
      },
    })
    const r = data as { ok?: boolean; erro?: string; cliente_id?: string | null } | null
    if (error || !r?.ok) { setMsg(r?.erro || error?.message || 'Falha ao salvar o paciente.'); return }
    setEdit(null)
    setMsg((isNew ? 'Paciente cadastrado' : 'Paciente atualizado') + (r.cliente_id ? ' · vinculado ao financeiro (GE).' : '.'))
    setTimeout(() => setMsg(null), 3500)
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
                <div className="px-2 sm:px-4 py-3 flex items-center gap-2 hover:bg-[rgba(200,148,26,0.06)] transition-colors">
                  {/* linha inteira → abre a Ficha do paciente (abas) */}
                  <Link href={`/dashboard/odonto/pacientes/${p.id}`} className="flex-1 min-w-0 flex items-center gap-3">
                    <div className="rounded-full grid place-items-center flex-shrink-0" style={{ width: 36, height: 36, background: BG, color: ESP }}>
                      {p.nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {p.numero_paciente ? <span className="font-normal" style={{ color: GOLD }}>#{p.numero_paciente} </span> : null}
                        {p.nome}{(() => { const a = calcIdade(p.data_nascimento); return a != null ? <span className="font-normal" style={{ color: ESP60 }}> · {a}a</span> : null })()}
                      </div>
                      <div className="text-xs truncate" style={{ color: ESP60 }}>
                        {p.celular || p.telefone || 'sem telefone'}
                        {p.convenio_nome ? ` · ${p.convenio_nome}` : ''}
                        {p.cpf ? ` · ${formatCpf(p.cpf)}` : ''}
                        {ultConsulta[p.id] ? ` · última consulta ${new Date(ultConsulta[p.id] + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                      </div>
                    </div>
                    <span className="flex-shrink-0 hidden sm:inline-flex" onClick={(e) => e.preventDefault()}><SaldoBadge pacienteId={p.id} compact /></span>
                  </Link>
                  {waLink(p.celular || p.telefone) && (
                    <a href={waLink(p.celular || p.telefone) as string} target="_blank" rel="noreferrer" title="WhatsApp" onClick={(e) => e.stopPropagation()} className="p-2 rounded-lg flex-shrink-0" style={{ color: '#166534' }}><MessageCircle size={17} /></a>
                  )}
                  <button onClick={() => setEdit(p)} title="Editar" className="p-2 rounded-lg flex-shrink-0" style={{ color: ESP60 }}><Pencil size={16} /></button>
                </div>
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
      {initial.id && p.numero_paciente && (
        <div className="mb-2 text-xs" style={{ color: ESP60 }}>Código / Prontuário: <span className="font-semibold" style={{ color: GOLD }}>#{p.numero_paciente}</span> <span style={{ color: ESP60 }}>(automático)</span></div>
      )}
      <Field label="Nome *"><Inp value={p.nome} onChange={(v) => set('nome', v)} placeholder="Nome completo" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPF"><Inp value={p.cpf ?? ''} onChange={(v) => set('cpf', v || null)} placeholder="000.000.000-00" /></Field>
        <Field label="RG"><Inp value={p.rg ?? ''} onChange={(v) => set('rg', v || null)} placeholder="00.000.000-0" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nascimento"><Inp type="date" value={p.data_nascimento ?? ''} onChange={(v) => set('data_nascimento', v || null)} /></Field>
        <div />
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
