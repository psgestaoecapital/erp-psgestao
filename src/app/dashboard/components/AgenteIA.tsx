"use client";
import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

type Msg = { role:"user"|"assistant"; content:string; time:string; };

export default function AgenteIA(){
  const [open,setOpen]=useState(false);
  const [msgs,setMsgs]=useState<Msg[]>([{role:"assistant",content:"Olá! Sou o **PS**, seu Consultor Digital. Posso ajudar com dúvidas sobre dados, funcionalidades do sistema, indicadores, fluxo de caixa, relatórios e muito mais.\n\nPergunta o que precisar!",time:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [companyIds,setCompanyIds]=useState<string[]>([]);
  const chatRef=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const loadCompanies=async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user)return;
      const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
      if(up?.role==="adm"||up?.role==="acesso_total"){
        const{data}=await supabase.from("companies").select("id");
        if(data)setCompanyIds(data.map(c=>c.id));
      } else {
        const{data:uc}=await supabase.from("user_companies").select("company_id").eq("user_id",user.id);
        if(uc)setCompanyIds(uc.map(c=>c.company_id));
      }
    };
    loadCompanies();
  },[]);

  useEffect(()=>{
    if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;
  },[msgs]);

  useEffect(()=>{
    if(open&&inputRef.current)inputRef.current.focus();
  },[open]);

  const enviar=async()=>{
    if(!input.trim()||loading)return;
    const pergunta=input.trim();
    setInput("");
    const now=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    setMsgs(prev=>[...prev,{role:"user",content:pergunta,time:now}]);
    setLoading(true);

    try{
      const hist=msgs.slice(-6).map(m=>({role:m.role,content:m.content}));
      const res=await fetch("/api/agente",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({pergunta,company_ids:companyIds,historico:hist})
      });
      const d=await res.json();
      const respTime=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
      if(d.success){
        setMsgs(prev=>[...prev,{role:"assistant",content:d.resposta,time:respTime}]);
      } else {
        setMsgs(prev=>[...prev,{role:"assistant",content:`Erro: ${d.error||"Não consegui processar."}`,time:respTime}]);
      }
    }catch(e:any){
      setMsgs(prev=>[...prev,{role:"assistant",content:`Erro de conexão: ${e.message}`,time:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}]);
    }
    setLoading(false);
  };

  const formatMsg=(text:string)=>{
    return text
      .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#E8C872">$1</strong>')
      .replace(/^• /gm,'<span style="color:#C6973F;margin-right:4px">▸</span> ')
      .replace(/^- /gm,'<span style="color:#C6973F;margin-right:4px">▸</span> ')
      .replace(/\n/g,'<br/>');
  };

  const sugestoes=["Qual o resultado do período?","Quanto temos de inadimplência?","Qual o ponto de equilíbrio?","Como gerar o relatório V19?","Quais os maiores custos?","Como funciona o fluxo de caixa?"];

  return(
    <>
      {/* Floating button */}
      <button onClick={()=>setOpen(!open)} style={{
        position:"fixed",bottom:20,right:20,zIndex:9999,
        width:open?48:60,height:open?48:60,borderRadius:open?14:16,border:"none",cursor:"pointer",
        background:`linear-gradient(135deg,${GO},${GOL})`,
        boxShadow:`0 4px 24px rgba(198,151,63,0.5), 0 0 0 3px rgba(198,151,63,0.15)`,
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,
        transition:"all 0.3s",transform:open?"rotate(45deg)":"",
      }}>
        {open?(
          <span style={{fontSize:22,color:BG,fontWeight:700,lineHeight:1}}>+</span>
        ):(
          <>
            <span style={{fontSize:18,fontWeight:900,color:BG,fontFamily:"Arial",lineHeight:1,letterSpacing:-0.5}}>PS</span>
            <span style={{fontSize:7,color:BG,fontWeight:600,opacity:0.8,letterSpacing:0.5}}>AJUDA</span>
          </>
        )}
      </button>

      {/* Chat panel */}
      {open&&(
        <div style={{
          position:"fixed",bottom:85,right:20,zIndex:9998,
          width:380,maxWidth:"calc(100vw - 40px)",height:520,maxHeight:"calc(100vh - 120px)",
          background:BG,borderRadius:20,overflow:"hidden",
          border:`1px solid ${GO}40`,
          boxShadow:`0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(198,151,63,0.1)`,
          display:"flex",flexDirection:"column",
        }}>
          {/* Header */}
          <div style={{
            padding:"14px 16px",
            background:`linear-gradient(135deg, #1a1510, ${BG2})`,
            borderBottom:`1px solid ${BD}`,
            display:"flex",alignItems:"center",gap:10,flexShrink:0,
          }}>
            <div style={{
              width:36,height:36,borderRadius:10,
              background:`linear-gradient(135deg,${GO},${GOL})`,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:14,fontWeight:800,color:BG,
              boxShadow:`0 2px 8px rgba(198,151,63,0.3)`,
            }}>PS</div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:TX}}>Consultor Digital</div>
              <div style={{fontSize:10,color:G,display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:6,height:6,borderRadius:3,background:G,display:"inline-block"}}/>Online — pronto para ajudar
              </div>
            </div>
            <button onClick={()=>setMsgs([msgs[0]])} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXD,fontSize:9,cursor:"pointer"}}>Limpar</button>
          </div>

          {/* Messages */}
          <div ref={chatRef} style={{
            flex:1,overflowY:"auto",padding:"12px 14px",
            display:"flex",flexDirection:"column",gap:10,
          }}>
            {msgs.map((m,i)=>(
              <div key={i} style={{
                display:"flex",flexDirection:"column",
                alignItems:m.role==="user"?"flex-end":"flex-start",
              }}>
                <div style={{
                  maxWidth:"85%",padding:"10px 14px",borderRadius:14,
                  background:m.role==="user"?`${GO}15`:BG2,
                  border:`1px solid ${m.role==="user"?GO+"30":BD}`,
                  borderBottomRightRadius:m.role==="user"?4:14,
                  borderBottomLeftRadius:m.role==="assistant"?4:14,
                }}>
                  <div style={{fontSize:12,color:TX,lineHeight:1.7}} dangerouslySetInnerHTML={{__html:formatMsg(m.content)}}/>
                  <div style={{fontSize:8,color:TXD,marginTop:4,textAlign:m.role==="user"?"right":"left"}}>{m.time}</div>
                </div>
              </div>
            ))}
            {loading&&(
              <div style={{display:"flex",alignItems:"flex-start"}}>
                <div style={{padding:"10px 14px",borderRadius:14,borderBottomLeftRadius:4,background:BG2,border:`1px solid ${BD}`}}>
                  <div style={{display:"flex",gap:4}}>
                    {[0,1,2].map(i=>(
                      <div key={i} style={{width:6,height:6,borderRadius:3,background:GO,animation:`pulse 1.4s ease-in-out ${i*0.2}s infinite`}}/>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick suggestions (only if few messages) */}
          {msgs.length<=2&&(
            <div style={{padding:"4px 14px 8px",display:"flex",gap:4,flexWrap:"wrap",flexShrink:0}}>
              {sugestoes.slice(0,4).map((s,i)=>(
                <button key={i} onClick={()=>{setInput(s);}} style={{
                  padding:"4px 10px",borderRadius:8,fontSize:9,
                  border:`1px solid ${BD}`,background:BG3,color:TXM,
                  cursor:"pointer",whiteSpace:"nowrap",
                }}>{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding:"10px 14px",borderTop:`1px solid ${BD}`,
            display:"flex",gap:8,alignItems:"center",flexShrink:0,
            background:BG2,
          }}>
            <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey)enviar();}}
              placeholder="Pergunte sobre dados, indicadores, sistema..."
              style={{
                flex:1,background:BG3,border:`1px solid ${BD}`,color:TX,
                borderRadius:10,padding:"10px 14px",fontSize:12,outline:"none",
                fontFamily:"inherit",
              }}
            />
            <button onClick={enviar} disabled={loading||!input.trim()} style={{
              width:38,height:38,borderRadius:10,border:"none",cursor:loading?"wait":"pointer",
              background:input.trim()?`linear-gradient(135deg,${GO},${GOL})`:BD,
              display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
            }}>
              <span style={{fontSize:16,color:input.trim()?BG:TXD}}>↑</span>
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
    </>
  );
}
