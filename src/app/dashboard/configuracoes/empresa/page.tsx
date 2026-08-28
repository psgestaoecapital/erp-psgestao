'use client'

// Dados da Empresa — cadastral + logomarca. Completa o cabeçalho da OS impressa (logo/endereço).
// LÊ e GRAVA só campos cadastrais via RPC (fn_empresa_obter_dados / fn_empresa_salvar_dados) — NUNCA
// consulta companies direto (a tabela guarda segredos de integração). Logo via fn_empresa_salvar_logo
// (bucket company-assets, público). Prévia usa o MESMO OSHeaderEmpresa da impressão (RD-51). Mobile-first.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import OSHeaderEmpresa, { type EmpresaHeader } from '@/components/os/OSHeaderEmpresa'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Dados = {
  id: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null
  inscricao_estadual: string | null; inscricao_municipal: string | null; cidade_estado: string | null
  endereco: string | null; cnae: string | null; regime_tributario: string | null; logo_url: string | null
}
type Form = { razao_social: string; nome_fantasia: string; cnpj: string; inscricao_estadual: string; inscricao_municipal: string; cidade_estado: string; endereco: string; cnae: string; regime_tributario: string }
const FORM_VAZIO: Form = { razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '', inscricao_municipal: '', cidade_estado: '', endereco: '', cnae: '', regime_tributario: '' }

const REGIMES = [
  { v: '', l: '— selecionar —' }, { v: 'simples_nacional', l: 'Simples Nacional' },
  { v: 'lucro_presumido', l: 'Lucro Presumido' }, { v: 'lucro_real', l: 'Lucro Real' }, { v: 'mei', l: 'MEI' },
]

