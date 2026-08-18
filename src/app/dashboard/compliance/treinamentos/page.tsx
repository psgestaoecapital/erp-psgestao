'use client'
// Compliance · Treinamentos NR (genérico, multi-tenant). Substitui o placeholder EM CONSTRUÇÃO.
// 3 abas: Tipos (incluir/editar/excluir — pedido do CEO) · Turmas (criar, presença, certificado) ·
// Matriz (por funcionário: semáforo de validade + dias p/ vencer). RPCs fn_nr_*; certificado via API
// (bucket 'compliance'). Reusa compliance_funcionarios; alerta de reciclagem via erp_alerta_proativo (cron).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import { rpc, authFetch } from '@/lib/authFetch'
import { GraduationCap, Users, ShieldAlert, Plus, Pencil, Trash2, X, Ban, ClipboardCheck, Upload, FileText, Loader2 } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  ink: '#1a1a1a', green: '#2d6a3e', greenBg: '#e8f3ec', amber: '#8a6a10', amberBg: '#fdf4e0',
  red: '#a02020', redBg: '#fce8e8', gray: '#6b6b6b',
}
type Tipo = { id: string; nr_codigo: string | null; nome: string; carga_horaria: number | null; validade_meses: number | null; reciclagem_meses: number | null; obrigatorio: boolean; ativo: boolean; turmas: number }
type Turma = { id: string; tipo_id: string; nr_codigo: string | null; tipo_nome: string; data_realizacao: string | null; instrutor: string | null; carga_horaria: number | null; local: string | null; status: string; observacao: string | null; presentes: number; com_certificado: number }
type MatrizItem = { funcionario_id: string; funcionario: string; cargo: string | null; setor: string | null; nr_codigo: string | null; tipo_nome: string; data_realizacao: string | null; validade_ate: string | null; dias_para_vencer: number | null; tem_certificado: boolean; status: string }
type Func = { id: string; nome_completo: string; cargo: string | null; setor: string | null }
type Presenca = { id: string; funcionario_id: string; presente: boolean; certificado_url: string | null; validade_ate: string | null; nome: string }

const semaforo: Record<string, { c: string; bg: string; label: string }> = {
  valido: { c: C.green, bg: C.greenBg, label: 'Válido' },
  a_vencer: { c: C.amber, bg: C.amberBg, label: 'A vencer' },
  vencido: { c: C.red, bg: C.redBg, label: 'Vencido' },
  sem_validade: { c: C.gray, bg: '#eee', label: 'Sem validade' },
}
const fmtData = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'

