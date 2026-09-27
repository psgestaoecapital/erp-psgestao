// SST · LTCAT — passo 2 (#77 / #53): por SETOR → FUNÇÃO, a descrição das atividades, os RISCOS, os EPIs
// obrigatórios e os TREINAMENTOS. Uma função é salva inteira numa chamada (fn_ltcat_funcao_salvar, atômica);
// a leitura vem toda de fn_ltcat_painel. O sistema organiza a informação — o laudo é assinado pelo profissional.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Pencil, Trash2, X, ShieldAlert, HardHat, GraduationCap } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  gray: '#6b6b6b', green: '#2d6a3e', greenBg: '#e8f3ec', red: '#a02020', redBg: '#fce8e8',
}

type Risco = { tipo: string; descricao: string; grau: string | null }
type Funcao = {
  id: string; numero: string; nome: string; descricao: string | null; riscos: Risco[]
  epis: { catalogo_id: string; nome: string; ca: string }[]
  treinamentos: { tipo_id: string; nome: string; nr: string | null }[]
}
type Setor = { id: string; nome: string; funcoes: Funcao[] }
type Listas = { epis: { id: string; nome: string; ca: string; global: boolean }[]; treinamentos: { id: string; nome: string; nr: string | null }[] }
type Edicao = { id?: string; nome: string; descricao: string; riscos: Risco[]; epis: Set<string>; treinamentos: Set<string> }

const TIPOS_RISCO: { value: string; label: string }[] = [
  { value: 'fisico', label: 'Físico' }, { value: 'quimico', label: 'Químico' }, { value: 'biologico', label: 'Biológico' },
  { value: 'ergonomico', label: 'Ergonômico' }, { value: 'acidente', label: 'Acidente' },
]
const ERROS: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome da função.',
  risco_tipo_invalido: 'Tipo de risco inválido.',
  risco_sem_descricao: 'Todo risco precisa de uma descrição.',
  epi_de_outra_empresa: 'EPI não pertence a esta empresa.',
  treinamento_de_outra_empresa: 'Treinamento não pertence a esta empresa.',
  setor_invalido: 'Setor inválido.',
  sem_acesso: 'Sem acesso a esta empresa.',
}
const vazio = (): Edicao => ({ nome: '', descricao: '', riscos: [], epis: new Set(), treinamentos: new Set() })

