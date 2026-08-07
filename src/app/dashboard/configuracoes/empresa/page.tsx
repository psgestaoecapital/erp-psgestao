'use client'

// F1 · Configurações da empresa — Logomarca. Upload da logo (bucket company-assets, público) → grava
// companies.logo_url (via fn_empresa_salvar_logo). Preview usa o MESMO OSHeaderEmpresa da impressão da OS,
// então o que se vê aqui é o que sai no papel (RD-51). Dados fiscais só leitura (edição fica no fiscal).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import OSHeaderEmpresa, { type EmpresaHeader } from '@/components/os/OSHeaderEmpresa'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type CompRow = { id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null; inscricao_estadual: string | null; inscricao_municipal: string | null; endereco: string | null; cidade_estado: string | null; logo_url: string | null }

export default function ConfigEmpresaPage() {
  const { companyIds } = useCompanyIds()
  const [comps, setComps] = useState<CompRow[]>([])
  const [sel, setSel] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) return
    const { data } = await supabase.from('companies')
      .select('id,nome_fantasia,razao_social,cnpj,inscricao_estadual,inscricao_municipal,endereco,cidade_estado,logo_url')
      .in('id', companyIds)
    const list = (data as CompRow[] | null) ?? []
    setComps(list)
    setSel((s) => s || list[0]?.id || '')
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar])

  const emp = comps.find((c) => c.id === sel) ?? null
  const header: EmpresaHeader = {
    nome: emp?.nome_fantasia ?? emp?.razao_social, razao_social: emp?.razao_social, cnpj: emp?.cnpj,
    ie: emp?.inscricao_estadual, im: emp?.inscricao_municipal, endereco: emp?.endereco, cidade_estado: emp?.cidade_estado, logo: emp?.logo_url,
  }

  async function enviarLogo(file: File) {
    if (!sel) return
    if (!file.type.startsWith('image/')) { setMsg('Erro: envie um arquivo de imagem (PNG/JPG).'); return }
    if (file.size > 2 * 1024 * 1024) { setMsg('Erro: imagem acima de 2MB. Envie uma menor.'); return }
    setBusy(true); setMsg('')
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      const path = `${sel}/logo.${ext}`
      const up = await supabase.storage.from('company-assets').upload(path, file, { upsert: true, contentType: file.type })
      if (up.error) throw up.error
      const pub = supabase.storage.from('company-assets').getPublicUrl(path)
      const url = `${pub.data.publicUrl}?v=${Date.now()}` // cache-bust ao trocar
      const { data, error } = await supabase.rpc('fn_empresa_salvar_logo', { p_company_id: sel, p_logo_url: url })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string } | null
      if (!j?.sucesso) { setMsg('Erro: ' + (j?.erro ?? 'não salvou')); return }
      setMsg('ALTEROU a logomarca da empresa.')
      void carregar()
    } catch (e) { setMsg('Erro ao enviar: ' + (e as Error).message) } finally { setBusy(false) }
  }

  async function removerLogo() {
    if (!sel || !confirm('Remover a logomarca desta empresa?')) return
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('fn_empresa_salvar_logo', { p_company_id: sel, p_logo_url: '' })
    setBusy(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg('Logomarca removida.'); void carregar()
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Configurações</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Empresa · Logomarca</h1>

        {comps.length > 1 && (
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inp, marginBottom: 12, maxWidth: 340 }}>
            {comps.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>)}
          </select>
        )}
        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>Logomarca</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...btnPrim, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Enviando…' : emp?.logo_url ? 'Trocar logo' : 'Enviar logo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarLogo(f) }} />
            </label>
            {emp?.logo_url && <button onClick={removerLogo} disabled={busy} style={btnGhost}>Remover</button>}
          </div>
          <div style={{ fontSize: 10.5, color: MUT, marginTop: 8 }}>PNG ou JPG, até 2MB. A logo aparece no cabeçalho da OS impressa.</div>
        </div>

        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>Prévia do cabeçalho (como sai na OS)</div>
          {emp ? <OSHeaderEmpresa empresa={header} /> : <div style={{ color: MUT, fontSize: 13 }}>Selecione uma empresa.</div>}
          {emp && !emp.endereco && <div style={{ fontSize: 11, color: MUT, marginTop: 8 }}>ℹ️ Endereço não preenchido — a linha de endereço não aparece. Preencha nos dados fiscais da empresa.</div>}
        </div>
      </div>
    </div>
  )
}
const inp: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
const btnPrim: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#FFF', background: ESP, border: 'none', borderRadius: 9, padding: '9px 16px', display: 'inline-block' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: '#FFF', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }
