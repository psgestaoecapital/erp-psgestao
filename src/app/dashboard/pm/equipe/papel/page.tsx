'use client'
// PAPEL NA AGÊNCIA (P&M) — aplica o papel da vertical 'pm' (catálogo de 10, #2057) a cada pessoa da empresa.
// Mostra ANTES/DEPOIS do que a pessoa passa a ter e só grava depois de confirmar. Só quem gere acessos da empresa
// (dono / PS_ADMIN, fn_acessos_pode_gerir) usa; o banco confere de novo (fn_pm_papel_agencia_*).
import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const RED = '#7A1F1F'

type Papel = { slug: string; nome: string; descricao: string; acessos: Record<string, string> }
type Pessoa = { user_id: string; nome: string; email: string; cargo_empresa: string | null; papel_slug: string | null }
type Sim = { ok: boolean; erro?: string; papel_atual: string | null; papel_novo: string; acessos_antes: Record<string, string>; acessos_depois: Record<string, string>; teto: string; telas_continuam: string[]; observacao: string }

const ROTULO: Record<string, string> = {
  pm_comercial: 'Comercial (leads, propostas)', pm_producao: 'Produção (jobs, pauta)', pm_financeiro: 'Financeiro da agência',
  pm_inteligencia: 'Inteligência (painéis)', pm_midia: 'Mídia (PI, CENP)', pm_portal: 'Portal / aprovação do cliente', ge_financeiro: 'Gestão Empresarial (financeiro)',
}

export default function PapelAgenciaPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [papeis, setPapeis] = useState<Papel[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [sel, setSel] = useState<{ pessoa: Pessoa; slug: string } | null>(null)
  const [sim, setSim] = useState<Sim | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_pm_papel_agencia_listar', { p_company_id: empresa })
    const r = data as { ok: boolean; erro?: string; papeis?: Papel[]; pessoas?: Pessoa[] } | null
    if (error || !r?.ok) setErro(r?.erro ?? error?.message ?? 'Não foi possível carregar.')
    else { setPapeis(r.papeis ?? []); setPessoas(r.pessoas ?? []) }
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function simular(pessoa: Pessoa, slug: string) {
    if (!empresa || !slug) return
    setSel({ pessoa, slug }); setSim(null)
    const { data } = await supabase.rpc('fn_pm_papel_agencia_simular', { p_company_id: empresa, p_user_id: pessoa.user_id, p_papel_slug: slug })
    setSim(data as Sim)
  }
  async function aplicar() {
    if (!empresa || !sel) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_papel_agencia_definir', { p_company_id: empresa, p_user_id: sel.pessoa.user_id, p_papel_slug: sel.slug })
    setBusy(false)
    const r = data as { ok: boolean; erro?: string } | null
    if (error || !r?.ok) { setToast(`Erro: ${r?.erro ?? error?.message}`); return }
    setSel(null); setSim(null); setToast('Papel APLICADO.'); void carregar()
  }

  const nomePapel = (slug: string | null) => papeis.find((p) => p.slug === slug)?.nome ?? '— sem papel —'
  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div data-testid="papel-agencia-page" style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 16px', color: ESPRESSO }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <Link href="/dashboard/pm/equipe" style={{ fontSize: 12, color: TEXTM }}>← Equipe</Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>Papel na agência</h1>
        <p style={{ fontSize: 13, color: TEXTM, margin: '0 0 14px' }}>Escolha o papel de cada pessoa. Antes de gravar, você vê o que ela passa a ter. Nenhuma tela some: o papel só acrescenta o detalhe por área.</p>
        {erro && <div style={{ background: '#fff', border: `1px solid ${RED}`, color: RED, borderRadius: 10, padding: 12, fontSize: 13 }}>{erro}</div>}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div> : !erro && (
          <div style={{ display: 'grid', gap: 8 }}>
            {pessoas.map((p) => (
              <div key={p.user_id} data-testid="papel-pessoa" style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 700 }}>{p.nome}</div>
                  <div style={{ fontSize: 12, color: TEXTM }}>{p.email} · cargo: {p.cargo_empresa ?? '—'}</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>Papel atual: <b>{nomePapel(p.papel_slug)}</b></div>
                </div>
                <select aria-label={`Papel de ${p.nome}`} data-testid="papel-select" value="" onChange={(e) => void simular(p, e.target.value)} style={inp}>
                  <option value="">Escolher papel…</option>
                  {papeis.map((x) => <option key={x.slug} value={x.slug}>{x.nome}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      {sel && (
        <div style={overlay} onClick={() => setSel(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()} data-testid="papel-antes-depois">
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>{sel.pessoa.nome}</h2>
            <div style={{ fontSize: 13, color: TEXTM, marginBottom: 10 }}>{nomePapel(sel.pessoa.papel_slug)} → <b>{nomePapel(sel.slug)}</b></div>
            {!sim ? <div style={{ color: TEXTM }}>Calculando…</div> : !sim.ok ? <div style={{ color: RED }}>{sim.erro}</div> : (
              <>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: TEXTM }}><th>Área</th><th>Antes</th><th>Depois</th></tr></thead>
                  <tbody>
                    {Object.keys({ ...sim.acessos_antes, ...sim.acessos_depois }).map((k) => (
                      <tr key={k} style={{ borderTop: `1px solid ${BORDA}` }}>
                        <td style={{ padding: '4px 0' }}>{ROTULO[k] ?? k}</td><td>{sim.acessos_antes[k] ?? '—'}</td><td><b>{sim.acessos_depois[k] ?? '—'}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 12, color: TEXTM }}>Continuam: {sim.telas_continuam.join(', ')}. {sim.observacao}</p>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setSel(null)} style={btnGhost}>Cancelar</button>
              <button data-testid="papel-aplicar" disabled={busy || !sim?.ok} onClick={aplicar} style={btnPri}>{busy ? 'Aplicando…' : 'APLICAR'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 44, background: '#fff', color: ESPRESSO, maxWidth: '100%' }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 44 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 44 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
