"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const ESP="#3D2314",GO="#C8941A",GOL="#E8C872",OW="#FAF7F2",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  BD="#2A2822",TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",GRN="#22C55E",RED="#EF4444",Y="#FBBF24",B="#60A5FA";

type Msg = { role:"user"|"ai"; text:string; file?:string; timestamp:Date; context?:any; };

export default function ConsultorPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState("");
  const [question,setQuestion]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [loading,setLoading]=useState(false);
  const [messages,setMessages]=useState<Msg[]>([]);
  const [loadingDb,setLoadingDb]=useState(true);
  const fileRef=useRef<HTMLInputElement>(null);
  const chatRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},[messages]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setLoadingDb(false);return;}
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let data:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const r=await supabase.from("companies").select("*").order("nome_fantasia");data=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);data=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(data.length>0){setCompanies(data);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";const match=data.find(c=>c.id===saved);setSelectedComp(match?match.id:data[0].id);}
    setLoadingDb(false);
  };

  const send=async()=>{
    if(!question.trim()||!selectedComp)return;
    const userMsg:Msg={role:"user",text:question,file:file?.name,timestamp:new Date()};
    setMessages(prev=>[...prev,userMsg]);
    setLoading(true);

    try{
      const formData=new FormData();
      formData.append("question",question);
      formData.append("company_id",selectedComp);
      if(file)formData.append("file",file);

      const res=await fetch("/api/consultor",{method:"POST",body:formData});
      const data=await res.json();

      if(data.success){
        setMessages(prev=>[...prev,{role:"ai",text:data.answer,timestamp:new Date(),context:data.context_used}]);
      }else{
        setMessages(prev=>[...prev,{role:"ai",text:`❌ Erro: ${data.error}`,timestamp:new Date()}]);
      }
    }catch(e:any){
      setMessages(prev=>[...prev,{role:"ai",text:`❌ Erro: ${e.message}`,timestamp:new Date()}]);
    }

    setQuestion("");setFile(null);setLoading(false);
    if(fileRef.current)fileRef.current.value="";
  };

  const examples=[
    {icon:"🏦",q:"Tenho 3 financiamentos ativos. Vale a pena quitar algum antecipadamente?"},
    {icon:"📊",q:"Minha margem está saudável? O que posso fazer para melhorar?"},
    {icon:"💰",q:"Tenho caixa para contratar mais 2 funcionários?"},
    {icon:"📈",q:"Se eu aumentar preços em 10%, qual o impacto no resultado?"},
    {icon:"🔄",q:"Devo aceitar essa proposta de financiamento? (anexe o PDF)"},
    {icon:"📋",q:"Este orçamento de venda cobre todos meus custos? (anexe o orçamento)"},
  ];

  const Card=({children,style}:{children:React.ReactNode;style?:React.CSSProperties})=>(
    <div style={{background:BG2,borderRadius:14,border:`1px solid ${BD}`,padding:16,...style}}>{children}</div>
  );

  if(loadingDb)return <div style={{padding:40,textAlign:"center",color:TXM}}>Carregando...</div>;

  return(
    <div style={{maxWidth:1000,margin:"0 auto",display:"flex",flexDirection:"column",height:"calc(100vh - 140px)"}}>

      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:TX,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:24}}>🧠</span> Consultor IA
          </div>
          <div style={{fontSize:11,color:TXD,marginTop:2}}>Suba documentos e pergunte qualquer coisa. A IA cruza com todos os dados financeiros reais da empresa.</div>
        </div>
        <select value={selectedComp} onChange={e=>setSelectedComp(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600}}>
          {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
        </select>
      </div>

      {/* CHAT AREA */}
      <div ref={chatRef} style={{flex:1,overflowY:"auto",marginBottom:12,display:"flex",flexDirection:"column",gap:10}}>

        {messages.length===0&&(
          <>
            <Card style={{borderLeft:`4px solid ${GO}`}}>
              <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:8}}>Como funciona</div>
              <div style={{fontSize:11,color:TXM,lineHeight:1.8}}>
                O Consultor IA tem acesso a <strong style={{color:TX}}>todos os dados financeiros reais</strong> da empresa selecionada: DRE, fluxo de caixa, financiamentos, balanço patrimonial, orçamento, clientes e contexto estratégico.<br/><br/>
                Você pode <strong style={{color:TX}}>anexar documentos</strong> (propostas de financiamento, orçamentos, contratos, extratos) e a IA vai cruzar com os dados reais para dar uma análise completa.
              </div>
            </Card>

            <div style={{fontSize:11,fontWeight:600,color:TXD,marginTop:4}}>Exemplos de perguntas:</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {examples.map((ex,i)=>(
                <div key={i} onClick={()=>setQuestion(ex.q)} style={{
                  background:BG2,borderRadius:10,padding:"10px 12px",border:`1px solid ${BD}`,cursor:"pointer",
                  display:"flex",gap:8,alignItems:"flex-start",transition:"all 0.2s",
                }} onMouseEnter={e=>{e.currentTarget.style.borderColor=GO+"60";e.currentTarget.style.background=BG3;}}
                   onMouseLeave={e=>{e.currentTarget.style.borderColor=BD;e.currentTarget.style.background=BG2;}}>
                  <span style={{fontSize:18,flexShrink:0}}>{ex.icon}</span>
                  <span style={{fontSize:11,color:TXM,lineHeight:1.5}}>{ex.q}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {messages.map((msg,i)=>(
          <div key={i} style={{display:"flex",justifyContent:msg.role==="user"?"flex-end":"flex-start"}}>
            <div style={{
              maxWidth:"85%",borderRadius:14,padding:"12px 16px",
              background:msg.role==="user"?`linear-gradient(135deg,${ESP},${GO}20)`:BG2,
              border:`1px solid ${msg.role==="user"?GO+"40":BD}`,
            }}>
              {msg.role==="user"&&msg.file&&(
                <div style={{fontSize:10,color:GOL,marginBottom:6,display:"flex",alignItems:"center",gap:4}}>
                  📎 {msg.file}
                </div>
              )}
              <div style={{fontSize:12,color:msg.role==="user"?OW:TX,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{msg.text}</div>
              {msg.role==="ai"&&msg.context&&(
                <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${BD}`,display:"flex",gap:8,flexWrap:"wrap"}}>
                  {Object.entries(msg.context).filter(([k])=>k!=="arquivo").map(([k,v])=>(
                    <span key={k} style={{fontSize:9,color:TXD,background:BG3,padding:"2px 8px",borderRadius:4}}>
                      {k.replace(/_/g," ")}: <strong style={{color:TXM}}>{String(v)}</strong>
                    </span>
                  ))}
                </div>
              )}
              <div style={{fontSize:8,color:TXD,marginTop:4,textAlign:"right"}}>
                {msg.timestamp.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
              </div>
            </div>
          </div>
        ))}

        {loading&&(
          <div style={{display:"flex",justifyContent:"flex-start"}}>
            <div style={{background:BG2,borderRadius:14,padding:"16px 20px",border:`1px solid ${BD}`}}>
              <div style={{fontSize:12,color:GOL,display:"flex",alignItems:"center",gap:8}}>
                <span style={{animation:"pulse 1.5s infinite"}}>🧠</span> Analisando dados financeiros e documento...
              </div>
              <div style={{fontSize:10,color:TXD,marginTop:4}}>Cruzando DRE, fluxo de caixa, financiamentos, balanço e contexto</div>
            </div>
          </div>
        )}
      </div>

      {/* INPUT AREA */}
      <div style={{background:BG2,borderRadius:16,border:`1px solid ${BD}`,padding:12}}>
        {file&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"6px 10px",background:BG3,borderRadius:8}}>
            <span style={{fontSize:14}}>📎</span>
            <span style={{fontSize:11,color:GOL,flex:1}}>{file.name} <span style={{color:TXD}}>({(file.size/1024).toFixed(0)}KB)</span></span>
            <button onClick={()=>{setFile(null);if(fileRef.current)fileRef.current.value="";}} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:14}}>✕</button>
          </div>
        )}
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.txt" onChange={e=>{if(e.target.files?.[0])setFile(e.target.files[0]);}} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current?.click()} title="Anexar documento" style={{
            width:44,height:44,borderRadius:12,border:`1px solid ${BD}`,background:file?`${GO}20`:"transparent",
            color:file?GOL:TXM,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
          }}>📎</button>
          <textarea value={question} onChange={e=>setQuestion(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder="Pergunte qualquer coisa sobre a empresa... (Enter para enviar, Shift+Enter para nova linha)"
            style={{
              flex:1,background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:12,padding:"12px 14px",
              fontSize:13,outline:"none",resize:"none",minHeight:44,maxHeight:120,fontFamily:"inherit",lineHeight:1.5,
            }}
            rows={1}
          />
          <button onClick={send} disabled={loading||!question.trim()} style={{
            width:44,height:44,borderRadius:12,border:"none",cursor:loading||!question.trim()?"not-allowed":"pointer",
            background:loading||!question.trim()?BD:`linear-gradient(135deg,${ESP},${GO})`,
            color:OW,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
            boxShadow:loading||!question.trim()?"none":`0 4px 12px rgba(200,148,26,0.3)`,
          }}>➤</button>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
          <div style={{fontSize:9,color:TXD}}>💡 Dica: anexe PDFs de propostas, orçamentos ou contratos para análise completa</div>
          <div style={{fontSize:9,color:TXD}}>Shift+Enter = nova linha</div>
        </div>
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
