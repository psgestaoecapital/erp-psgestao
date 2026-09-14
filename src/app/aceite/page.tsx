'use client'
// LGPD · tela de aceite (ROTA, não modal — o #124 montava modal no root layout e aparecia em
// TODA página, inclusive login/públicas; foi revertido em 47s no #126. A rota + gate no guard
// evita essa causa provável). O guard (ConsentGuard) manda pra cá quem está pendente na versão
// vigente. Grava via server action /api/lgpd/aceitar (IP + user_agent no servidor).
//
// Decisão CEO (④): SEM aviso prévio ao time → a tela precisa se explicar sozinha. 1ª linha diz
// POR QUE a pessoa está vendo isto. Vale inclusive para quem já aceitou antes (versão 1.2).
// Decisão CEO (③) + Art. 9º: transparência da IA é obrigatória mesmo com base ≠ consentimento —
// bloco informativo (não checkbox). Marketing é o único consentimento opcional de verdade.
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = { bg:'#0F0F0F', card:'#1A1410', card2:'#1E1E1B', border:'#2A2822', gold:'#C8941A', goldL:'#E8C872', text:'#FAF7F2', muted:'#B0AB9F', dim:'#918C82', green:'#22C55E', blue:'#3B82F6' }

export default function AceitePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const [aceiteTermos, setAceiteTermos] = useState(false)
  const [aceitePrivacidade, setAceitePrivacidade] = useState(false)
  const [aceiteMarketing, setAceiteMarketing] = useState(false)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (ignore) return
      if (!user) { window.location.href = '/'; return }  // sem sessão: fora daqui
      setLoading(false)
    })()
    return () => { ignore = true }
  }, [])

  const aceitar = async () => {
    if (!aceiteTermos || !aceitePrivacidade || saving) return
    setSaving(true); setErro('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErro('Sessão expirada. Faça login novamente.'); setSaving(false); return }
      const resp = await fetch('/api/lgpd/aceitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ aceite_marketing: aceiteMarketing }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || json?.ok === false) {
        setErro(json?.error || 'Não foi possível registrar seu aceite. Tente novamente.')
        setSaving(false)
        return
      }
      // aceite gravado (consolidado + granular + IP/UA) → segue pro sistema.
      router.replace('/dashboard')
    } catch {
      setErro('Falha de conexão ao registrar o aceite. Tente novamente.')
      setSaving(false)
    }
  }

  const recusar = async () => {
    try { await supabase.auth.signOut() } catch { /* */ }
    window.location.href = '/'
  }

  if (loading) return null

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:C.card, borderRadius:16, maxWidth:640, width:'100%', maxHeight:'94vh', overflow:'auto', border:'2px solid '+C.gold, boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ padding:'24px 28px 16px', borderBottom:'1px solid '+C.border, background:'linear-gradient(135deg,'+C.bg+','+C.card+')' }}>
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
            <div style={{ fontSize:32, fontWeight:900, color:C.gold, letterSpacing:'0.05em' }}>PS<span style={{ color:C.goldL }}>G</span></div>
            <div>
              <div style={{ fontSize:10, letterSpacing:'0.25em', color:C.goldL }}>PS GESTÃO & CAPITAL</div>
              <div style={{ fontSize:9, color:C.dim }}>Assessoria Empresarial · BPO Financeiro</div>
            </div>
          </div>
          {/* 1ª linha explica POR QUE está vendo isto (não houve aviso prévio — decisão CEO) */}
          <div style={{ fontSize:17, fontWeight:700, color:C.text, marginTop:14 }}>Atualizamos nossos termos</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:6, lineHeight:1.6 }}>
            Atualizamos nossos termos e a forma de registrar seu aceite. Precisamos da sua confirmação
            para continuar — leva menos de um minuto. <strong style={{ color:C.muted }}>Vale inclusive para quem já aceitou antes.</strong>
          </div>
        </div>

        <div style={{ padding:'20px 28px' }}>
          {/* Transparência da IA (Art. 9º) — INFORMATIVO, não checkbox. A IA é condição de uso. */}
          <div style={{ background:C.card2, borderRadius:10, padding:'14px 16px', marginBottom:16, borderLeft:'3px solid '+C.blue }}>
            <div style={{ fontSize:11, color:C.goldL, marginBottom:6, letterSpacing:'0.05em', fontWeight:600 }}>COMO USAMOS INTELIGÊNCIA ARTIFICIAL</div>
            <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>
              Este sistema usa inteligência artificial para analisar seus dados financeiros e gerar
              relatórios. Os dados são enviados para processamento e <strong style={{ color:C.text }}>não são usados para treinar modelos</strong>.
              Detalhes na <Link href="/privacidade" target="_blank" style={{ color:C.gold, textDecoration:'underline' }}>Política de Privacidade</Link>.
            </div>
          </div>

          <label style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 16px', background:aceiteTermos?C.green+'10':C.card2, border:'1px solid '+(aceiteTermos?C.green:C.border), borderRadius:10, marginBottom:10, cursor:'pointer' }}>
            <input type="checkbox" checked={aceiteTermos} onChange={e=>setAceiteTermos(e.target.checked)} style={{ marginTop:3, cursor:'pointer', width:16, height:16, accentColor:C.gold }} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:aceiteTermos?C.green:C.text, marginBottom:3 }}>
                Li e aceito os <Link href="/termos" target="_blank" style={{ color:C.gold, textDecoration:'underline' }}>Termos de Uso</Link>
              </div>
              <div style={{ fontSize:10, color:C.dim }}>Inclui o uso de IA (Anthropic) descrito acima, planos, obrigações e responsabilidades.</div>
            </div>
          </label>

          <label style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 16px', background:aceitePrivacidade?C.green+'10':C.card2, border:'1px solid '+(aceitePrivacidade?C.green:C.border), borderRadius:10, marginBottom:10, cursor:'pointer' }}>
            <input type="checkbox" checked={aceitePrivacidade} onChange={e=>setAceitePrivacidade(e.target.checked)} style={{ marginTop:3, cursor:'pointer', width:16, height:16, accentColor:C.gold }} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:aceitePrivacidade?C.green:C.text, marginBottom:3 }}>
                Li e aceito a <Link href="/privacidade" target="_blank" style={{ color:C.gold, textDecoration:'underline' }}>Política de Privacidade</Link>
              </div>
              <div style={{ fontSize:10, color:C.dim }}>Dados coletados, bases legais, armazenamento, direitos do titular e DPO.</div>
            </div>
          </label>

          {/* ÚNICO consentimento opcional de verdade (Art. 8º — livre). Nasce DESmarcado. */}
          <label style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 16px', background:aceiteMarketing?C.gold+'10':C.card2, border:'1px solid '+(aceiteMarketing?C.gold:C.border), borderRadius:10, marginBottom:16, cursor:'pointer' }}>
            <input type="checkbox" checked={aceiteMarketing} onChange={e=>setAceiteMarketing(e.target.checked)} style={{ marginTop:3, cursor:'pointer', width:16, height:16, accentColor:C.gold }} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:aceiteMarketing?C.gold:C.text, marginBottom:3 }}>
                Aceito receber comunicações de marketing <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>(opcional)</span>
              </div>
              <div style={{ fontSize:10, color:C.dim }}>Novidades e conteúdos da PS Gestão. Pode ser revogado a qualquer momento — não afeta o uso do sistema.</div>
            </div>
          </label>

          <div style={{ background:C.bg, borderRadius:8, padding:'10px 14px', fontSize:10, color:C.dim, borderLeft:'3px solid '+C.gold+'60', marginBottom:8 }}>
            <div style={{ marginBottom:3 }}><strong style={{ color:C.muted }}>Registro do aceite:</strong> gravado com data, hora, IP e versão dos documentos, conforme a LGPD.</div>
            <div><strong style={{ color:C.muted }}>DPO:</strong> <a href="mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com" style={{ color:C.gold }}>paravizi-salvi@gpconsultoriadeinvestimentos.com</a></div>
          </div>

          {erro && (
            <div style={{ background:'#EF444418', border:'1px solid #EF444455', color:'#FCA5A5', borderRadius:8, padding:'10px 14px', fontSize:12, marginBottom:8 }}>{erro}</div>
          )}
        </div>

        <div style={{ padding:'16px 28px 24px', borderTop:'1px solid '+C.border, display:'flex', gap:10, background:C.card2 }}>
          <button onClick={recusar} disabled={saving} style={{ flex:1, padding:'12px', borderRadius:8, fontSize:12, cursor:saving?'not-allowed':'pointer', border:'1px solid '+C.border, background:'transparent', color:C.muted, fontWeight:500 }}>
            Recusar e sair
          </button>
          <button onClick={aceitar} disabled={!aceiteTermos || !aceitePrivacidade || saving} style={{
            flex:2, padding:'12px', borderRadius:8, fontSize:13, fontWeight:700,
            cursor:(!aceiteTermos || !aceitePrivacidade || saving)?'not-allowed':'pointer',
            border:'none', color:C.bg,
            background:(aceiteTermos && aceitePrivacidade && !saving)?'linear-gradient(135deg,'+C.gold+','+C.goldL+')':C.border,
            opacity:(!aceiteTermos || !aceitePrivacidade)?0.5:1,
          }}>
            {saving ? 'Registrando…' : 'Aceitar e continuar'}
          </button>
        </div>
      </div>
    </div>
  )
}
