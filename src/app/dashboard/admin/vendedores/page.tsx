'use client'
// Administração › Vendedores (CEO 29/10/2026): liga cada usuário do PS Gestão ao código de vendedor/supervisor/gerente
// do ERP de origem. Esse vínculo define o que a pessoa vê no Meu painel de vendas (trava no banco, fn_bi_comercial_painel).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', ok: '#1a8f63', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/admin/vendedores'
type Membro = { codigo: string; nome: string; cargo: string; superior: string | null; user_id: string | null; ativo: boolean | null; usuario: string | null; email: string | null }
type Usuario = { user_id: string; nome: string; email: string; papel: string }

export default function VendedoresAcesso() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [equipe, setEquipe] = useState<Membro[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [escolha, setEscolha] = useState<Record<string, string>>({})

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data, error } = await supabase.rpc('fn_com_vendedor_acesso_listar', { p_company_id: empresa })
    if (error) { setErro(error.message); return }
    setErro(null)
    const d = data as { equipe: Membro[]; usuarios: Usuario[] }
    setEquipe(d.equipe ?? []); setUsuarios(d.usuarios ?? [])
    setEscolha(Object.fromEntries((d.equipe ?? []).map((m) => [m.codigo, m.ativo && m.user_id ? m.user_id : ''])))
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  async function salvar(m: Membro) {
    const { data, error } = await supabase.rpc('fn_com_vendedor_acesso_salvar', { p_company_id: empresa, p_codigo: m.codigo, p_user_id: escolha[m.codigo] || null })
    const r = data as { ok: boolean; erro?: string; acao?: string } | null
    setMsg(error ? `Não salvou: ${error.message}` : r?.ok ? `${m.nome}: ${r.acao === 'vinculado' ? 'acesso liberado' : 'acesso retirado'}.` : `Não salvou: ${r?.erro}`)
    void carregar()
  }

  const ligados = equipe.filter((m) => m.ativo && m.user_id).length
  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 3vw, 24px)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div>
          <a href="/dashboard/admin" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← Administração</a>
          <h1 style={{ margin: '4px 0 2px', fontSize: 24, fontFamily: 'Georgia, serif', fontWeight: 400 }}>Vendedores e o Meu painel de vendas</h1>
          <p style={{ margin: 0, fontSize: 13, color: C.m, maxWidth: '70ch' }}>
            A equipe abaixo vem do ERP de origem. Escolha o usuário de cada pessoa: o vendedor passa a ver só a própria venda; o supervisor e o gerente veem a equipe deles. Quem ainda não tem usuário é convidado em Administração › Acessos.
          </p>
        </div>
        {!empresa && <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 14 }}>Escolha uma empresa no topo.</div>}
        {erro && <div role="alert" style={{ color: C.bad }}>Sem acesso: {erro}</div>}
        {msg && <div role="status" style={{ fontSize: 13, color: C.ok }}>{msg}</div>}
        {empresa && !erro && (
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 14, overflowX: 'auto' }}>
            <div style={{ fontSize: 13, color: C.m, marginBottom: 8 }}>{ligados} de {equipe.length} pessoas com acesso liberado</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ color: C.m, textAlign: 'left' }}><th style={{ padding: 6 }}>Código</th><th style={{ padding: 6 }}>Nome no ERP</th><th style={{ padding: 6 }}>Cargo</th><th style={{ padding: 6 }}>Usuário do PS Gestão<AjudaCampo chave="com.vendedores.vinculo" rota={ROTA} /></th><th style={{ padding: 6 }} /></tr></thead>
              <tbody>
                {equipe.map((m) => (
                  <tr key={m.codigo} style={{ borderTop: `1px solid ${C.bg2}` }}>
                    <td style={{ padding: 6, fontVariantNumeric: 'tabular-nums' }}>{m.codigo}</td>
                    <td style={{ padding: 6 }}>{m.nome}</td>
                    <td style={{ padding: 6 }}>{m.cargo}</td>
                    <td style={{ padding: 6 }}>
                      <select aria-label={`Usuário de ${m.nome}`} value={escolha[m.codigo] ?? ''} onChange={(e) => setEscolha({ ...escolha, [m.codigo]: e.target.value })}
                        style={{ font: 'inherit', padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.bd}`, maxWidth: 260 }}>
                        <option value="">— sem acesso —</option>
                        {usuarios.map((u) => <option key={u.user_id} value={u.user_id}>{u.nome}{u.email && u.email !== u.nome ? ` (${u.email})` : ''}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <button type="button" onClick={() => void salvar(m)} disabled={(escolha[m.codigo] ?? '') === ((m.ativo && m.user_id) || '')}
                        style={{ font: 'inherit', padding: '6px 12px', borderRadius: 8, border: 0, background: C.gold, color: C.esp, cursor: 'pointer', opacity: (escolha[m.codigo] ?? '') === ((m.ativo && m.user_id) || '') ? 0.4 : 1 }}>Salvar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {equipe.length === 0 && <div style={{ fontSize: 13, color: C.m }}>A equipe comercial ainda não chegou do ERP de origem.</div>}
          </div>
        )}
      </div>
    </div>
  )
}
