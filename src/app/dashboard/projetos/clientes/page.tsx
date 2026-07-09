'use client'

// FASE 1 · CLIENTES de obra (Hub de Projetos). CRUD real sobre erp_clientes
// (reuso do cadastro central — NÃO cria tabela nova), escopado por empresa.
// SEGURANÇA (Pilar 2): erp_clientes tem RLS (company_id via user_companies +
// bypass adm) e erp_obra_planta via get_user_company_ids() — a query ainda
// filtra explicitamente por empresaUnica pra mostrar só a empresa selecionada.
// Elo da jornada: cliente → obra (erp_obra_planta.cliente_id) → orçamento (fase seguinte).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const GOLD_D = '#A57A15'
const LINE = '#E7DECF'
const CREAM = '#F2EBDF'
const MUT = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'
const GREEN = '#166534'
const GREEN_BG = '#DCFCE7'

type Cliente = {
  id: string
  tipo_pessoa: string | null
  nome_fantasia: string | null
  razao_social: string | null
  cpf_cnpj: string | null
  cnpj_cpf: string | null
  telefone: string | null
  celular: string | null
  email: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  ativo: boolean | null
}
type Obra = { id: string; nome: string | null; projeto_nome: string | null; status: string | null; obra_cidade: string | null; obra_uf: string | null; created_at: string | null }

