'use client'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ImportLoteXlsxCard from '@/components/importar/ImportLoteXlsxCard'
import ImportProdutosFiscalCard from '@/components/importar/ImportProdutosFiscalCard'

const C = {
  bg: '#FAF7F2',
  card: '#FFFFFF',
  espresso: '#3D2314',
  dourado: '#C8941A',
  douradoSoft: '#FFF8E7',
  border: 'rgba(61,35,20,0.12)',
  text: '#3D2314',
  muted: 'rgba(61,35,20,0.65)',
}

interface Company {
  id: string
  nome_fantasia?: string | null
  razao_social?: string | null
  nome?: string | null
}

type Modo = 'lancamentos' | 'produtos_fiscal'

export default function ImportarUniversalPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [modo, setModo] = useState<Modo>('lancamentos')

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
      let comps: Company[] = []
      if (up?.role === 'adm' || up?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('*').order('nome_fantasia')
        comps = (data ?? []) as Company[]
      } else {
        const { data: uc } = await supabase.from('user_companies').select('companies(*)').eq('user_id', user.id)
        const rows = (uc ?? []) as unknown as Array<{ companies: Company | Company[] | null }>
        comps = rows.flatMap((u) => Array.isArray(u.companies) ? u.companies : (u.companies ? [u.companies] : []))
      }
      setCompanies(comps)
      if (comps.length > 0) {
        const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
        const match = saved && !saved.startsWith('group_') && saved !== 'consolidado' ? comps.find((c) => c.id === saved) : null
        setCompanyId(match ? match.id : comps[0].id)
      }
    })()
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "system-ui, 'Segoe UI', sans-serif" }}>
      <header style={{ background: C.espresso, padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${C.dourado}`, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: C.dourado, margin: 0, fontFamily: 'Fraunces, Georgia, serif' }}>
            Importer Universal
          </h1>
          <p style={{ fontSize: 11, color: 'rgba(250,247,242,0.75)', margin: '2px 0 0' }}>
            Lançamentos · Produtos (fiscal) · planilha livre com auto-detecção
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            style={{ background: '#FFFFFF', border: `1px solid ${C.dourado}`, color: C.espresso, borderRadius: 6, padding: '6px 10px', fontSize: 12, maxWidth: 280, fontFamily: 'inherit' }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome_fantasia || c.nome || c.razao_social || c.id}
              </option>
            ))}
          </select>
          <a href="/dashboard" style={{ padding: '6px 12px', border: '1px solid rgba(250,247,242,0.3)', borderRadius: 6, color: '#FAF7F2', fontSize: 11, textDecoration: 'none' }}>
            ← Dashboard
          </a>
        </div>
      </header>

      <main style={{ padding: '24px 24px 40px', maxWidth: 1100, margin: '0 auto' }}>
        {!companyId ? (
          <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 32, textAlign: 'center', color: C.muted, fontSize: 13 }}>
            Selecione uma empresa para começar.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 8 }}>
              O que importar?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
              <ModoCard
                ativo={modo === 'lancamentos'}
                onClick={() => setModo('lancamentos')}
                icone="📋"
                titulo="Lançamentos"
                sub="Pagar / Receber em lote"
              />
              <ModoCard
                ativo={modo === 'produtos_fiscal'}
                onClick={() => setModo('produtos_fiscal')}
                icone="🧾"
                titulo="Produtos — atualização fiscal"
                sub="NCM · ICMS-ST · CEST · PIS/COFINS"
              />
            </div>

            {modo === 'lancamentos' && <ImportLoteXlsxCard companyId={companyId} />}
            {modo === 'produtos_fiscal' && <ImportProdutosFiscalCard companyId={companyId} />}
          </>
        )}

        <div style={{ background: C.douradoSoft, border: `0.5px solid ${C.dourado}`, borderRadius: 8, padding: '12px 16px', marginTop: 16, fontSize: 12, color: C.espresso, lineHeight: 1.5 }}>
          <strong>💡 Dica:</strong> Planilha livre · preview com semáforo antes de aplicar. Lançamentos vão pro DRE; produtos atualizam CST/CFOP/CEST por <code>codigo</code>.
        </div>
      </main>
    </div>
  )
}

function ModoCard({ ativo, onClick, icone, titulo, sub }: { ativo: boolean; onClick: () => void; icone: string; titulo: string; sub: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ativo ? '#FFF8E7' : '#FFFFFF',
        border: `2px solid ${ativo ? '#C8941A' : 'rgba(61,35,20,0.12)'}`,
        borderRadius: 8, padding: '14px 16px',
        cursor: 'pointer', textAlign: 'left', font: 'inherit',
        display: 'flex', alignItems: 'center', gap: 12, minHeight: 56,
      }}
    >
      <span style={{ fontSize: 24 }}>{icone}</span>
      <span>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>{titulo}</div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.6)', marginTop: 2 }}>{sub}</div>
      </span>
    </button>
  )
}
