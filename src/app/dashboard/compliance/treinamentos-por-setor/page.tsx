'use client'
// Compliance · Treinamentos por setor (chamado #42, Frioeste). Escolha o setor e marque os treinamentos/documentos
// que TODOS os colaboradores dele precisam ter. É somado ao que já é exigido hoje (cargo, setor do escopo, marcação
// manual): marcar aqui nunca tira nada de ninguém. A aba Documentos do funcionário lê a mesma regra.
import { useState, useEffect, useCallback } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { rpc } from '@/lib/authFetch'

const C = { espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', borderLt: '#ece3d2', gray: '#6b6b6b', red: '#a02020', green: '#2d6a3e' }
type Setor = { setor: string; setor_id: string }
type Exig = { exigido_id: string; nome: string; grupo: string; marcado_setor: boolean; ja_exigido_por_escopo: boolean }

export default function TreinamentosPorSetorPage() {
  const { sel, selInfo, loading } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [setores, setSetores] = useState<Setor[]>([])
  const [setorId, setSetorId] = useState('')
  const [itens, setItens] = useState<Exig[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      try {
        const r = await rpc<{ setores: Setor[] }>('fn_compliance_cargos_setores', { p_company_id: companyId })
        setSetores(r.setores || [])
      } catch (e) { setMsg((e as Error).message) }
    })()
  }, [companyId])

  const carregar = useCallback(async () => {
    if (!companyId || !setorId) { setItens([]); return }
    try {
      const r = await rpc<{ exigencias: Exig[] }>('fn_compliance_setor_exigencias_listar', { p_company_id: companyId, p_setor_id: setorId })
      setItens(r.exigencias || [])
      setMarcados(new Set((r.exigencias || []).filter(x => x.marcado_setor).map(x => x.exigido_id)))
      setMsg('')
    } catch (e) { setMsg((e as Error).message) }
  }, [companyId, setorId])
  useEffect(() => { void carregar() }, [carregar])

  const salvar = async () => {
    if (!companyId || !setorId) return
    setSalvando(true); setMsg('')
    try {
      await rpc('fn_compliance_setor_exigencias_salvar', { p_company_id: companyId, p_setor_id: setorId, p_exigido_ids: Array.from(marcados) })
      setMsg('Salvo. Os colaboradores deste setor passam a ter estes treinamentos na aba Documentos.')
      await carregar()
    } catch (e) { setMsg((e as Error).message) } finally { setSalvando(false) }
  }
  const alternar = (id: string) => setMarcados(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (loading) return <div style={{ padding: 40, color: C.gray }}>Carregando…</div>
  if (!companyId) return <div style={{ padding: 24, color: C.gray }}>Selecione uma empresa específica no topo (não Consolidado/Grupo).</div>

  const grupos = Array.from(new Set(itens.map(i => i.grupo)))
  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', padding: 24, color: C.espresso }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Treinamentos por setor</h1>
      <p style={{ fontSize: 13, color: C.gray, margin: '6px 0 16px' }}>Escolha o setor e marque os treinamentos que todos os colaboradores dele precisam ter. O que a empresa já exige hoje (por cargo ou para todos) continua valendo: aqui você só acrescenta.</p>
      <select data-testid="setor-select" value={setorId} onChange={e => setSetorId(e.target.value)} style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, minWidth: 260, fontSize: 14 }}>
        <option value="">Escolha o setor…</option>
        {setores.map(s => <option key={s.setor_id} value={s.setor_id}>{s.setor}</option>)}
      </select>
      {setorId && grupos.map(g => (
        <div key={g} style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gold, textTransform: 'uppercase', marginBottom: 6 }}>{g}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 6 }}>
            {itens.filter(i => i.grupo === g).map(i => (
              <label key={i.exigido_id} style={{ display: 'flex', gap: 10, background: '#fff', border: `1px solid ${marcados.has(i.exigido_id) ? C.gold : C.borderLt}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                <input type="checkbox" data-testid="setor-exigencia" checked={marcados.has(i.exigido_id)} onChange={() => alternar(i.exigido_id)} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.nome}{i.ja_exigido_por_escopo && <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: C.green }}>já exigido para este setor pela regra atual</span>}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {setorId && itens.length > 0 && (
        <button data-testid="setor-salvar" disabled={salvando} onClick={salvar} style={{ marginTop: 18, padding: '10px 20px', border: 'none', borderRadius: 8, background: C.gold, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      )}
      {msg && <div data-testid="setor-msg" style={{ marginTop: 12, fontSize: 13, color: msg.startsWith('Salvo') ? C.green : C.red }}>{msg}</div>}
    </div>
  )
}