function maskCNPJ(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export default function ConfigEmpresaPage() {
  const { companyIds } = useCompanyIds()
  const [comps, setComps] = useState<Dados[]>([])
  const [sel, setSel] = useState<string>('')
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [busy, setBusy] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) return
    const results = await Promise.all(companyIds.map((id) => supabase.rpc('fn_empresa_obter_dados', { p_company_id: id })))
    const list = results.map((r) => r.data as (Dados & { sucesso?: boolean }) | null).filter((d): d is Dados & { sucesso: boolean } => !!d && d.sucesso === true)
    setComps(list)
    setSel((s) => s || list[0]?.id || '')
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar])

  // popula o form quando muda a empresa selecionada / recarrega
  useEffect(() => {
    const d = comps.find((c) => c.id === sel)
    if (!d) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      razao_social: d.razao_social ?? '', nome_fantasia: d.nome_fantasia ?? '', cnpj: maskCNPJ(d.cnpj ?? ''),
      inscricao_estadual: d.inscricao_estadual ?? '', inscricao_municipal: d.inscricao_municipal ?? '',
      cidade_estado: (d.cidade_estado ?? '').trim(), endereco: d.endereco ?? '', cnae: d.cnae ?? '',
      regime_tributario: d.regime_tributario ?? '',
    })
  }, [sel, comps])

  const emp = comps.find((c) => c.id === sel) ?? null
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // prévia do cabeçalho: LIVE dos campos do form + logo atual
  const header: EmpresaHeader = {
    nome: form.nome_fantasia || form.razao_social, razao_social: form.razao_social, cnpj: form.cnpj,
    ie: form.inscricao_estadual, im: form.inscricao_municipal, endereco: form.endereco, cidade_estado: form.cidade_estado, logo: emp?.logo_url,
  }

  async function salvar() {
    if (!sel) return
    if (!form.razao_social.trim()) { setMsg('Erro: Razão social é obrigatória.'); return }
    setSalvando(true); setMsg('')
    const { data, error } = await supabase.rpc('fn_empresa_salvar_dados', {
      p_company_id: sel, p_razao_social: form.razao_social, p_nome_fantasia: form.nome_fantasia, p_cnpj: form.cnpj,
      p_inscricao_estadual: form.inscricao_estadual, p_inscricao_municipal: form.inscricao_municipal,
      p_cidade_estado: form.cidade_estado, p_endereco: form.endereco, p_cnae: form.cnae, p_regime_tributario: form.regime_tributario,
    })
    setSalvando(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    const j = data as { sucesso?: boolean; erro?: string; mensagem?: string } | null
    if (!j?.sucesso) { setMsg('Erro: ' + (j?.erro === 'sem_acesso' ? 'Você não tem permissão para editar esta empresa.' : (j?.mensagem ?? j?.erro ?? 'não salvou'))); return }
    setMsg('✅ Dados da empresa salvos.'); void carregar()
  }

  async function enviarLogo(file: File) {
    if (!sel) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) { setMsg('Erro: envie PNG, JPG, WEBP ou SVG.'); return }
    if (file.size > 2 * 1024 * 1024) { setMsg('Erro: imagem acima de 2MB. Envie uma menor.'); return }
    setBusy(true); setMsg('')
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      const path = `${sel}/logo_${Date.now()}.${ext}`
      const up = await supabase.storage.from('company-assets').upload(path, file, { upsert: true, contentType: file.type })
      if (up.error) throw up.error
      const pub = supabase.storage.from('company-assets').getPublicUrl(path)
      const { data, error } = await supabase.rpc('fn_empresa_salvar_logo', { p_company_id: sel, p_logo_url: pub.data.publicUrl })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string } | null
      if (!j?.sucesso) { setMsg('Erro: ' + (j?.erro ?? 'não salvou')); return }
      setMsg('✅ Logo atualizado.'); void carregar()
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
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Dados da Empresa</h1>

        {comps.length > 1 && (
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inp, marginBottom: 12, maxWidth: 340 }}>
            {comps.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>)}
          </select>
        )}
        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {/* Cadastro */}
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 12 }}>Cadastro</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Campo label="Razão social *" span><input value={form.razao_social} onChange={(e) => set('razao_social', e.target.value)} style={inp} /></Campo>
            <Campo label="Nome fantasia"><input value={form.nome_fantasia} onChange={(e) => set('nome_fantasia', e.target.value)} style={inp} /></Campo>
            <Campo label="CNPJ"><input value={form.cnpj} onChange={(e) => set('cnpj', maskCNPJ(e.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" style={inp} /></Campo>
            <Campo label="Inscrição estadual"><input value={form.inscricao_estadual} onChange={(e) => set('inscricao_estadual', e.target.value)} style={inp} /></Campo>
            <Campo label="Inscrição municipal"><input value={form.inscricao_municipal} onChange={(e) => set('inscricao_municipal', e.target.value)} style={inp} /></Campo>
            <Campo label="Cidade/Estado"><input value={form.cidade_estado} onChange={(e) => set('cidade_estado', e.target.value)} placeholder="São Miguel do Oeste/SC" style={inp} /></Campo>
            <Campo label="CNAE"><input value={form.cnae} onChange={(e) => set('cnae', e.target.value)} placeholder="0000-0/00" style={inp} /></Campo>
            <Campo label="Regime tributário">
              <select value={form.regime_tributario} onChange={(e) => set('regime_tributario', e.target.value)} style={inp}>
                {REGIMES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </Campo>
            <Campo label="Endereço (sai no cabeçalho da OS)" span>
              <textarea value={form.endereco} onChange={(e) => set('endereco', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="Rua, nº, bairro" />
            </Campo>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => void salvar()} disabled={salvando || !emp} style={{ ...btnPrim, background: GOLD, color: ESP, opacity: (salvando || !emp) ? 0.6 : 1, cursor: salvando ? 'wait' : 'pointer' }}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Logomarca */}
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>Logomarca</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...btnPrim, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Enviando…' : emp?.logo_url ? 'Trocar logo' : 'Enviar logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarLogo(f) }} />
            </label>
            {emp?.logo_url && <button onClick={removerLogo} disabled={busy} style={btnGhost}>Remover</button>}
          </div>
          <div style={{ fontSize: 10.5, color: MUT, marginTop: 8 }}>PNG, JPG, WEBP ou SVG, até 2MB. A logo aparece nos orçamentos, nas ordens de serviço e no topo do sistema.</div>
          {/* BRAND-1 · aviso útil (não é erro): sem badge vermelho, sem bloqueio */}
          {emp && !emp.logo_url && (
            <div style={{ fontSize: 11.5, color: ESP, background: '#FFF8E7', border: `0.5px solid ${GOLD}`, borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>
              Sua empresa ainda não tem logo. Ele aparece nos orçamentos, nas ordens de serviço e no topo do sistema.
            </div>
          )}
        </div>

        {/* Prévia */}
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>Prévia do cabeçalho (como sai na OS)</div>
          {emp ? <OSHeaderEmpresa empresa={header} /> : <div style={{ color: MUT, fontSize: 13 }}>Selecione uma empresa.</div>}
          {emp && !form.endereco.trim() && <div style={{ fontSize: 11, color: MUT, marginTop: 8 }}>ℹ️ Sem endereço, a linha de endereço não aparece na OS. Preencha acima e salve.</div>}
        </div>
      </div>
    </div>
  )
}

function Campo({ label, span, children }: { label: string; span?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={{ fontSize: 11, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}
const inp: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP, boxSizing: 'border-box', fontFamily: 'inherit' }
const btnPrim: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#FFF', background: ESP, border: 'none', borderRadius: 9, padding: '9px 18px', display: 'inline-block' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: '#FFF', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }
