'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', espresso: '#3D2314' }

export default function OnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)

  const [form, setForm] = useState({
    nome: '', cnpj: '', nome_fantasia: '', email: '', telefone: '',
    cor_primaria: '#3D2314', cor_secundaria: '#C8941A', cor_fundo: '#FAF7F2',
    logo_url: '', plano: 'starter',
  })

  useEffect(() => {
    fetch('/api/assessor/onboarding')
      .then(r => r.json())
      .then(data => {
        if (data.assessorias && data.assessorias.length > 0) {
          const a = data.assessorias[0]
          setExistingId(a.id)
          setForm({
            nome: a.nome || '', cnpj: a.cnpj || '', nome_fantasia: a.nome_fantasia || '',
            email: a.email || '', telefone: a.telefone || '',
            cor_primaria: a.cor_primaria || '#3D2314', cor_secundaria: a.cor_secundaria || '#C8941A',
            cor_fundo: a.cor_fundo || '#FAF7F2', logo_url: a.logo_url || '', plano: a.plano || 'starter',
          })
        }
      })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!form.nome.trim()) { setError('Nome da assessoria e obrigatorio'); return }
    setLoading(true); setError(''); setSaved(false)

    try {
      const resp = await fetch('/api/assessor/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: existingId }),
      })
      const data = await resp.json()

      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Erro ao salvar')
      }

      if (data.assessoria?.id) setExistingId(data.assessoria.id)
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    }
    setLoading(false)
  }

  const u = (field: string, value: string) => setForm({ ...form, [field]: value })
  const inputSt: React.CSSProperties = { background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 14px', borderRadius: 6, fontSize: 13, width: '100%' }
  const labelSt: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 4, display: 'block' }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 4 }}>Cadastro da Assessoria</h1>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>PS Assessor | Configure dados e identidade visual</div>

        <div style={{ background: C.card, borderRadius: 8, padding: 20, marginBottom: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>Nome da Assessoria *</label>
            <input value={form.nome} onChange={e => u('nome', e.target.value)} placeholder="Ex: Minha Assessoria" style={inputSt} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelSt}>CNPJ</label><input value={form.cnpj} onChange={e => u('cnpj', e.target.value)} style={inputSt} /></div>
            <div><label style={labelSt}>Nome Fantasia</label><input value={form.nome_fantasia} onChange={e => u('nome_fantasia', e.target.value)} style={inputSt} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelSt}>Email</label><input type="email" value={form.email} onChange={e => u('email', e.target.value)} style={inputSt} /></div>
            <div><label style={labelSt}>Telefone</label><input value={form.telefone} onChange={e => u('telefone', e.target.value)} style={inputSt} /></div>
          </div>
          <div><label style={labelSt}>Plano</label>
            <select value={form.plano} onChange={e => u('plano', e.target.value)} style={inputSt}>
              <option value="starter">Starter - R$ 497/mes (5 clientes)</option>
              <option value="pro">Pro - R$ 1.497/mes (20 clientes)</option>
              <option value="enterprise">Enterprise - R$ 3.497/mes (ilimitado)</option>
            </select>
          </div>
        </div>

        <div style={{ background: C.card, borderRadius: 8, padding: 20, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Identidade Visual (White-label)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Cor Primaria', field: 'cor_primaria' },
              { label: 'Cor Secundaria', field: 'cor_secundaria' },
              { label: 'Cor Fundo', field: 'cor_fundo' },
            ].map(c => (
              <div key={c.field}>
                <label style={labelSt}>{c.label}</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="color" value={(form as any)[c.field]} onChange={e => u(c.field, e.target.value)} style={{ width: 36, height: 32, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
                  <input value={(form as any)[c.field]} onChange={e => u(c.field, e.target.value)} style={{ ...inputSt, flex: 1, fontSize: 11 }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: form.cor_fundo, borderRadius: 8, padding: 16, border: '1px solid ' + C.border }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: form.cor_primaria }}>{form.nome_fantasia || form.nome || 'Sua Assessoria'}</div>
            <div style={{ fontSize: 11, color: form.cor_secundaria, marginTop: 4 }}>Diagnostico Empresarial</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <span style={{ padding: '5px 14px', borderRadius: 6, background: form.cor_primaria, color: '#fff', fontSize: 11, fontWeight: 600 }}>Primario</span>
              <span style={{ padding: '5px 14px', borderRadius: 6, background: form.cor_secundaria, color: '#fff', fontSize: 11, fontWeight: 600 }}>Secundario</span>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: C.red + '15', border: '1px solid ' + C.red, borderRadius: 8, padding: 12, marginBottom: 12, color: C.red, fontSize: 12 }}>
            {error}
          </div>
        )}

        {saved && (
          <div style={{ background: C.green + '15', border: '1px solid ' + C.green, borderRadius: 8, padding: 12, marginBottom: 12, color: C.green, fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
            Dados salvos com sucesso!
          </div>
        )}

        <button onClick={handleSave} disabled={loading} style={{
          width: '100%', padding: '14px', borderRadius: 8, border: 'none',
          background: loading ? C.muted : C.gold, color: C.espresso,
          fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Salvando...' : existingId ? 'Atualizar' : 'Cadastrar Assessoria'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => router.push('/dashboard/assessor')} style={{ background: 'transparent', border: 'none', color: C.gold, cursor: 'pointer', fontSize: 12 }}>
            Voltar ao Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}