const VAZIO: Partial<Cliente> = { tipo_pessoa: 'PJ', nome_fantasia: '', razao_social: '', cpf_cnpj: '', telefone: '', email: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', ativo: true }

const docLabel = (t: string | null) => (t === 'PF' ? 'CPF' : 'CNPJ')
const docOf = (c: Cliente) => c.cpf_cnpj || c.cnpj_cpf || '—'
const nomeOf = (c: Cliente) => c.nome_fantasia || c.razao_social || '(sem nome)'

export default function ClientesPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [lista, setLista] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [form, setForm] = useState<Partial<Cliente> | null>(null) // null=fechado; sem id=criar; com id=editar
  const [salvando, setSalvando] = useState(false)
  const [sel2, setSel2] = useState<Cliente | null>(null) // cliente aberto (detalhe + obras)
  const [obras, setObras] = useState<Obra[]>([])
  const [obrasLoad, setObrasLoad] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase
      .from('erp_clientes')
      .select('id, tipo_pessoa, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, telefone, celular, email, cep, logradouro, numero, bairro, cidade, uf, ativo')
      .eq('company_id', empresaUnica)
      .eq('ativo', true)
      .order('nome_fantasia', { nullsFirst: false })
      .limit(1000)
    if (error) { setErro(error.message); setLista([]) } else { setLista((data ?? []) as Cliente[]) }
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  const carregarObras = useCallback(async (clienteId: string) => {
    setObrasLoad(true)
    const { data } = await supabase
      .from('erp_obra_planta')
      .select('id, nome, projeto_nome, status, obra_cidade, obra_uf, created_at')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
    setObras((data ?? []) as Obra[])
    setObrasLoad(false)
  }, [])

  const abrir = (c: Cliente) => { setSel2(c); setObras([]); void carregarObras(c.id) }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((c) =>
      nomeOf(c).toLowerCase().includes(q) ||
      (docOf(c) ?? '').toLowerCase().includes(q) ||
      (c.cidade ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.telefone ?? '').includes(q))
  }, [lista, busca])

  async function salvar() {
    if (!empresaUnica || !form) return
    const nome = (form.nome_fantasia ?? '').trim()
    if (!nome) { setErro('Informe o nome do cliente.'); return }
    setSalvando(true); setErro(null); setOk(null)
    const doc = (form.cpf_cnpj ?? '').trim() || null
    const payload = {
      company_id: empresaUnica,
      tipo_pessoa: form.tipo_pessoa || 'PJ',
      nome_fantasia: nome,
      razao_social: (form.razao_social ?? '').trim() || nome,
      cpf_cnpj: doc, cnpj_cpf: doc, // espelha nas duas colunas (legado + canônica)
      telefone: (form.telefone ?? '').trim() || null,
      email: (form.email ?? '').trim() || null,
      cep: (form.cep ?? '').trim() || null,
      logradouro: (form.logradouro ?? '').trim() || null,
      numero: (form.numero ?? '').trim() || null,
      bairro: (form.bairro ?? '').trim() || null,
      cidade: (form.cidade ?? '').trim() || null,
      uf: (form.uf ?? '').trim().toUpperCase().slice(0, 2) || null,
      ativo: true,
    }
    const editando = !!form.id
    const q = editando
      ? supabase.from('erp_clientes').update(payload).eq('id', form.id!)
      : supabase.from('erp_clientes').insert(payload)
    const { error } = await q
    setSalvando(false)
    if (error) { setErro(`Erro ao salvar: ${error.message}`); return }
    setOk(editando ? `ALTEROU cliente ${nome}` : `CRIOU cliente ${nome}`)
    setForm(null)
    await carregar()
    setTimeout(() => setOk(null), 4000)
  }

  async function excluir(c: Cliente) {
    if (!window.confirm(`Excluir o cliente "${nomeOf(c)}"?\n\nEle sai da lista de clientes de obra (arquivado). Obras e histórico são preservados.`)) return
    const { error } = await supabase.from('erp_clientes').update({ ativo: false }).eq('id', c.id)
    if (error) { setErro(`Erro ao excluir: ${error.message}`); return }
    setOk(`EXCLUIU (arquivou) ${nomeOf(c)}`)
    if (sel2?.id === c.id) setSel2(null)
    await carregar()
    setTimeout(() => setOk(null), 4000)
  }

  async function novaObra(c: Cliente) {
    const nome = window.prompt(`Nome da obra para ${nomeOf(c)}:`, `Obra ${nomeOf(c)}`)
    if (!nome || !nome.trim()) return
    if (!empresaUnica) return
    const { error } = await supabase.from('erp_obra_planta').insert({
      company_id: empresaUnica, cliente_id: c.id, cliente_nome: nomeOf(c),
      nome: nome.trim(), status: 'rascunho',
    })
    if (error) { setErro(`Erro ao criar obra: ${error.message}`); return }
    setOk(`CRIOU obra "${nome.trim()}" para ${nomeOf(c)}`)
    await carregarObras(c.id)
    setTimeout(() => setOk(null), 4000)
  }

  // ── Gate empresa ────────────────────────────────────────────────
  if (!empresaUnica) {
    return (
      <Casca>
        <Box><b style={{ color: ESP }}>Selecione uma empresa</b><div style={{ color: MUT, marginTop: 6, fontSize: 13 }}>Clientes são por empresa. Escolha uma empresa específica no seletor do topo (sem modo consolidado/grupo).</div></Box>
      </Casca>
    )
  }

  return (
    <Casca>
      {erro && <div style={aviso(RED, RED_BG)}>{erro}</div>}
      {ok && <div style={aviso(GREEN, GREEN_BG)}>✓ {ok}</div>}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, documento, cidade, contato…" style={{ ...inp, flex: 1, minWidth: 200 }} />
        <button onClick={() => setForm({ ...VAZIO })} style={btnGold}>+ Novo cliente</button>
      </div>

      {loading ? (
        <Box><span style={{ color: MUT }}>Carregando clientes…</span></Box>
      ) : filtrados.length === 0 ? (
        <Box>
          <b style={{ color: ESP }}>{busca ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'}</b>
          <div style={{ color: MUT, marginTop: 6, fontSize: 13 }}>{busca ? 'Ajuste a busca.' : 'Clique em “+ Novo cliente” para cadastrar o primeiro.'}</div>
        </Box>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, color: MUT }}>{filtrados.length} cliente(s){busca ? ' (filtrado)' : ''}</div>
          {filtrados.map((c) => (
            <div key={c.id} style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
              <div onClick={() => (sel2?.id === c.id ? setSel2(null) : abrir(c))} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 5, background: CREAM, color: GOLD_D }}>{c.tipo_pessoa || 'PJ'}</span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{nomeOf(c)}</div>
                  <div style={{ fontSize: 11, color: MUT }}>{docLabel(c.tipo_pessoa)}: {docOf(c)}{c.cidade ? ` · ${c.cidade}${c.uf ? '/' + c.uf : ''}` : ''}</div>
                </div>
                <div style={{ fontSize: 11, color: MUT, textAlign: 'right' }}>
                  {c.telefone || c.celular || ''}{(c.telefone || c.celular) && c.email ? ' · ' : ''}{c.email || ''}
                </div>
                <span style={{ color: GOLD, fontSize: 12 }}>{sel2?.id === c.id ? '▲' : '▼'}</span>
              </div>

              {sel2?.id === c.id && (
                <div style={{ borderTop: `0.5px solid ${LINE}`, padding: 14, background: BG }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button onClick={() => setForm({ ...c })} style={btnOutline}>✎ Editar</button>
                    <button onClick={() => novaObra(c)} style={btnGold}>+ Nova obra</button>
                    <button onClick={() => excluir(c)} style={btnDanger}>🗑 Excluir</button>
                  </div>
                  {(c.logradouro || c.bairro || c.cep) && (
                    <div style={{ fontSize: 12, color: MUT, marginBottom: 12 }}>
                      📍 {[c.logradouro, c.numero].filter(Boolean).join(', ')}{c.bairro ? ` · ${c.bairro}` : ''}{c.cep ? ` · CEP ${c.cep}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6 }}>Obras deste cliente</div>
                  {obrasLoad ? (
                    <div style={{ fontSize: 12, color: MUT }}>Carregando obras…</div>
                  ) : obras.length === 0 ? (
                    <div style={{ fontSize: 12, color: MUT, fontStyle: 'italic' }}>Nenhuma obra ainda. Use “+ Nova obra” para começar o elo Cliente → Obra → Orçamento.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {obras.map((o) => (
                        <div key={o.id} style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: ESP }}>{o.nome || o.projeto_nome || '(sem nome)'}</span>
                          <span style={{ fontSize: 11, color: MUT }}>{o.status || 'rascunho'}{o.obra_cidade ? ` · ${o.obra_cidade}${o.obra_uf ? '/' + o.obra_uf : ''}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {form && (
        <div onClick={() => !salvando && setForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 12px', zIndex: 50, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, border: `0.5px solid ${LINE}`, padding: 18, width: '100%', maxWidth: 520 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: ESP, marginBottom: 2 }}>{form.id ? 'Editar cliente' : 'Novo cliente'}</div>
            <div style={{ fontSize: 11, color: MUT, marginBottom: 14 }}>Cadastro de cliente de obra (PF ou PJ).</div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['PJ', 'PF'] as const).map((t) => (
                <button key={t} onClick={() => setForm({ ...form, tipo_pessoa: t })} style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${form.tipo_pessoa === t ? GOLD : LINE}`, background: form.tipo_pessoa === t ? 'rgba(200,148,26,0.10)' : '#FFF', color: form.tipo_pessoa === t ? GOLD_D : MUT }}>
                  {t === 'PJ' ? '🏢 Pessoa Jurídica' : '👤 Pessoa Física'}
                </button>
              ))}
            </div>

            <Campo label={form.tipo_pessoa === 'PF' ? 'Nome completo *' : 'Nome fantasia *'} v={form.nome_fantasia ?? ''} on={(v) => setForm({ ...form, nome_fantasia: v })} />
            {form.tipo_pessoa === 'PJ' && <Campo label="Razão social" v={form.razao_social ?? ''} on={(v) => setForm({ ...form, razao_social: v })} />}
            <Campo label={docLabel(form.tipo_pessoa ?? 'PJ')} v={form.cpf_cnpj ?? ''} on={(v) => setForm({ ...form, cpf_cnpj: v })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><Campo label="Telefone" v={form.telefone ?? ''} on={(v) => setForm({ ...form, telefone: v })} /></div>
              <div style={{ flex: 1 }}><Campo label="E-mail" v={form.email ?? ''} on={(v) => setForm({ ...form, email: v })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><Campo label="CEP" v={form.cep ?? ''} on={(v) => setForm({ ...form, cep: v })} /></div>
              <div style={{ flex: 2 }}><Campo label="Logradouro" v={form.logradouro ?? ''} on={(v) => setForm({ ...form, logradouro: v })} /></div>
              <div style={{ width: 80 }}><Campo label="Nº" v={form.numero ?? ''} on={(v) => setForm({ ...form, numero: v })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><Campo label="Bairro" v={form.bairro ?? ''} on={(v) => setForm({ ...form, bairro: v })} /></div>
              <div style={{ flex: 1 }}><Campo label="Cidade" v={form.cidade ?? ''} on={(v) => setForm({ ...form, cidade: v })} /></div>
              <div style={{ width: 64 }}><Campo label="UF" v={form.uf ?? ''} on={(v) => setForm({ ...form, uf: v })} /></div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setForm(null)} disabled={salvando} style={btnOutline}>Cancelar</button>
              <button onClick={salvar} disabled={salvando} style={{ ...btnGold, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : (form.id ? 'Salvar alterações' : 'Criar cliente')}</button>
            </div>
          </div>
        </div>
      )}
    </Casca>
  )
}

// ── Peças ────────────────────────────────────────────────────────────
function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Projetos · Comercial</p>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 2px' }}>Clientes de obra</h1>
        <p style={{ fontSize: 12, color: MUT, margin: '0 0 18px' }}>Clientes finais (PF/PJ) e suas obras. O cliente vira dono da obra, que ancora o orçamento.</p>
        {children}
      </div>
    </div>
  )
}
function Box({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>{children}</div>
}
function Campo({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} style={{ ...inp, width: '100%' }} />
    </label>
  )
}
const aviso = (fg: string, bg: string): React.CSSProperties => ({ background: bg, color: fg, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 })
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#FFF', color: ESP, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const btnDanger: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: `1px solid ${RED}55`, background: 'transparent', color: RED, fontSize: 13, fontWeight: 700, cursor: 'pointer' }
