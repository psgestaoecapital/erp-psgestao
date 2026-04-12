'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', espresso: '#3D2314' }

export default function OnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)

  const [form, setForm] = useState({
    nome: '',
    cnpj: '',
    nome_fantasia: '',
    email: '',
    telefone: '',
    cor_primaria: '#3D2314',
    cor_secundaria: '#C8941A',
    cor_fundo: '#FAF7F2',
    logo_url: '',
    plano: 'starter',
  })

  // Carregar assessoria existente
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('assessorias').select('*').limit(1)
      if (data && data.length > 0) {
        const a = data[0]
        setExistingId(a.id)
        setForm({
          nome: a.nome || '',
          cnpj: a.cnpj || '',
          nome_fantasia: a.nome_fantasia || '',
          email: a.email || '',
          telefone: a.telefone || '',
          cor_primaria: a.cor_primaria || '#3D2314',
          cor_secundaria: a.cor_secundaria || '#C8941A',
          cor_fundo: a.cor_fundo || '#FAF7F2',
          logo_url: a.logo_url || '',
          plano: a.plano || 'starter',
        })
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    if (!form.nome.trim()) { setError('Nome da assessoria e obrigatorio'); return }
    setLoading(true)
    setError('')
    setSaved(false)

    try {
      if (existingId) {
        // Atualizar existente
        const { error: err } = await supabase
          .from('assessorias')
          .update({
            nome: form.nome,
            cnpj: form.cnpj,
            nome_fantasia: form.nome_fantasia,
            email: form.email,
            telefone: form.telefone,
            cor_primaria: form.cor_primaria,
            cor_secundaria: form.cor_secundaria,
            cor_fundo: form.cor_fundo,
            logo_url: form.logo_url,
            plano: form.plano,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId)

        if (err) throw err
      } else {
        // Criar nova
        const { data, error: err } = await supabase
          .from('assessorias')
          .insert({
            nome: form.nome,
            cnpj: form.cnpj,
            nome_fantasia: form.nome_fantasia,
            email: form.email,
            telefone: form.telefone,
            cor_primaria: form.cor_primaria,
            cor_secundaria: form.cor_secundaria,
            cor_fundo: form.cor_fundo,
            logo_url: form.logo_url,
            plano: form.plano,
          })
          .select()

        if (err) throw err
        if (data && data.length > 0) setExistingId(data[0].id)
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar'
      setError(msg)
    }
    setLoading(false)
  }

  const update = (field: string, value: string) => setForm({ ...form, [field]: value })

  const inputSt: React.CSSProperties = { background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '10px 14px', borderRadius: 6, fontSize: 13, width: '100%' }
  const labelSt: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 4, display: 'block' }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 4 }}>Cadastro da Assessoria</h1>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 20 }}>PS Assessor | Configure os dados e identidade visual</div>

        {/* Dados */}
        <div style={{ background: C.card, borderRadius: 8, padding: 20, marginBottom: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={labelSt}>Nome da Assessoria *</label>
            <input value={form.nome} onChange={e => update('nome', e.target.value)} placeholder="Ex: Minha Assessoria" style={inputSt} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelSt}>CNPJ</label>
              <input value={form.cnpj} onChange={e => update('cnpj', e.target.value)} placeholder="00.000.000/0001-00" style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>Nome Fantasia</label>
              <input value={form.nome_fantasia} onChange={e => update('nome_fantasia', e.target.value)} style={inputSt} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelSt}>Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>Telefone</label>
              <input value={form.telefone} onChange={e => update('telefone', e.target.value)} style={inputSt} />
            </div>
          </div>

          <div>
            <label style={labelSt}>Plano</label>
            <select value={form.plano} onChange={e => update('plano', e.target.value)} style={inputSt}>
              <option value="starter">Starter - R$ 497/mes (5 clientes)</option>
              <option value="pro">Pro - R$ 1.497/mes (20 clientes)</option>
              <option value="enterprise">Enterprise - R$ 3.497/mes (ilimitado)</option>
            </select>
          </div>
        </div>

        {/* White-label */}
        <div style={{ background: C.card, borderRadius: 8, padding: 20, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 12 }}>Identidade Visual (White-label)</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelSt}>Cor Primaria</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={form.cor_primaria} onChange={e => update('cor_primaria', e.target.value)} style={{ width: 40, height: 36, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
                <input value={form.cor_primaria} onChange={e => update('cor_primaria', e.target.value)} style={{ ...inputSt, flex: 1 }} />
              </div>
            </div>
            <div>
              <label style={labelSt}>Cor Secundaria</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={form.cor_secundaria} onChange={e => update('cor_secundaria', e.target.value)} style={{ width: 40, height: 36, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
                <input value={form.cor_secundaria} onChange={e => update('cor_secundaria', e.target.value)} style={{ ...inputSt, flex: 1 }} />
              </div>
            </div>
            <div>
              <label style={labelSt}>Cor Fundo</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={form.cor_fundo} onChange={e => update('cor_fundo', e.target.value)} style={{ width: 40, height: 36, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
                <input value={form.cor_fundo} onChange={e => update('cor_fundo', e.target.value)} style={{ ...inputSt, flex: 1 }} />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div style={{ background: form.cor_fundo, borderRadius: 8, padding: 20, border: '1px solid ' + C.border }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: form.cor_primaria }}>
              Preview: {form.nome_fantasia || form.nome || 'Sua Assessoria'}
            </div>
            <div style={{ fontSize: 12, color: form.cor_secundaria, marginTop: 4 }}>Diagnostico Empresarial</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <span style={{ padding: '6px 16px', borderRadius: 6, background: form.cor_primaria, color: '#fff', fontSize: 12, fontWeight: 600 }}>Primario</span>
              <span style={{ padding: '6px 16px', borderRadius: 6, background: form.cor_secundaria, color: '#fff', fontSize: 12, fontWeight: 600 }}>Secundario</span>
            </div>
          </div>
        </div>

        {/* Feedback */}
        {error && (
          <div style={{ background: C.red + '20', border: '1px solid ' + C.red, borderRadius: 8, padding: 12, marginBottom: 12, color: C.red, fontSize: 12 }}>
            Erro: {error}
          </div>
        )}

        {saved && (
          <div style={{ background: C.green + '20', border: '1px solid ' + C.green, borderRadius: 8, padding: 12, marginBottom: 12, color: C.green, fontSize: 12, fontWeight: 700 }}>
            Dados salvos com sucesso!
          </div>
        )}

        {/* Botao Salvar */}
        <button onClick={handleSave} disabled={loading} style={{
          width: '100%', padding: '14px 20px', borderRadius: 8, border: 'none',
          background: loading ? C.muted : C.gold, color: C.espresso,
          fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Salvando...' : existingId ? 'Atualizar' : 'Cadastrar Assessoria'}
        </button>

        {/* Voltar */}
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => router.push('/dashboard/assessor')} style={{
            background: 'transparent', border: 'none', color: C.gold, cursor: 'pointer', fontSize: 12,
          }}>Voltar ao Dashboard</button>
        </div>
      </div>
    </div>
  )
}