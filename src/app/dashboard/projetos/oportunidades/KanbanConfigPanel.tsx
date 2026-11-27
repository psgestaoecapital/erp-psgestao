'use client'
// Config do Kanban comercial (CEO 27/11) — acima do Kanban. Por coluna, quem pode TIRAR o card
// (qualquer vendedor / engenharia / dono); e QUEM é engenharia na empresa. Só o DONO edita; os
// demais veem em leitura. Entrar numa coluna é sempre livre — o gate é só na SAÍDA. RD-95/96/98.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight, Lock, ShieldCheck, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

type Sair = 'qualquer' | 'engenharia' | 'dono'
type Usuario = { id: string; nome: string }
const ROTA = '/dashboard/projetos/oportunidades'
const LABEL_SAIR: Record<Sair, string> = { qualquer: 'Qualquer vendedor', engenharia: 'Só engenharia', dono: 'Só o dono' }

function regraDe(regras: Record<string, string>, etapa: string): Sair {
  const v = regras[etapa]
  if (v === 'engenharia' || v === 'dono' || v === 'qualquer') return v
  return etapa === 'orcando' ? 'engenharia' : 'qualquer'
}

export default function KanbanConfigPanel({ companyId, etapas, onSaved }: {
  companyId: string
  etapas: { v: string; l: string }[]
  onSaved?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [loading, setLoading] = useState(true)
  const [podeEditar, setPodeEditar] = useState(false)
  const [regras, setRegras] = useState<Record<string, string>>({})
  const [engenharia, setEngenharia] = useState<Set<string>>(new Set())
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('fn_crm_kanban_config_obter', { p_company: companyId })
      if (error) throw error
      const d = (data ?? {}) as { pode_editar?: boolean; regras?: Record<string, string>; engenharia?: string[]; usuarios?: Usuario[] }
      setPodeEditar(!!d.pode_editar)
      setRegras(d.regras ?? {})
      setEngenharia(new Set(Array.isArray(d.engenharia) ? d.engenharia : []))
      setUsuarios(Array.isArray(d.usuarios) ? d.usuarios : [])
    } catch (e) {
      setMsg(erroAmigavel(e, 'Não foi possível carregar as regras do Kanban.'))
    } finally { setLoading(false) }
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const setRegra = (etapa: string, v: Sair) => { if (podeEditar) setRegras((r) => ({ ...r, [etapa]: v })) }
  const toggleEng = (uid: string) => {
    if (!podeEditar) return
    setEngenharia((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })
  }

  async function salvar() {
    setSalvando(true); setMsg(null)
    try {
      const regrasFull: Record<string, string> = {}
      for (const e of etapas) regrasFull[e.v] = regraDe(regras, e.v)
      const { data, error } = await supabase.rpc('fn_crm_kanban_config_salvar', {
        p_company: companyId, p_regras: regrasFull, p_engenharia: Array.from(engenharia),
      })
      if (error) throw error
      const r = data as { ok?: boolean } | null
      if (!r?.ok) throw new Error('falha')
      setMsg('✓ Regras salvas.')
      setTimeout(() => setMsg(null), 2500)
      onSaved?.()
    } catch (e) {
      setMsg(erroAmigavel(e, 'Não foi possível salvar. Só o dono pode alterar.'))
    } finally { setSalvando(false) }
  }

  const resumo = etapas.filter((e) => regraDe(regras, e.v) !== 'qualquer')
    .map((e) => `${e.l}: ${LABEL_SAIR[regraDe(regras, e.v)].toLowerCase()}`).join(' · ') || 'todas as colunas livres'

  const card: CSSProperties = { border: '1px solid var(--ps-border,#E0D8CC)', borderRadius: 10, background: '#fff', marginBottom: 12 }
  const sel: CSSProperties = { padding: '4px 6px', fontSize: 11, borderRadius: 6, border: '1px solid var(--ps-border,#E0D8CC)', background: podeEditar ? '#fff' : '#F5F1EA', color: '#3D2314' }

  return (
    <div style={card}>
      <button onClick={() => setAberto((a) => !a)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', textAlign: 'left' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {aberto ? <ChevronDown size={16} className="text-[#C8941A]" /> : <ChevronRight size={16} className="text-[#C8941A]" />}
          <ShieldCheck size={15} className="text-[#C8941A]" />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>Regras das colunas — quem pode tirar o card</span>
          <span style={{ fontSize: 10, color: '#6B5D4F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {resumo}</span>
        </span>
        {!podeEditar && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6B5D4F' }}><Lock size={11} /> só o dono edita</span>}
      </button>

      {aberto && (
        <div style={{ borderTop: '1px solid var(--ps-border,#E0D8CC)', padding: 14 }}>
          {loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#6B5D4F' }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> carregando…</div>
          ) : (
            <>
              {!podeEditar && (
                <div style={{ marginBottom: 10, borderRadius: 8, background: '#3D23140d', padding: '8px 10px', fontSize: 11, color: '#6B5D4F' }}>
                  <Lock size={12} style={{ display: 'inline', marginRight: 4 }} /> Só o dono da empresa altera estas regras. Você vê em leitura.
                </div>
              )}
              {/* Por coluna: quem pode tirar (SAÍDA). Entrar é sempre livre. */}
              <div data-ajuda="projetos.oportunidades.kanban.sair" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#3D2314', marginBottom: 6 }}>
                  Quem pode TIRAR o card de cada coluna <AjudaCampo chave="projetos.oportunidades.kanban.sair" rota={ROTA} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                  {etapas.map((e) => (
                    <label key={e.v} data-ajuda="projetos.oportunidades.kanban.sair" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 11, color: '#3D2314', border: '1px solid var(--ps-border,#E0D8CC)', borderRadius: 6, padding: '5px 8px' }}>
                      <span>{e.l}</span>
                      <select value={regraDe(regras, e.v)} disabled={!podeEditar} onChange={(ev) => setRegra(e.v, ev.target.value as Sair)} aria-label={`Quem tira o card de ${e.l}`} style={sel}>
                        <option value="qualquer">Qualquer vendedor</option>
                        <option value="engenharia">Só engenharia</option>
                        <option value="dono">Só o dono</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>
              {/* Quem é engenharia */}
              <div data-ajuda="projetos.oportunidades.kanban.engenharia">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#3D2314', marginBottom: 6 }}>
                  Quem é “engenharia” na empresa <AjudaCampo chave="projetos.oportunidades.kanban.engenharia" rota={ROTA} />
                </div>
                {usuarios.length === 0 ? (
                  <p style={{ fontSize: 11, color: '#6B5D4F' }}>Nenhum usuário na empresa ainda.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {usuarios.map((u) => (
                      <label key={u.id} data-ajuda="projetos.oportunidades.kanban.engenharia" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#3D2314', border: `1px solid ${engenharia.has(u.id) ? '#C8941A' : 'var(--ps-border,#E0D8CC)'}`, background: engenharia.has(u.id) ? '#C8941A15' : '#fff', borderRadius: 999, padding: '4px 10px', cursor: podeEditar ? 'pointer' : 'default' }}>
                        <input type="checkbox" checked={engenharia.has(u.id)} disabled={!podeEditar} onChange={() => toggleEng(u.id)} style={{ accentColor: '#C8941A' }} />
                        {u.nome}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {msg && <div style={{ marginTop: 10, fontSize: 11, color: msg.startsWith('✓') ? '#2F855A' : '#B45309' }}>{msg}</div>}
              {podeEditar && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={salvar} disabled={salvando} style={{ fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8, background: '#3D2314', color: '#FAF7F2', border: 'none', cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>
                    {salvando ? 'Salvando…' : 'Salvar regras'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
