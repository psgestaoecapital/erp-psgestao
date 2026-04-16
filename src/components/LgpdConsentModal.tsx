'use client'
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const C={bg:'#0F0F0F',card:'#1A1410',card2:'#1E1E1B',border:'#2A2822',gold:'#C8941A',goldL:'#E8C872',text:'#FAF7F2',muted:'#B0AB9F',dim:'#918C82',green:'#22C55E',red:'#EF4444'}

export default function LgpdConsentModal(){
  const [show,setShow]=useState(false)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [userId,setUserId]=useState('')
  const [userEmail,setUserEmail]=useState('')
  const [aceiteTermos,setAceiteTermos]=useState(false)
  const [aceitePrivacidade,setAceitePrivacidade]=useState(false)
  const [aceiteIA,setAceiteIA]=useState(false)

  useEffect(()=>{
    (async()=>{
      const{data:{user}}=await supabase.auth.getUser()
      if(!user){setLoading(false);return}
      setUserId(user.id)
      setUserEmail(user.email||'')
      const{data}=await supabase.from('lgpd_consentimentos')
        .select('id')
        .eq('user_id',user.id)
        .eq('aceite_termos',true)
        .eq('aceite_privacidade',true)
        .eq('revogado',false)
        .maybeSingle()
      if(!data)setShow(true)
      setLoading(false)
    })()
  },[])

  const aceitar=async()=>{
    if(!aceiteTermos||!aceitePrivacidade)return
    setSaving(true)
    try{
      const ua=typeof navigator!=='undefined'?navigator.userAgent:''
      await supabase.from('lgpd_consentimentos').insert({
        user_id:userId,user_email:userEmail,
        termos_versao:'1.1',privacidade_versao:'1.1',
        aceite_termos:true,aceite_privacidade:true,aceite_ia_dados:aceiteIA,
        user_agent:ua,
      })
      setShow(false)
    }catch(e){alert('Erro ao registrar aceite.')}
    setSaving(false)
  }

  if(loading||!show)return null

  return(
    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20,backdropFilter:'blur(6px)'}}>
      <div style={{background:C.card,borderRadius:16,maxWidth:620,width:'100%',maxHeight:'90vh',overflow:'auto',border:'2px solid '+C.gold,boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}}>
        <div style={{padding:'24px 28px 16px',borderBottom:'1px solid '+C.border,background:'linear-gradient(135deg,'+C.bg+','+C.card+')'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12}}>
            <div style={{fontSize:32,fontWeight:900,color:C.gold,letterSpacing:'0.05em'}}>PS<span style={{color:C.goldL}}>G</span></div>
            <div>
              <div style={{fontSize:10,letterSpacing:'0.25em',color:C.goldL}}>PS GESTAO & CAPITAL</div>
              <div style={{fontSize:9,color:C.dim}}>Assessoria Empresarial - BPO Financeiro</div>
            </div>
          </div>
          <div style={{fontSize:18,fontWeight:700,color:C.text,marginTop:14}}>Bem-vindo a Plataforma</div>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>Antes de comecar, precisamos que voce leia e aceite nossos documentos legais.</div>
        </div>

        <div style={{padding:'20px 28px'}}>
          <div style={{background:C.card2,borderRadius:8,padding:'14px 16px',marginBottom:16,borderLeft:'3px solid '+C.gold}}>
            <div style={{fontSize:11,color:C.dim,marginBottom:6}}>DOCUMENTOS VIGENTES</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>
              Os documentos abaixo descrevem como coletamos e protegemos seus dados em conformidade com a <strong style={{color:C.goldL}}>LGPD (Lei 13.709/2018)</strong>. Dedique alguns minutos para leitura.
            </div>
          </div>

          <label style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px',background:aceiteTermos?C.green+'10':C.card2,border:'1px solid '+(aceiteTermos?C.green:C.border),borderRadius:10,marginBottom:10,cursor:'pointer'}}>
            <input type="checkbox" checked={aceiteTermos} onChange={e=>setAceiteTermos(e.target.checked)} style={{marginTop:3,cursor:'pointer',width:16,height:16,accentColor:C.gold}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:aceiteTermos?C.green:C.text,marginBottom:3}}>
                Li e aceito os <Link href="/termos" target="_blank" style={{color:C.gold,textDecoration:'underline'}}>Termos de Uso</Link>
              </div>
              <div style={{fontSize:10,color:C.dim}}>Objeto, cadastro, servicos, planos, propriedade intelectual, obrigacoes, rescisao e foro.</div>
            </div>
          </label>

          <label style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px',background:aceitePrivacidade?C.green+'10':C.card2,border:'1px solid '+(aceitePrivacidade?C.green:C.border),borderRadius:10,marginBottom:10,cursor:'pointer'}}>
            <input type="checkbox" checked={aceitePrivacidade} onChange={e=>setAceitePrivacidade(e.target.checked)} style={{marginTop:3,cursor:'pointer',width:16,height:16,accentColor:C.gold}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:aceitePrivacidade?C.green:C.text,marginBottom:3}}>
                Li e aceito a <Link href="/privacidade" target="_blank" style={{color:C.gold,textDecoration:'underline'}}>Politica de Privacidade</Link>
              </div>
              <div style={{fontSize:10,color:C.dim}}>Dados coletados, bases legais, armazenamento, compartilhamento, direitos do titular e DPO.</div>
            </div>
          </label>

          <label style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px',background:aceiteIA?C.gold+'10':C.card2,border:'1px solid '+(aceiteIA?C.gold:C.border),borderRadius:10,marginBottom:16,cursor:'pointer'}}>
            <input type="checkbox" checked={aceiteIA} onChange={e=>setAceiteIA(e.target.checked)} style={{marginTop:3,cursor:'pointer',width:16,height:16,accentColor:C.gold}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:aceiteIA?C.gold:C.text,marginBottom:3}}>
                Autorizo processamento por Inteligencia Artificial <span style={{fontSize:10,color:C.dim,fontWeight:400}}>(opcional)</span>
              </div>
              <div style={{fontSize:10,color:C.dim}}>
                Dados financeiros agregados poderao ser processados pela API Claude (Anthropic) para classificacao automatica, anti-fraude e geracao de relatorios. <strong>Pode ser revogado a qualquer momento.</strong>
              </div>
            </div>
          </label>

          <div style={{background:C.bg,borderRadius:8,padding:'10px 14px',fontSize:10,color:C.dim,borderLeft:'3px solid '+C.gold+'60',marginBottom:8}}>
            <div style={{marginBottom:3}}><strong style={{color:C.muted}}>Registro do Aceite:</strong> Este consentimento sera gravado com data, hora, IP e versao dos documentos, conforme exige a LGPD.</div>
            <div><strong style={{color:C.muted}}>DPO:</strong> Em caso de duvidas sobre seus dados: <a href="mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com" style={{color:C.gold}}>paravizi-salvi@gpconsultoriadeinvestimentos.com</a></div>
          </div>
        </div>

        <div style={{padding:'16px 28px 24px',borderTop:'1px solid '+C.border,display:'flex',gap:10,background:C.card2}}>
          <button onClick={async()=>{await supabase.auth.signOut();window.location.href='/'}} style={{
            flex:1,padding:'12px',borderRadius:8,fontSize:12,cursor:'pointer',border:'1px solid '+C.border,
            background:'transparent',color:C.muted,fontWeight:500
          }}>Recusar e Sair</button>
          <button onClick={aceitar} disabled={!aceiteTermos||!aceitePrivacidade||saving} style={{
            flex:2,padding:'12px',borderRadius:8,fontSize:13,fontWeight:700,
            cursor:(!aceiteTermos||!aceitePrivacidade||saving)?'not-allowed':'pointer',
            border:'none',color:C.bg,
            background:(aceiteTermos&&aceitePrivacidade&&!saving)?'linear-gradient(135deg,'+C.gold+','+C.goldL+')':C.border,
            opacity:(!aceiteTermos||!aceitePrivacidade)?0.5:1
          }}>
            {saving?'Registrando...':'Aceitar e Continuar'}
          </button>
        </div>
      </div>
    </div>
  )
}
