'use client'

// Guarda de plano por ÁREA (print CEO 19/09 · Tryo Gesso em /dashboard/agro sem plano agro).
// Antes, a empresa sem o plano da área caía direto no vazio da tela ("não tem propriedade/dados") —
// tecnicamente certo, mas engana: o problema é que a EMPRESA não tem a ÁREA contratada.
// Agora: se a empresa atual tem a área na lista de áreas visíveis com empresa_tem_acesso=false,
// mostramos "<Empresa> não tem <Área> contratado · Trocar de empresa" com o seletor de empresa ali mesmo.
//
// SEGURANÇA (fail-open): só bloqueia quando a área ESTÁ na lista E empresa_tem_acesso===false.
// Carregando, área não encontrada na lista, ou sem empresa selecionada → renderiza o conteúdo normal
// (nunca bloqueia por engano — o pior caso é a tela antiga, nunca esconder área contratada).

import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAreasVisiveis } from '@/hooks/useAreasVisiveis'

const EMPRESA_KEY = 'ps_empresa_sel'

function lerCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(EMPRESA_KEY)
    if (!v || v === 'consolidado' || v.startsWith('group_')) return null
    return v
  } catch { return null }
}

export default function GuardaPlanoArea({ areaSlug, areaNome, children }: { areaSlug: string; areaNome: string; children: ReactNode }) {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    setCompanyId(lerCompanyId())
    const i = setInterval(() => setCompanyId((p) => { const a = lerCompanyId(); return p === a ? p : a }), 800)
    return () => clearInterval(i)
  }, [])

  const { areas, loading } = useAreasVisiveis(companyId)
  const area = areas.find((a) => a.area_slug === areaSlug)
  // Só bloqueia quando temos certeza: empresa selecionada, lista carregada, área presente e SEM acesso.
  const bloquear = !!companyId && !loading && !!area && area.empresa_tem_acesso === false

  if (bloquear) return <AreaSemPlano areaNome={area?.nome_menu || areaNome} />
  return <>{children}</>
}

function AreaSemPlano({ areaNome }: { areaNome: string }) {
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([])
  const [empresaNome, setEmpresaNome] = useState<string>('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      const atual = lerCompanyId()
      const { data: up } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
      let rows: { id: string; nome_fantasia: string | null; razao_social: string | null }[] = []
      if (up?.role === 'adm' || up?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('id, nome_fantasia, razao_social').order('nome_fantasia')
        rows = (data ?? []) as typeof rows
      } else {
        const { data } = await supabase.from('user_companies').select('companies(id, nome_fantasia, razao_social)').eq('user_id', user.id)
        rows = ((data ?? []) as unknown as { companies: typeof rows[number] | typeof rows[number][] | null }[])
          .flatMap((u) => Array.isArray(u.companies) ? u.companies : u.companies ? [u.companies] : [])
      }
      if (!alive) return
      const lista = rows.map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || c.id }))
      setEmpresas(lista)
      setEmpresaNome(lista.find((e) => e.id === atual)?.nome || 'Esta empresa')
    })()
    return () => { alive = false }
  }, [])

  function trocar(id: string) {
    try { localStorage.setItem(EMPRESA_KEY, id) } catch { /* noop */ }
    try { window.location.reload() } catch { /* noop */ }
  }

  return (
    <div style={{ padding: 'clamp(16px,5vw,40px)', maxWidth: 560, margin: '0 auto', color: '#3D2314', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E0D8CC', borderRadius: 14, padding: 24 }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
          {empresaNome} não tem <span style={{ color: '#C8941A' }}>{areaNome}</span> contratado
        </div>
        <div style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, marginBottom: 16 }}>
          Esta área não faz parte do plano da empresa selecionada. Troque de empresa para uma que tenha {areaNome},
          ou fale com a PS Capital para contratar.
        </div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9C8E80', fontWeight: 600, marginBottom: 8 }}>Trocar de empresa</div>
        {empresas.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9C8E80' }}>Carregando empresas…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {empresas.map((e) => (
              <button key={e.id} type="button" onClick={() => trocar(e.id)}
                style={{ textAlign: 'left', background: '#FAF7F2', border: '1px solid #E0D8CC', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 600, color: '#3D2314', cursor: 'pointer' }}>
                {e.nome}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
