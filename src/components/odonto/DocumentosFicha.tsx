'use client'
// OD-6 · Documentos: 4 tipos (contrato/termo/receituário/atestado) a partir de modelo → variáveis
// resolvidas com dados do paciente/clínica → pré-visualizar/editar → PDF (motor pdf-lib) → assinar
// (reusa fn_odonto_documento_assinar/hash) → salvo no bucket contratos-assinados. + editor de modelos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, EmptyStateOdonto, TOK } from './ui'
import { gerarDocumentoPdf } from '@/lib/odonto/documentoPdf'
import { FileText, ShieldCheck, Pill, FileCheck, ExternalLink } from 'lucide-react'

const BUCKET = 'contratos-assinados'
type Tipo = 'contrato' | 'termo' | 'receituario' | 'atestado'
const TIPOS: { id: Tipo; l: string; icon: typeof FileText }[] = [
  { id: 'contrato', l: 'Contrato', icon: FileText }, { id: 'termo', l: 'Termo de consentimento', icon: ShieldCheck },
  { id: 'receituario', l: 'Receituário', icon: Pill }, { id: 'atestado', l: 'Atestado', icon: FileCheck },
]
type Modelo = { id: string; tipo: string; nome: string; corpo: string; ativo?: boolean }
type Documento = { id: string; tipo: string; titulo: string | null; modelo_id: string | null; conteudo_final: string | null; pdf_path: string | null; assinado: boolean; assinado_em: string | null; assinatura_hash: string | null; created_at: string | null }
type Pac = { nome: string; cpf: string | null; rg: string | null; data_nascimento: string | null }
type Emp = { nome: string; cnpj: string | null }