export default function LtcatFuncoes({ companyId, recarregarChave }: { companyId: string; recarregarChave?: number }) {
  const [setores, setSetores] = useState<Setor[]>([])
  const [listas, setListas] = useState<Listas>({ epis: [], treinamentos: [] })
  const [setorId, setSetorId] = useState<string>('')
  const [edit, setEdit] = useState<Edicao | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const { data, error } = await supabase.rpc('fn_ltcat_painel', { p_company_id: companyId })
      if (error) throw error
      const r = data as { ok: boolean; erro?: string; setores?: Setor[]; listas?: Listas }
      if (!r?.ok) throw new Error(ERROS[r?.erro || ''] || r?.erro || 'falha ao carregar')
      setSetores(r.setores || []); setListas(r.listas || { epis: [], treinamentos: [] })
      setSetorId((prev) => (prev && (r.setores || []).some((s) => s.id === prev)) ? prev : (r.setores?.[0]?.id || ''))
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar, recarregarChave])

  const setor = useMemo(() => setores.find((s) => s.id === setorId) || null, [setores, setorId])

  const abrir = (f?: Funcao) => {
    setOk(''); setErro('')
    setEdit(f ? {
      id: f.id, nome: f.nome, descricao: f.descricao || '', riscos: f.riscos.map((r) => ({ ...r })),
      epis: new Set(f.epis.map((e) => e.catalogo_id)), treinamentos: new Set(f.treinamentos.map((t) => t.tipo_id)),
    } : vazio())
  }

  const salvar = async () => {
    if (!edit || !setor) return
    setSalvando(true); setErro(''); setOk('')
    try {
      const { data, error } = await supabase.rpc('fn_ltcat_funcao_salvar', { p_dados: {
        id: edit.id ?? null, company_id: companyId, setor_id: setor.id, nome: edit.nome, descricao: edit.descricao,
        riscos: edit.riscos.map((r) => ({ tipo: r.tipo, descricao: r.descricao, grau: r.grau || null })),
        epis: Array.from(edit.epis), treinamentos: Array.from(edit.treinamentos),
      } })
      if (error) throw error
      const r = data as { ok: boolean; erro?: string }
      if (!r?.ok) throw new Error(ERROS[r?.erro || ''] || r?.erro || 'falha ao salvar')
      setOk(`Função "${edit.nome.trim()}" salva.`); setEdit(null)
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }

  const remover = async (f: Funcao) => {
    if (!window.confirm(`Remover a função "${f.nome}" do LTCAT deste setor?`)) return
    setErro(''); setOk('')
    const { data, error } = await supabase.rpc('fn_ltcat_funcao_excluir', { p_id: f.id })
    const r = data as { ok: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message || ERROS[r?.erro || ''] || 'falha ao remover'); return }
    setOk(`Função "${f.nome}" removida.`); await carregar()
  }

  return (
    <section data-testid="ltcat-passo2" style={{ marginTop: 28 }}>
      <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, color: C.espresso }}>Passo 2 · Funções, riscos, EPIs e treinamentos</div>
      <div style={{ fontSize: 13, color: C.gray, margin: '4px 0 12px' }}>Escolha o setor e cadastre cada função: o que ela faz, a que riscos está exposta, os EPIs obrigatórios e os treinamentos exigidos.</div>

      {erro && <div style={box(C.redBg, C.red)}>{erro}</div>}
      {ok && <div style={box(C.greenBg, C.green)}>{ok}</div>}

      {!carregando && setores.length === 0 ? (
        <div style={vazioBox}>Nenhum setor cadastrado ainda. Importe os setores do ponto no passo 1 acima.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {setores.map((s) => (
              <button key={s.id} onClick={() => { setSetorId(s.id); setEdit(null) }} data-testid="ltcat-setor"
                style={{ borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${s.id === setorId ? C.gold : C.borderLt}`, background: s.id === setorId ? C.gold : '#fff',
                  color: s.id === setorId ? '#fff' : C.espresso }}>
                {s.nome} · {s.funcoes.length}
              </button>
            ))}
          </div>

          {setor && !edit && (
            <>
              {setor.funcoes.length === 0 && <div style={vazioBox}>Nenhuma função em {setor.nome} ainda.</div>}
              <div style={{ display: 'grid', gap: 10 }}>
                {setor.funcoes.map((f) => (
                  <div key={f.id} data-testid="ltcat-funcao" style={{ background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: C.espresso }}>{f.nome} <span style={{ color: C.gray, fontWeight: 400, fontSize: 12 }}>· {f.numero}</span></div>
                        {f.descricao && <div style={{ fontSize: 12.5, color: C.gray, marginTop: 2 }}>{f.descricao}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <IconBtn onClick={() => abrir(f)} label={`Editar ${f.nome}`}><Pencil size={14} /></IconBtn>
                        <IconBtn onClick={() => remover(f)} label={`Remover ${f.nome}`}><Trash2 size={14} /></IconBtn>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: C.espresso }}>
                      <span><ShieldAlert size={13} style={ic} />{f.riscos.length} risco(s){f.riscos.length > 0 && `: ${f.riscos.map((r) => r.descricao).join(', ')}`}</span>
                      <span><HardHat size={13} style={ic} />{f.epis.length} EPI(s){f.epis.length > 0 && `: ${f.epis.map((e) => e.nome).join(', ')}`}</span>
                      <span><GraduationCap size={13} style={ic} />{f.treinamentos.length} treinamento(s){f.treinamentos.length > 0 && `: ${f.treinamentos.map((t) => t.nr || t.nome).join(', ')}`}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => abrir()} style={{ ...btnPri, marginTop: 12 }}><Plus size={14} /> Nova função em {setor.nome}</button>
            </>
          )}

          {setor && edit && (
            <div data-testid="ltcat-editor" style={{ background: '#fff', border: `1px solid ${C.gold}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, color: C.espresso, marginBottom: 10 }}>{edit.id ? 'Editar função' : 'Nova função'} · {setor.nome}</div>

              <Rotulo texto="Nome da função">
                <input aria-label="Nome da função" value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} placeholder="Ex.: Operador de sangria" style={inp} />
              </Rotulo>
              <Rotulo texto="Descrição das atividades">
                <textarea aria-label="Descrição das atividades" value={edit.descricao} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} rows={3} placeholder="O que a pessoa faz, onde e com o quê" style={{ ...inp, resize: 'vertical' }} />
              </Rotulo>

              <Rotulo texto="Riscos">
                {edit.riscos.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <select aria-label={`Tipo do risco ${i + 1}`} value={r.tipo} onChange={(e) => setEdit({ ...edit, riscos: edit.riscos.map((x, j) => j === i ? { ...x, tipo: e.target.value } : x) })} style={{ ...inp, width: 140 }}>
                      {TIPOS_RISCO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input aria-label={`Descrição do risco ${i + 1}`} value={r.descricao} onChange={(e) => setEdit({ ...edit, riscos: edit.riscos.map((x, j) => j === i ? { ...x, descricao: e.target.value } : x) })} placeholder="Ex.: ruído acima de 85 dB" style={{ ...inp, flex: '1 1 180px', width: 'auto' }} />
                    <input aria-label={`Grau do risco ${i + 1}`} value={r.grau || ''} onChange={(e) => setEdit({ ...edit, riscos: edit.riscos.map((x, j) => j === i ? { ...x, grau: e.target.value } : x) })} placeholder="Grau % (opcional)" style={{ ...inp, width: 130 }} />
                    <IconBtn onClick={() => setEdit({ ...edit, riscos: edit.riscos.filter((_, j) => j !== i) })} label={`Tirar risco ${i + 1}`}><X size={14} /></IconBtn>
                  </div>
                ))}
                <button onClick={() => setEdit({ ...edit, riscos: [...edit.riscos, { tipo: 'fisico', descricao: '', grau: null }] })} style={btnSec}><Plus size={13} /> Adicionar risco</button>
                <div style={{ fontSize: 11, color: C.gray, marginTop: 4 }}>Grau de insalubridade/periculosidade é definido pelo engenheiro de segurança; em branco = não classificado.</div>
              </Rotulo>

              <Rotulo texto="EPIs obrigatórios">
                {listas.epis.length === 0 ? <div style={{ fontSize: 12, color: C.gray }}>Nenhum EPI no catálogo. Cadastre em Compliance → EPI → Catálogo.</div> : (
                  <div style={lista}>
                    {listas.epis.map((e) => (
                      <label key={e.id} style={item}>
                        <input type="checkbox" checked={edit.epis.has(e.id)} onChange={() => { const n = new Set(edit.epis); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); setEdit({ ...edit, epis: n }) }} style={{ accentColor: C.gold }} />
                        {e.nome} <span style={{ color: C.gray }}>· CA {e.ca}{e.global ? ' · catálogo PS' : ''}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Rotulo>

              <Rotulo texto="Treinamentos obrigatórios">
                {listas.treinamentos.length === 0 ? <div style={{ fontSize: 12, color: C.gray }}>Nenhum treinamento cadastrado. Cadastre em Compliance → Treinamentos.</div> : (
                  <div style={lista}>
                    {listas.treinamentos.map((t) => (
                      <label key={t.id} style={item}>
                        <input type="checkbox" checked={edit.treinamentos.has(t.id)} onChange={() => { const n = new Set(edit.treinamentos); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setEdit({ ...edit, treinamentos: n }) }} style={{ accentColor: C.gold }} />
                        {t.nr ? `${t.nr} · ` : ''}{t.nome}
                      </label>
                    ))}
                  </div>
                )}
              </Rotulo>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => setEdit(null)} disabled={salvando} style={btnSec}>Cancelar</button>
                <button onClick={salvar} disabled={salvando || !edit.nome.trim()} data-testid="ltcat-salvar" style={{ ...btnPri, opacity: salvando || !edit.nome.trim() ? 0.6 : 1 }}>{salvando ? 'Salvando…' : 'Salvar função'}</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Rotulo({ texto, children }: { texto: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>{texto}</div>{children}</div>
}
function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return <button onClick={onClick} aria-label={label} title={label} style={{ border: `1px solid ${C.borderLt}`, background: '#fff', borderRadius: 8, padding: 6, cursor: 'pointer', color: C.espresso, display: 'inline-flex' }}>{children}</button>
}
function box(bg: string, c: string): React.CSSProperties { return { background: bg, color: c, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 10 } }
const vazioBox: React.CSSProperties = { background: '#fff', border: `1px dashed ${C.borderLt}`, borderRadius: 12, padding: '18px 14px', textAlign: 'center', color: C.gray, fontSize: 13 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', background: C.offwhite, border: `1px solid ${C.borderLt}`, borderRadius: 8, fontSize: 13, color: C.espresso, boxSizing: 'border-box', fontFamily: 'inherit' }
const lista: React.CSSProperties = { display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 8 }
const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.espresso, cursor: 'pointer' }
const ic: React.CSSProperties = { verticalAlign: 'middle', marginRight: 4, color: C.gold }
const btnPri: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: C.gold, color: '#fff' }
const btnSec: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso }
