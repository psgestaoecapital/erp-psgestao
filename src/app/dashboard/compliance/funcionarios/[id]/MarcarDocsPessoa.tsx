'use client'

// Marcação de documentos POR PESSOA (#27/#42/#47). Mostra, para cada documento exigido da empresa,
// se ele se aplica a esta pessoa e POR QUÊ ("Exigido para o cargo Motorista" / "Marcado manualmente" /
// "Dispensado em 10/09 por X") — cuidado do CEO: sem o motivo, a Eduarda configura e não entende.
// Ações por pessoa: exigir (whitelist, fura o escopo) e "não se aplica" (dispensa, com trilha).
// Fonte única: fn_compliance_pessoa_docs / _exigir / _dispensar (backend já provado).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const C = {
  espresso: '#3D2314', gold: '#C8941A', borderLt: '#ece3d2', ink: '#1a1a1a',
  green: '#2d6a3e', greenBg: '#e8f3ec', gray: '#6b6b6b', red: '#a02020', amber: '#8a6a10', amberBg: '#fdf4e0',
}

type Doc = {
  exigido_id: string; tipo_documento_id: string | null; tipo_nome: string; tipo_grupo: string | null
  em_escopo: boolean; incluido: boolean; dispensado: boolean; aplica: boolean; motivo: string
}

export default function MarcarDocsPessoa({ companyId, funcionarioId, onChanged }: {
  companyId: string; funcionarioId: string; onChanged?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_compliance_pessoa_docs', { p_company_id: companyId, p_funcionario_id: funcionarioId })
      if (error) throw error
      const r = data as { ok?: boolean; documentos?: Doc[] } | null
      setDocs(r?.documentos || [])
    } catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId, funcionarioId])

  useEffect(() => { if (aberto && docs.length === 0) void carregar() }, [aberto, docs.length, carregar])

  const agir = useCallback(async (d: Doc, acao: 'exigir' | 'dispensar' | 'reexigir' | 'remover_marcacao') => {
    setSalvando(d.exigido_id); setErro(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const uid = user?.id ?? null
      if (acao === 'exigir') {
        await supabase.rpc('fn_compliance_pessoa_exigir', { p_company_id: companyId, p_funcionario_id: funcionarioId, p_exigido_id: d.exigido_id, p_on: true, p_user: uid })
      } else if (acao === 'remover_marcacao') {
        await supabase.rpc('fn_compliance_pessoa_exigir', { p_company_id: companyId, p_funcionario_id: funcionarioId, p_exigido_id: d.exigido_id, p_on: false, p_user: uid })
      } else if (acao === 'dispensar') {
        if (!d.tipo_documento_id) { // custom (sem tipo) não tem dispensa por tipo — remove a marcação manual
          await supabase.rpc('fn_compliance_pessoa_exigir', { p_company_id: companyId, p_funcionario_id: funcionarioId, p_exigido_id: d.exigido_id, p_on: false, p_user: uid })
        } else {
          const motivo = window.prompt('Por que este documento NÃO se aplica a esta pessoa? (fica registrado)') || ''
          if (!motivo.trim()) { setSalvando(null); return }
          await supabase.rpc('fn_compliance_pessoa_dispensar', { p_company_id: companyId, p_funcionario_id: funcionarioId, p_tipo_documento_id: d.tipo_documento_id, p_on: true, p_motivo: motivo, p_user: uid })
        }
      } else if (acao === 'reexigir') {
        await supabase.rpc('fn_compliance_pessoa_dispensar', { p_company_id: companyId, p_funcionario_id: funcionarioId, p_tipo_documento_id: d.tipo_documento_id, p_on: false, p_user: uid })
      }
      await carregar()
      onChanged?.()
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(null) }
  }, [companyId, funcionarioId, carregar, onChanged])

  const aplicaveis = docs.filter(d => d.aplica).length

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 12, marginBottom: 16 }}>
      <button onClick={() => setAberto(a => !a)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.espresso }}>⚙️ Quais documentos esta pessoa precisa {aberto ? '' : `· ${aplicaveis > 0 ? `${aplicaveis} aplicáveis` : 'configurar'}`}</span>
        <span style={{ fontSize: 12, color: C.gray }}>{aberto ? '▲ fechar' : '▼ configurar'}</span>
      </button>

      {aberto && (
        <div style={{ padding: '0 16px 14px' }}>
          <p style={{ fontSize: 12, color: C.gray, marginTop: 0 }}>Cada documento mostra <b>por que</b> aparece ou não. Marque exceções desta pessoa — o resto vem do cargo/setor configurado em <b>Documentos Exigidos</b>.</p>
          {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
          {loading ? <div style={{ color: C.gray, fontSize: 13, padding: 10 }}>Carregando…</div> : (
            <div style={{ display: 'grid', gap: 6 }}>
              {docs.map(d => (
                <div key={d.exigido_id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '8px 10px' }}>
                  <span title={d.aplica ? 'aplica' : 'não aplica'} style={{ width: 10, height: 10, borderRadius: 999, flexShrink: 0, background: d.aplica ? C.green : '#ccc' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.espresso }}>{d.tipo_nome}</div>
                    <div style={{ fontSize: 11, color: d.dispensado ? C.red : d.incluido ? C.amber : C.gray }}>{d.motivo}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {d.dispensado ? (
                      <MiniBtn onClick={() => agir(d, 'reexigir')} busy={salvando === d.exigido_id} cor={C.green}>Voltar a exigir</MiniBtn>
                    ) : d.aplica ? (
                      <>
                        {d.incluido && <MiniBtn onClick={() => agir(d, 'remover_marcacao')} busy={salvando === d.exigido_id} cor={C.gray}>remover marcação</MiniBtn>}
                        <MiniBtn onClick={() => agir(d, 'dispensar')} busy={salvando === d.exigido_id} cor={C.red}>Não se aplica</MiniBtn>
                      </>
                    ) : (
                      <MiniBtn onClick={() => agir(d, 'exigir')} busy={salvando === d.exigido_id} cor={C.gold}>Exigir p/ esta pessoa</MiniBtn>
                    )}
                  </div>
                </div>
              ))}
              {docs.length === 0 && <div style={{ color: C.gray, fontSize: 12.5, padding: 10 }}>Nenhum documento exigido configurado para a empresa. Configure em Documentos Exigidos.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MiniBtn({ children, onClick, busy, cor }: { children: React.ReactNode; onClick: () => void; busy?: boolean; cor: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      style={{ border: `1px solid ${cor}`, background: '#fff', color: cor, borderRadius: 6, padding: '4px 8px', fontSize: 11.5, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}