const fmtData = (s: string | null | undefined) => { if (!s) return '—'; try { return new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return '—' } }
const hoje = () => new Date().toLocaleDateString('pt-BR')
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)
const VARS = ['paciente_nome', 'paciente_cpf', 'paciente_rg', 'paciente_nascimento', 'data', 'clinica_nome', 'clinica_cnpj', 'procedimentos']

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${TOK.line}`, borderRadius: 8, fontSize: 13, color: TOK.esp, background: '#fff', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnLine: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: TOK.esp, border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

export function DocumentosFicha({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [docs, setDocs] = useState<Documento[]>([])
  const [pac, setPac] = useState<Pac | null>(null)
  const [emp, setEmp] = useState<Emp>({ nome: 'Clínica', cnpj: null })
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<{ k: 'cards' } | { k: 'novo'; tipo: Tipo } | { k: 'hist'; tipo: Tipo } | { k: 'modelos' }>({ k: 'cards' })
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 3500) }

  const carregar = useCallback(async () => {
    const [{ data: mods }, { data: ds }, { data: p }, { data: c }] = await Promise.all([
      supabase.from('erp_odonto_documento_modelo').select('id, tipo, nome, corpo, ativo').eq('company_id', companyId).eq('ativo', true).order('nome'),
      supabase.rpc('fn_odonto_documento_paciente', { p_company_id: companyId, p_paciente_id: pacienteId }),
      supabase.from('erp_odonto_paciente').select('nome, cpf, rg, data_nascimento').eq('id', pacienteId).maybeSingle(),
      supabase.from('companies').select('razao_social, nome_fantasia, cnpj').eq('id', companyId).maybeSingle(),
    ])
    setModelos((mods as Modelo[] | null) ?? [])
    setDocs((ds as Documento[] | null) ?? [])
    setPac((p as Pac | null) ?? null)
    const cc = c as { razao_social?: string; nome_fantasia?: string; cnpj?: string } | null
    setEmp({ nome: cc?.razao_social || cc?.nome_fantasia || 'Clínica', cnpj: cc?.cnpj ?? null })
    setLoading(false)
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const fetchProcedimentos = useCallback(async (): Promise<string> => {
    const { data: planos } = await supabase.rpc('fn_odonto_planos_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
    const p0 = ((planos as { id: string }[] | null) ?? [])[0]
    if (!p0) return ''
    const { data: pl } = await supabase.rpc('fn_odonto_plano_obter', { p_id: p0.id })
    const itens = ((pl as { itens?: { descricao: string; dente: string | null }[] } | null)?.itens) ?? []
    return itens.map((i) => `- ${i.descricao}${i.dente ? ` (dente ${i.dente})` : ''}`).join('\n')
  }, [companyId, pacienteId])

  const resolver = useCallback(async (corpo: string): Promise<string> => {
    const map: Record<string, string> = {
      paciente_nome: pac?.nome ?? '', paciente_cpf: pac?.cpf ?? '', paciente_rg: pac?.rg ?? '',
      paciente_nascimento: pac?.data_nascimento ? fmtData(pac.data_nascimento) : '', data: hoje(),
      clinica_nome: emp.nome, clinica_cnpj: emp.cnpj ?? '',
      procedimentos: corpo.includes('{{procedimentos}}') ? await fetchProcedimentos() : '',
    }
    return corpo.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? `{{${k}}}`)
  }, [pac, emp, fetchProcedimentos])

  if (loading) return <div style={{ color: TOK.mut, fontSize: 13 }}>Carregando documentos…</div>

  if (view.k === 'novo') return <NovoDocumento tipo={view.tipo} companyId={companyId} pacienteId={pacienteId} modelos={modelos.filter((m) => m.tipo === view.tipo)} emp={emp} resolver={resolver}
    onCancel={() => setView({ k: 'cards' })} onSalvo={() => { setView({ k: 'hist', tipo: view.tipo }); flash('Documento gerado. Assine no histórico.'); void carregar() }} />
  if (view.k === 'hist') return <Historico tipo={view.tipo} companyId={companyId} emp={emp} docs={docs.filter((d) => d.tipo === view.tipo)} onVoltar={() => { setView({ k: 'cards' }); void carregar() }} onMudou={carregar} flash={flash} />
  if (view.k === 'modelos') return <ModelosEditor companyId={companyId} modelos={modelos} onVoltar={() => { setView({ k: 'cards' }); void carregar() }} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setView({ k: 'modelos' })} style={btnLine}>⚙ Modelos</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {TIPOS.map(({ id, l, icon: Ic }) => {
          const doTipo = docs.filter((d) => d.tipo === id)
          return (
            <CardOdonto key={id} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ic size={18} style={{ color: TOK.gold }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: TOK.esp }}>{l}</span>
              </div>
              <div style={{ fontSize: 11.5, color: TOK.mut, marginBottom: 10 }}>{doTipo.length} documento(s){doTipo.some((d) => d.assinado) ? ` · ${doTipo.filter((d) => d.assinado).length} assinado(s)` : ''}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setView({ k: 'novo', tipo: id })} style={{ ...btnGold, padding: '6px 12px', fontSize: 12 }}>Novo</button>
                <button onClick={() => setView({ k: 'hist', tipo: id })} style={{ ...btnLine, padding: '6px 12px', fontSize: 12 }}>Histórico</button>
              </div>
            </CardOdonto>
          )
        })}
      </div>
    </div>
  )
}

function NovoDocumento({ tipo, companyId, pacienteId, modelos, emp, resolver, onCancel, onSalvo }: {
  tipo: Tipo; companyId: string; pacienteId: string; modelos: Modelo[]; emp: Emp
  resolver: (corpo: string) => Promise<string>; onCancel: () => void; onSalvo: () => void
}) {
  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? '')
  const [conteudo, setConteudo] = useState('')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const modelo = useMemo(() => modelos.find((m) => m.id === modeloId) ?? null, [modelos, modeloId])
  const tituloTipo = TIPOS.find((t) => t.id === tipo)?.l ?? 'Documento'

  useEffect(() => {
    if (!modelo) { setConteudo(''); return }
    let alive = true
    void resolver(modelo.corpo).then((r) => { if (alive) setConteudo(r) })
    return () => { alive = false }
  }, [modelo, resolver])

  const gerar = async () => {
    if (!conteudo.trim()) { setErro('Conteúdo vazio.'); return }
    setGerando(true); setErro(null)
    try {
      const bytes = await gerarDocumentoPdf({ clinica: emp, titulo: tituloTipo, corpo: conteudo })
      const path = `${companyId}/${pacienteId}/${uuid()}.pdf`
      const up = await supabase.storage.from(BUCKET).upload(path, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
      if (up.error) throw new Error(up.error.message)
      const { data, error } = await supabase.rpc('fn_odonto_documento_salvar', {
        p_company_id: companyId, p_paciente_id: pacienteId,
        p_dados: { tipo, modelo_id: modeloId || null, titulo: tituloTipo, conteudo_final: conteudo, pdf_path: path },
      })
      if (error || (data as { ok?: boolean })?.ok === false) throw new Error((data as { erro?: string })?.erro || 'falha ao salvar')
      onSalvo()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao gerar o PDF.') } finally { setGerando(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onCancel} style={btnLine}>← Voltar</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: TOK.esp }}>Novo {tituloTipo}</span>
      </div>
      {modelos.length === 0 ? <EmptyStateOdonto titulo="Sem modelo" linha="Crie um modelo deste tipo em Modelos." /> : (
        <CardOdonto style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: TOK.mut, marginBottom: 4 }}>Modelo</div>
          <select value={modeloId} onChange={(e) => setModeloId(e.target.value)} style={inp}>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
          <div style={{ fontSize: 11, color: TOK.mut, margin: '12px 0 4px' }}>Pré-visualização (edite se precisar) · variáveis já resolvidas</div>
          <textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={14} style={{ ...inp, resize: 'vertical', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5 }} />
          {erro && <div style={{ fontSize: 12.5, color: TOK.red, marginTop: 8 }}>{erro}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button onClick={onCancel} style={btnLine}>Cancelar</button>
            <button onClick={() => void gerar()} disabled={gerando} style={{ ...btnGold, opacity: gerando ? 0.6 : 1 }}>{gerando ? 'Gerando PDF…' : 'Gerar PDF'}</button>
          </div>
        </CardOdonto>
      )}
    </div>
  )
}

function Historico({ tipo, companyId, emp, docs, onVoltar, onMudou, flash }: {
  tipo: Tipo; companyId: string; emp: Emp; docs: Documento[]; onVoltar: () => void; onMudou: () => Promise<void>; flash: (t: string) => void
}) {
  const abrir = async (d: Documento) => {
    if (!d.pdf_path) return
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(d.pdf_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }
  const assinar = async (d: Documento) => {
    if (!confirm('Assinar este documento? Depois de assinado, fica imutável.')) return
    const { data, error } = await supabase.rpc('fn_odonto_documento_assinar', { p_company_id: companyId, p_documento_id: d.id, p_metodo: 'senha_app' })
    const r = data as { ok?: boolean; assinatura_hash?: string; assinado_em?: string } | null
    if (error || !r?.ok) { flash('Falha ao assinar.'); return }
    // regenera o PDF com o carimbo de assinatura e regrava no mesmo caminho (upsert)
    try {
      const bytes = await gerarDocumentoPdf({
        clinica: emp, titulo: TIPOS.find((t) => t.id === tipo)?.l ?? 'Documento', corpo: d.conteudo_final ?? '',
        assinatura: { data: fmtData(r.assinado_em), hashCurto: r.assinatura_hash?.slice(0, 12) },
      })
      if (d.pdf_path) await supabase.storage.from(BUCKET).upload(d.pdf_path, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
    } catch { /* PDF carimbado é best-effort; o registro/hash já garante a assinatura */ }
    flash('Documento assinado.'); await onMudou()
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onVoltar} style={btnLine}>← Voltar</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: TOK.esp }}>Histórico · {TIPOS.find((t) => t.id === tipo)?.l}</span>
      </div>
      {docs.length === 0 ? <EmptyStateOdonto titulo="Sem documentos" linha="Gere o primeiro documento deste tipo." /> :
        docs.map((d) => (
          <CardOdonto key={d.id} style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TOK.esp }}>{d.titulo || TIPOS.find((t) => t.id === tipo)?.l}</div>
              <div style={{ fontSize: 11.5, color: TOK.mut }}>{fmtData(d.created_at)} · {d.assinado ? <span style={{ color: TOK.green, fontWeight: 700 }}>✓ Assinado{d.assinado_em ? ` · ${fmtData(d.assinado_em)}` : ''}</span> : 'Sem assinatura'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {d.pdf_path && <button onClick={() => void abrir(d)} style={btnLine}><ExternalLink size={13} /> PDF</button>}
              {!d.assinado && <button onClick={() => void assinar(d)} style={{ ...btnGold, padding: '6px 12px', fontSize: 12 }}>Assinar</button>}
            </div>
          </CardOdonto>
        ))}
    </div>
  )
}

function ModelosEditor({ companyId, modelos, onVoltar }: { companyId: string; modelos: Modelo[]; onVoltar: () => void }) {
  const [sel, setSel] = useState<Modelo | 'novo' | null>(null)
  const [tipo, setTipo] = useState<Tipo>('contrato')
  const [nome, setNome] = useState('')
  const [corpo, setCorpo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const abrir = (m: Modelo | 'novo') => {
    setSel(m)
    if (m === 'novo') { setTipo('contrato'); setNome(''); setCorpo('') }
    else { setTipo((m.tipo as Tipo) || 'contrato'); setNome(m.nome); setCorpo(m.corpo) }
  }
  const salvar = async () => {
    if (!nome.trim()) { setMsg('Informe o nome.'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_odonto_documento_modelo_salvar', {
      p_company_id: companyId, p_modelo: { tipo, nome: nome.trim(), corpo }, p_modelo_id: sel && sel !== 'novo' ? sel.id : null,
    })
    setSalvando(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg('Falha ao salvar.'); return }
    setSel(null); onVoltar()
  }

  if (sel) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button onClick={() => setSel(null)} style={btnLine}>← Modelos</button>
      <CardOdonto style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} style={inp}>{TIPOS.map((t) => <option key={t.id} value={t.id}>{t.l}</option>)}</select></label>
          <label><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} style={inp} /></label>
        </div>
        <div style={{ fontSize: 11, color: TOK.mut, margin: '12px 0 4px' }}>Corpo · variáveis: {VARS.map((v) => `{{${v}}}`).join('  ')}</div>
        <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={14} style={{ ...inp, resize: 'vertical', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5 }} />
        {msg && <div style={{ fontSize: 12.5, color: TOK.green, marginTop: 8, fontWeight: 600 }}>{msg}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={() => setSel(null)} style={btnLine}>Cancelar</button>
          <button onClick={() => void salvar()} disabled={salvando} style={{ ...btnGold, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : 'Salvar modelo'}</button>
        </div>
      </CardOdonto>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <button onClick={onVoltar} style={btnLine}>← Documentos</button>
        <button onClick={() => abrir('novo')} style={btnGold}>+ Novo modelo</button>
      </div>
      {modelos.map((m) => (
        <CardOdonto key={m.id} style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div><div style={{ fontSize: 13.5, fontWeight: 700, color: TOK.esp }}>{m.nome}</div><div style={{ fontSize: 11.5, color: TOK.mut }}>{TIPOS.find((t) => t.id === m.tipo)?.l ?? m.tipo}</div></div>
          <button onClick={() => abrir(m)} style={btnLine}>Editar</button>
        </CardOdonto>
      ))}
    </div>
  )
}