export default function TreinamentosNRPage() {
  const { sel, selInfo, loading: loadingCia } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [aba, setAba] = useState<'tipos' | 'turmas' | 'matriz'>('tipos')

  if (loadingCia) return <Wrap><div style={{ color: C.gray, padding: 40 }}>Carregando…</div></Wrap>
  if (!companyId) return (
    <Wrap>
      <Header />
      <Vazio titulo="Selecione uma empresa" texto="Treinamentos NR são por empresa. Escolha uma empresa específica no seletor do topo (não Consolidado/Grupo)." />
    </Wrap>
  )

  return (
    <Wrap>
      <Header />
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}`, flexWrap: 'wrap' }}>
        {([['tipos', 'Tipos de Treinamento', GraduationCap], ['turmas', 'Turmas', Users], ['matriz', 'Matriz / Vencimentos', ShieldAlert]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setAba(k)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 14, fontWeight: aba === k ? 700 : 500, color: aba === k ? C.espresso : C.gray,
            borderBottom: `2px solid ${aba === k ? C.gold : 'transparent'}`, marginBottom: -1,
          }}><Icon size={16} /> {label}</button>
        ))}
      </div>
      {aba === 'tipos' && <AbaTipos companyId={companyId} />}
      {aba === 'turmas' && <AbaTurmas companyId={companyId} />}
      {aba === 'matriz' && <AbaMatriz companyId={companyId} />}
    </Wrap>
  )
}

// ─────────────────────────────────────────── Aba Tipos ───────────────────────────────────────────
function AbaTipos({ companyId }: { companyId: string }) {
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Partial<Tipo> | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try { const r = await rpc<{ tipos: Tipo[] }>('fn_nr_tipo_listar', { p_company_id: companyId }); setTipos(r.tipos || []) }
    catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const salvar = async () => {
    if (!edit) return
    setErro('')
    try {
      await rpc('fn_nr_tipo_salvar', { p_company_id: companyId, p_payload: {
        id: edit.id ?? null, nr_codigo: edit.nr_codigo ?? '', nome: edit.nome ?? '',
        carga_horaria: edit.carga_horaria ?? null, validade_meses: edit.validade_meses ?? null,
        reciclagem_meses: edit.reciclagem_meses ?? null, obrigatorio: edit.obrigatorio ?? false,
      } })
      setEdit(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  const excluir = async (t: Tipo) => {
    if (!confirm(`Excluir "${t.nome}"?${t.turmas > 0 ? ' (há turmas — será desativado, preservando o histórico)' : ''}`)) return
    try { await rpc('fn_nr_tipo_excluir', { p_company_id: companyId, p_id: t.id }); void carregar() }
    catch (e) { alert((e as Error).message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.gray }}>{tipos.length} tipo(s) cadastrado(s)</div>
        <Btn onClick={() => setEdit({ obrigatorio: false })}><Plus size={15} /> Incluir treinamento</Btn>
      </div>
      {loading ? <Load /> : tipos.length === 0 ? (
        <Vazio titulo="Nenhum treinamento cadastrado" texto="Cadastre o primeiro tipo de treinamento (ex.: NR-35 · Trabalho em Altura)." />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {tipos.map(t => (
            <div key={t.id} style={card()}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {t.nr_codigo && <span style={pillGold()}>{t.nr_codigo}</span>}
                  <span style={{ fontWeight: 700, color: C.espresso }}>{t.nome}</span>
                  {t.obrigatorio && <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>OBRIGATÓRIO</span>}
                </div>
                <div style={{ fontSize: 12.5, color: C.gray, marginTop: 3 }}>
                  {t.carga_horaria ? `${t.carga_horaria}h · ` : ''}{t.validade_meses ? `validade ${t.validade_meses} meses` : 'sem validade'}
                  {t.reciclagem_meses ? ` · reciclagem ${t.reciclagem_meses} meses` : ''} · {t.turmas} turma(s)
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <IconBtn title="Editar" onClick={() => setEdit(t)}><Pencil size={15} /></IconBtn>
                <IconBtn title="Excluir" onClick={() => excluir(t)} danger><Trash2 size={15} /></IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal titulo={edit.id ? 'Editar treinamento' : 'Novo treinamento'} onClose={() => setEdit(null)}>
          <Campo label="Código NR (opcional)"><input style={inp()} value={edit.nr_codigo ?? ''} onChange={e => setEdit({ ...edit, nr_codigo: e.target.value })} placeholder="NR-35" /></Campo>
          <Campo label="Nome *"><input style={inp()} value={edit.nome ?? ''} onChange={e => setEdit({ ...edit, nome: e.target.value })} placeholder="Trabalho em Altura" /></Campo>
          <div style={{ display: 'flex', gap: 10 }}>
            <Campo label="Carga horária (h)"><input type="number" style={inp()} value={edit.carga_horaria ?? ''} onChange={e => setEdit({ ...edit, carga_horaria: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
            <Campo label="Validade (meses)"><input type="number" style={inp()} value={edit.validade_meses ?? ''} onChange={e => setEdit({ ...edit, validade_meses: e.target.value === '' ? null : Number(e.target.value) })} placeholder="24" /></Campo>
            <Campo label="Reciclagem (meses)"><input type="number" style={inp()} value={edit.reciclagem_meses ?? ''} onChange={e => setEdit({ ...edit, reciclagem_meses: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: C.espresso, cursor: 'pointer', marginTop: 4 }}>
            <input type="checkbox" checked={edit.obrigatorio ?? false} onChange={e => setEdit({ ...edit, obrigatorio: e.target.checked })} /> Obrigatório
          </label>
          {erro && <div style={erroBox()}>{erro}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <BtnGhost onClick={() => setEdit(null)}>Cancelar</BtnGhost>
            <Btn onClick={salvar}>Salvar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─────────────────────────────────────────── Aba Turmas ──────────────────────────────────────────
function AbaTurmas({ companyId }: { companyId: string }) {
  const [turmas, setTurmas] = useState<Turma[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Partial<Turma> | null>(null)
  const [presencaTurma, setPresencaTurma] = useState<Turma | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [rt, rtipos] = await Promise.all([
        rpc<{ turmas: Turma[] }>('fn_nr_turma_listar', { p_company_id: companyId }),
        rpc<{ tipos: Tipo[] }>('fn_nr_tipo_listar', { p_company_id: companyId }),
      ])
      setTurmas(rt.turmas || []); setTipos(rtipos.tipos || [])
    } catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const salvar = async () => {
    if (!edit) return
    setErro('')
    try {
      await rpc('fn_nr_turma_salvar', { p_company_id: companyId, p_payload: {
        id: edit.id ?? null, tipo_id: edit.tipo_id ?? '', data_realizacao: edit.data_realizacao ?? '',
        instrutor: edit.instrutor ?? '', carga_horaria: edit.carga_horaria ?? null, local: edit.local ?? '',
        status: edit.status ?? 'planejada', observacao: edit.observacao ?? '',
      } })
      setEdit(null); void carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  const cancelar = async (t: Turma) => {
    if (!confirm(`Cancelar a turma de "${t.tipo_nome}"?`)) return
    try { await rpc('fn_nr_turma_cancelar', { p_company_id: companyId, p_id: t.id }); void carregar() } catch (e) { alert((e as Error).message) }
  }

  const statusCor = (s: string) => s === 'realizada' ? C.green : s === 'cancelada' ? C.red : C.amber

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.gray }}>{turmas.length} turma(s)</div>
        <Btn onClick={() => setEdit({ status: 'planejada' })} disabled={tipos.length === 0}><Plus size={15} /> Nova turma</Btn>
      </div>
      {tipos.length === 0 && !loading && <div style={{ fontSize: 12.5, color: C.amber, marginBottom: 10 }}>Cadastre um tipo de treinamento antes de criar turmas.</div>}
      {loading ? <Load /> : turmas.length === 0 ? (
        <Vazio titulo="Nenhuma turma" texto="Crie a primeira turma de treinamento e marque a presença dos funcionários." />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {turmas.map(t => (
            <div key={t.id} style={card()}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {t.nr_codigo && <span style={pillGold()}>{t.nr_codigo}</span>}
                  <span style={{ fontWeight: 700, color: C.espresso }}>{t.tipo_nome}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: statusCor(t.status), textTransform: 'uppercase' }}>{t.status}</span>
                </div>
                <div style={{ fontSize: 12.5, color: C.gray, marginTop: 3 }}>
                  {fmtData(t.data_realizacao)}{t.instrutor ? ` · ${t.instrutor}` : ''}{t.local ? ` · ${t.local}` : ''} · {t.presentes} presente(s) · {t.com_certificado} certificado(s)
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <BtnGhost onClick={() => setPresencaTurma(t)}><ClipboardCheck size={14} /> Presença</BtnGhost>
                <IconBtn title="Editar" onClick={() => setEdit(t)}><Pencil size={15} /></IconBtn>
                {t.status !== 'cancelada' && <IconBtn title="Cancelar turma" onClick={() => cancelar(t)} danger><Ban size={15} /></IconBtn>}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal titulo={edit.id ? 'Editar turma' : 'Nova turma'} onClose={() => setEdit(null)}>
          <Campo label="Treinamento *">
            <select style={inp()} value={edit.tipo_id ?? ''} onChange={e => setEdit({ ...edit, tipo_id: e.target.value })}>
              <option value="">Selecione…</option>
              {tipos.map(tp => <option key={tp.id} value={tp.id}>{tp.nr_codigo ? `${tp.nr_codigo} · ` : ''}{tp.nome}</option>)}
            </select>
          </Campo>
          <div style={{ display: 'flex', gap: 10 }}>
            <Campo label="Data de realização"><input type="date" style={inp()} value={edit.data_realizacao ?? ''} onChange={e => setEdit({ ...edit, data_realizacao: e.target.value })} /></Campo>
            <Campo label="Situação">
              <select style={inp()} value={edit.status ?? 'planejada'} onChange={e => setEdit({ ...edit, status: e.target.value })}>
                <option value="planejada">Planejada</option><option value="realizada">Realizada</option><option value="cancelada">Cancelada</option>
              </select>
            </Campo>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Campo label="Instrutor"><input style={inp()} value={edit.instrutor ?? ''} onChange={e => setEdit({ ...edit, instrutor: e.target.value })} /></Campo>
            <Campo label="Carga horária (h)"><input type="number" style={inp()} value={edit.carga_horaria ?? ''} onChange={e => setEdit({ ...edit, carga_horaria: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
          </div>
          <Campo label="Local"><input style={inp()} value={edit.local ?? ''} onChange={e => setEdit({ ...edit, local: e.target.value })} /></Campo>
          <Campo label="Observação"><input style={inp()} value={edit.observacao ?? ''} onChange={e => setEdit({ ...edit, observacao: e.target.value })} /></Campo>
          {erro && <div style={erroBox()}>{erro}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <BtnGhost onClick={() => setEdit(null)}>Cancelar</BtnGhost>
            <Btn onClick={salvar}>Salvar</Btn>
          </div>
        </Modal>
      )}
      {presencaTurma && <PresencaPanel companyId={companyId} turma={presencaTurma} onClose={() => { setPresencaTurma(null); void carregar() }} />}
    </div>
  )
}

// Painel de presença + certificados de uma turma
function PresencaPanel({ companyId, turma, onClose }: { companyId: string; turma: Turma; onClose: () => void }) {
  const [funcs, setFuncs] = useState<Func[]>([])
  const [presencas, setPresencas] = useState<Presenca[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    const [{ data: fdata }, { data: pdata }] = await Promise.all([
      supabase.from('compliance_funcionarios').select('id, nome_completo, cargo, setor').eq('company_id', companyId).order('nome_completo'),
      supabase.from('nr_turma_presenca').select('id, funcionario_id, presente, certificado_url, validade_ate, compliance_funcionarios(nome_completo)').eq('turma_id', turma.id),
    ])
    setFuncs((fdata as Func[]) || [])
    const pres = ((pdata as unknown[]) || []).map((r) => {
      const row = r as { id: string; funcionario_id: string; presente: boolean; certificado_url: string | null; validade_ate: string | null; compliance_funcionarios?: { nome_completo?: string } }
      return { id: row.id, funcionario_id: row.funcionario_id, presente: row.presente, certificado_url: row.certificado_url, validade_ate: row.validade_ate, nome: row.compliance_funcionarios?.nome_completo || '' }
    })
    setPresencas(pres)
    setSel(new Set(pres.filter(p => p.presente).map(p => p.funcionario_id)))
    setLoading(false)
  }, [companyId, turma.id])
  useEffect(() => { void carregar() }, [carregar])

  const salvarPresenca = async () => {
    setSalvando(true)
    try { await rpc('fn_nr_presenca_registrar', { p_company_id: companyId, p_turma_id: turma.id, p_funcionarios: [...sel] }); await carregar() }
    catch (e) { alert((e as Error).message) } finally { setSalvando(false) }
  }
  const anexar = async (presencaId: string, file: File) => {
    setUploading(presencaId)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('company_id', companyId); fd.append('presenca_id', presencaId)
      const res = await authFetch('/api/compliance/nr-certificado', { method: 'POST', body: fd })
      const j = await res.json(); if (!res.ok || !j.ok) throw new Error(j.error || 'falha no upload')
      await carregar()
    } catch (e) { alert((e as Error).message) } finally { setUploading(null) }
  }
  const verCert = async (presencaId: string) => {
    const res = await authFetch(`/api/compliance/nr-certificado/${presencaId}`)
    const j = await res.json(); if (j.ok && j.signed_url) window.open(j.signed_url, '_blank'); else alert('Certificado indisponível')
  }
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <Modal titulo={`Presença · ${turma.tipo_nome}`} onClose={onClose} wide>
      {loading ? <Load /> : (
        <>
          <div style={{ fontSize: 12.5, color: C.gray, marginBottom: 8 }}>
            Marque quem participou. {turma.status !== 'realizada' && <span style={{ color: C.amber }}>Marque a turma como <b>Realizada</b> (na edição) para calcular a validade dos certificados.</span>}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.borderLt}`, borderRadius: 8, marginBottom: 12 }}>
            {funcs.length === 0 ? <div style={{ padding: 16, color: C.gray, fontSize: 13 }}>Nenhum funcionário cadastrado nesta empresa.</div> : funcs.map(f => (
              <label key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${C.beigeLt}`, cursor: 'pointer', fontSize: 13.5 }}>
                <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} />
                <span style={{ flex: 1, color: C.espresso }}>{f.nome_completo}</span>
                <span style={{ fontSize: 11.5, color: C.gray }}>{f.cargo || ''}{f.setor ? ` · ${f.setor}` : ''}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <Btn onClick={salvarPresenca} disabled={salvando}>{salvando ? <Loader2 size={14} className="spin" /> : <ClipboardCheck size={14} />} Salvar presença ({sel.size})</Btn>
          </div>
          {presencas.filter(p => p.presente).length > 0 && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.espresso, marginBottom: 6 }}>Certificados</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {presencas.filter(p => p.presente).map(p => (
                  <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', border: `1px solid ${C.borderLt}`, borderRadius: 8, fontSize: 13 }}>
                    <span style={{ flex: 1, color: C.espresso }}>{p.nome}</span>
                    {p.validade_ate && <span style={{ fontSize: 11.5, color: C.gray }}>válido até {fmtData(p.validade_ate)}</span>}
                    {p.certificado_url ? (
                      <BtnGhost onClick={() => verCert(p.id)}><FileText size={13} /> Ver</BtnGhost>
                    ) : null}
                    <label style={{ ...ghostStyle(), cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {uploading === p.id ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} {p.certificado_url ? 'Trocar' : 'Anexar'}
                      <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void anexar(p.id, f); e.target.value = '' }} />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <style>{'.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </Modal>
  )
}

// ─────────────────────────────────────────── Aba Matriz ──────────────────────────────────────────
function AbaMatriz({ companyId }: { companyId: string }) {
  const [itens, setItens] = useState<MatrizItem[]>([])
  const [loading, setLoading] = useState(true)
  const [soVencer, setSoVencer] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try { const r = await rpc<{ matriz: MatrizItem[] }>('fn_nr_matriz_funcionario', { p_company_id: companyId }); setItens(r.matriz || []) }
      catch { setItens([]) } finally { setLoading(false) }
    })()
  }, [companyId])

  const filtrados = useMemo(() => soVencer ? itens.filter(i => i.status === 'vencido' || i.status === 'a_vencer') : itens, [itens, soVencer])

  if (loading) return <Load />
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: C.gray }}>{filtrados.length} registro(s)</div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: C.espresso, cursor: 'pointer' }}>
          <input type="checkbox" checked={soVencer} onChange={e => setSoVencer(e.target.checked)} /> Só vencidos / a vencer
        </label>
      </div>
      {filtrados.length === 0 ? (
        <Vazio titulo="Sem registros" texto={soVencer ? 'Nenhum treinamento vencido ou a vencer.' : 'Nenhuma presença em turma realizada ainda. Marque presenças nas turmas.'} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()}>Funcionário</th><th style={th()}>Treinamento</th><th style={th()}>Realizado</th><th style={th()}>Válido até</th><th style={th()}>Dias</th><th style={th()}>Situação</th>
            </tr></thead>
            <tbody>
              {filtrados.map((i, idx) => { const s = semaforo[i.status] || semaforo.sem_validade; return (
                <tr key={i.funcionario_id + i.tipo_nome + idx} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                  <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{i.funcionario}</div><div style={{ fontSize: 11, color: C.gray }}>{i.cargo || ''}{i.setor ? ` · ${i.setor}` : ''}</div></td>
                  <td style={td()}>{i.nr_codigo && <span style={pillGold()}>{i.nr_codigo}</span>} {i.tipo_nome}{i.tem_certificado && <FileText size={12} style={{ marginLeft: 4, color: C.gray, verticalAlign: 'middle' }} />}</td>
                  <td style={td()}>{fmtData(i.data_realizacao)}</td>
                  <td style={td()}>{fmtData(i.validade_ate)}</td>
                  <td style={td()}>{i.dias_para_vencer == null ? '—' : i.dias_para_vencer}</td>
                  <td style={td()}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg, color: s.c, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s.c }} /> {s.label}</span></td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────── UI helpers ──────────────────────────────────────────
function Wrap({ children }: { children: React.ReactNode }) { return <div style={{ background: C.offwhite, minHeight: '100vh', padding: '24px clamp(14px,4vw,36px)' }}><div style={{ maxWidth: 1100, margin: '0 auto' }}>{children}</div></div> }
function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, background: '#F3E6C9', color: C.gold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><GraduationCap size={22} /></span>
      <div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 23, fontWeight: 400, color: C.espresso, margin: 0 }}>Treinamentos NR</h1>
        <div style={{ fontSize: 12, color: C.gray }}>Tipos por NR · turmas · presença · certificados · alertas de reciclagem</div>
      </div>
    </div>
  )
}
function Vazio({ titulo, texto }: { titulo: string; texto: string }) { return <div style={{ background: '#fff', border: `1px dashed ${C.borderLt}`, borderRadius: 14, padding: '34px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: C.espresso }}>{titulo}</div><div style={{ fontSize: 13, color: C.gray, marginTop: 5, maxWidth: 440, marginInline: 'auto' }}>{texto}</div></div> }
function Load() { return <div style={{ color: C.gray, padding: 30, textAlign: 'center', fontSize: 13 }}>Carregando…</div> }
function card(): React.CSSProperties { return { display: 'flex', gap: 12, alignItems: 'center', background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 12, padding: '12px 14px' } }
function pillGold(): React.CSSProperties { return { fontSize: 11, fontWeight: 800, color: C.gold, background: '#F3E6C9', borderRadius: 6, padding: '2px 7px' } }
function th(): React.CSSProperties { return { padding: '8px 10px', fontWeight: 600, fontSize: 12 } }
function td(): React.CSSProperties { return { padding: '9px 10px', verticalAlign: 'top' } }
function inp(): React.CSSProperties { return { width: '100%', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '8px 10px', fontSize: 13.5, color: C.ink, background: '#fff' } }
function erroBox(): React.CSSProperties { return { background: C.redBg, color: C.red, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, marginTop: 10 } }
function ghostStyle(): React.CSSProperties { return { border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' } }
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ marginBottom: 10, flex: 1 }}><label style={{ display: 'block', fontSize: 12, color: C.gray, marginBottom: 4 }}>{label}</label>{children}</div> }
function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: disabled ? '#d9c9a6' : C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' }}>{children}</button> }
function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) { return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...ghostStyle() }}>{children}</button> }
function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick?: () => void; title?: string; danger?: boolean }) { return <button title={title} onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: `1px solid ${C.borderLt}`, background: '#fff', color: danger ? C.red : C.espresso, borderRadius: 8, cursor: 'pointer' }}>{children}</button> }
function Modal({ titulo, children, onClose, wide }: { titulo: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', zIndex: 50, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: wide ? 620 : 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.espresso }}>{titulo}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.gray }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
