'use client'

// Administração › Carteira (Chamados em equipe · SPEC rev. 9, seção 1): responsável por empresa cliente.
// A carteira define para onde o chamado CAI ("Meus chamados" do responsável + sino), não quem pode atendê-lo.
// Só o CEO edita (fn_carteira_definir confere no banco); a equipe vê. Cada troca fecha a vigência anterior
// (histórico) e passa os chamados ABERTOS da empresa para o novo responsável, com registro no chamado.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Linha = { company_id: string; empresa: string; responsavel_id: string | null; responsavel: string | null; interno: boolean; desde: string | null; abertos: number; historico: number }
type Pessoa = { user_id: string; nome: string; papel: 'ceo' | 'socio' | 'suporte'; eu: boolean }

const C = { bg: '#FAF7F2', card: '#FFFFFF', border: '#E0D8CC', text: '#3D2314', textM: '#6B5D4F', gold: '#C8941A', red: '#B42318', redBg: '#FDECEC', green: '#166534', greenBg: '#ECFDF5' }
const inp: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff', color: C.text }

export default function CarteiraPage() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [equipe, setEquipe] = useState<Pessoa[]>([])
  const [busca, setBusca] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const ehCeo = equipe.some((p) => p.eu && p.papel === 'ceo')

  const carregar = useCallback(async () => {
    const [c, e] = await Promise.all([supabase.rpc('fn_carteira_listar'), supabase.rpc('fn_chamado_equipe_listar')])
    if (c.error) { setErro(c.error.message); setLinhas([]); return }
    setLinhas((c.data as Linha[] | null) ?? [])
    setEquipe((e.data as Pessoa[] | null) ?? [])
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do banco
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => (linhas ?? []).filter((l) => !busca.trim() || l.empresa.toLowerCase().includes(busca.trim().toLowerCase())), [linhas, busca])
  const semDono = (linhas ?? []).filter((l) => !l.responsavel_id && !l.interno).length

  async function definir(l: Linha, responsavel: string, interno: boolean) {
    const nome = equipe.find((p) => p.user_id === responsavel)?.nome || 'sem responsável'
    const motivo = window.prompt(`${l.empresa}: responsável passa a ser ${nome}${interno ? ' (interno)' : ''}. Os ${l.abertos} chamado(s) aberto(s) passam a cair nessa pessoa. Motivo (opcional):`)
    if (motivo === null) return
    const { data, error } = await supabase.rpc('fn_carteira_definir', { p_company_id: l.company_id, p_responsavel: responsavel || null, p_interno: interno, p_motivo: motivo })
    const r = data as { ok?: boolean; erro?: string; mensagem?: string; chamados_abertos_movidos?: number } | null
    if (error || !r?.ok) { setErro(r?.mensagem || error?.message || r?.erro || 'Falha'); return }
    setMsg(`${l.empresa} → ${nome}. ${r.chamados_abertos_movidos ?? 0} chamado(s) aberto(s) passaram para a nova fila.`)
    void carregar()
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 980, margin: '0 auto', color: C.text }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Administração</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Carteira de clientes</h1>
      <p style={{ color: C.textM, fontSize: 13, margin: '6px 0 12px' }}>
        Responsável por empresa: o chamado aberto pela empresa cai em &quot;Meus chamados&quot; dessa pessoa e no sino dela. Toda a equipe vê todos os chamados e pode puxar ou direcionar.
        {' '}{ehCeo ? 'Só você (CEO) edita.' : 'Só o CEO edita.'} <Link href="/dashboard/atendimento" style={{ color: C.gold, fontWeight: 700 }}>Fila de atendimento →</Link>
      </p>
      {semDono > 0 && <div data-testid="carteira-sem-dono" style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>⚠️ {semDono} empresa(s) sem responsável — chamados delas vão para &quot;Sem dono&quot;.</div>}
      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setErro(null)}>{erro}</div>}
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar empresa" style={{ ...inp, minWidth: 240, marginBottom: 10 }} />

      {linhas === null ? <div style={{ color: C.textM }}>Carregando…</div> : (
        <div data-testid="carteira-tabela" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: C.textM, fontSize: 11.5, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '8px 10px' }}>Empresa</th><th>Responsável</th><th>Interno</th><th style={{ textAlign: 'right' }}>Abertos</th><th style={{ padding: '0 10px' }}>Desde</th>
            </tr></thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.company_id} data-testid={`carteira-linha-${l.company_id}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{l.empresa}</td>
                  <td>
                    {ehCeo ? (
                      <select value={l.responsavel_id ?? ''} onChange={(e) => void definir(l, e.target.value, l.interno)} style={inp} aria-label={`Responsável de ${l.empresa}`}>
                        <option value="">— sem responsável —</option>
                        {equipe.filter((p) => p.papel !== 'suporte').map((p) => <option key={p.user_id} value={p.user_id}>{p.nome}</option>)}
                      </select>
                    ) : <span style={{ color: l.responsavel ? C.text : C.red }}>{l.responsavel || 'sem responsável'}</span>}
                  </td>
                  <td>
                    <input type="checkbox" checked={l.interno} disabled={!ehCeo} onChange={(e) => void definir(l, l.responsavel_id ?? '', e.target.checked)} aria-label={`${l.empresa} é interna da PS`} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{l.abertos}</td>
                  <td style={{ padding: '0 10px', color: C.textM, fontSize: 12 }}>{l.desde ? new Date(l.desde).toLocaleDateString('pt-BR') : '—'}{l.historico > 1 ? ` · ${l.historico - 1} troca(s)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
