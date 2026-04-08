"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const STAGING_URL="https://erp-psgestao-git-staging-psgestaoecapitals-projects.vercel.app";
const PROD_URL="https://erp-psgestao.vercel.app";

type ChatMsg={role:"user"|"assistant";content:string;time:string;};

export default function DevCentralPage(){
  const [isAdmin,setIsAdmin]=useState(false);
  const [checking,setChecking]=useState(true);
  const [tab,setTab]=useState<"ambientes"|"chat"|"seguranca"|"changelog">("ambientes");
  // Chat
  const [msgs,setMsgs]=useState<ChatMsg[]>([]);
  const [input,setInput]=useState("");
  const [chatLoading,setChatLoading]=useState(false);
  const [chatHistory,setChatHistory]=useState<any[]>([]);
  const chatRef=useRef<HTMLDivElement>(null);
  // Security
  const [secResults,setSecResults]=useState<any[]>([]);
  const [secLoading,setSecLoading]=useState(false);

  useEffect(()=>{checkAuth();},[]);
  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},[msgs]);

  const checkAuth=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setChecking(false);return;}
    const{data}=await supabase.from("users").select("role").eq("id",user.id).single();
    if(data?.role==="adm"){setIsAdmin(true);loadChatHistory();}
    setChecking(false);
  };

  const loadChatHistory=async()=>{
    const{data}=await supabase.from("dev_chat").select("*").order("created_at",{ascending:false}).limit(20);
    if(data)setChatHistory(data);
  };

  const enviarChat=async()=>{
    if(!input.trim()||chatLoading)return;
    const pergunta=input.trim();
    setInput("");
    const now=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    setMsgs(prev=>[...prev,{role:"user",content:pergunta,time:now}]);
    setChatLoading(true);

    try{
      const systemContext=`Você é o Engenheiro de Sistemas do ERP PS Gestão e Capital.
Seu papel é ajudar o administrador a desenvolver, manter e melhorar o sistema.

STACK DO SISTEMA:
- Frontend: Next.js 16 + React 19 + TypeScript
- Backend: Supabase (PostgreSQL) + Vercel Serverless
- IA: Claude API (Anthropic)
- Deploy: Vercel (branch main=produção, staging=homologação)
- Repositório: github.com/psgestaoecapital/erp-psgestao

MÓDULOS EXISTENTES:
- Dashboard com 8 abas (Painel, Negócios, Resultado, Balanço, Indicadores, Financeiro, Preços, Relatório)
- BPO (Supervisor, Automação IA, Conciliação Cartão)
- Ficha Técnica (50 fichas, 35 materiais base)
- Orçamento (real vs orçado)
- Admin (empresas, usuários, convites, níveis de acesso)
- Agente IA flutuante
- Sugestões

SEGURANÇA:
- AuthProvider centralizado (src/lib/AuthProvider.tsx)
- Admin (role=adm) vê tudo, outros vêem só user_companies
- 12 níveis de acesso
- RLS no Supabase (policies allow_all por enquanto)

AMBIENTES:
- Produção: ${PROD_URL}
- Staging: ${STAGING_URL}

Responda em português, seja técnico mas claro. Sugira melhorias proativamente.`;

      const hist=msgs.slice(-8).map(m=>({role:m.role,content:m.content}));
      const res=await fetch("/api/agente",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          pergunta:`[DEV MODE] ${pergunta}`,
          company_ids:[],
          historico:hist,
        })
      });
      const d=await res.json();
      const respTime=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
      const resposta=d.success?d.resposta:"Erro: "+(d.error||"Não consegui processar.");
      setMsgs(prev=>[...prev,{role:"assistant",content:resposta,time:respTime}]);

      // Salvar no histórico
      await supabase.from("dev_chat").insert({
        pergunta,resposta,
        created_at:new Date().toISOString(),
      });
      loadChatHistory();
    }catch(e:any){
      setMsgs(prev=>[...prev,{role:"assistant",content:`Erro: ${e.message}`,time:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}]);
    }
    setChatLoading(false);
  };

  const testarSeguranca=async()=>{
    setSecLoading(true);
    const results:any[]=[];
    
    // 1. Verificar usuários e seus acessos
    const{data:users}=await supabase.from("users").select("id,email,full_name,role");
    const{data:uc}=await supabase.from("user_companies").select("user_id,company_id");
    const{data:companies}=await supabase.from("companies").select("id,nome_fantasia");
    
    for(const u of (users||[])){
      const userComps=(uc||[]).filter(c=>c.user_id===u.id);
      const compNames=userComps.map(c=>(companies||[]).find(co=>co.id===c.company_id)?.nome_fantasia||"?");
      
      if(u.role==="adm"){
        results.push({user:u.email||u.full_name,role:u.role,status:"ok",detail:`Admin — acesso total (${(companies||[]).length} empresas)`,cor:G});
      } else if(userComps.length===0){
        results.push({user:u.email||u.full_name,role:u.role,status:"alerta",detail:`SEM empresas vinculadas! Não verá nenhum dado.`,cor:Y});
      } else {
        results.push({user:u.email||u.full_name,role:u.role,status:"ok",detail:`${userComps.length} empresas: ${compNames.join(", ")}`,cor:G});
      }
    }

    // 2. Verificar empresas sem dados
    const{data:imports}=await supabase.from("omie_imports").select("company_id");
    const compIdsWithData=new Set((imports||[]).map(i=>i.company_id));
    for(const c of (companies||[])){
      if(!compIdsWithData.has(c.id)){
        results.push({user:`Empresa: ${c.nome_fantasia}`,role:"—",status:"info",detail:"Sem dados importados do Omie",cor:B});
      }
    }

    setSecResults(results);
    setSecLoading(false);
  };

  const formatMsg=(text:string)=>{
    return text
      .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#E8C872">$1</strong>')
      .replace(/^• /gm,'<span style="color:#C6973F;margin-right:4px">▸</span> ')
      .replace(/^- /gm,'<span style="color:#C6973F;margin-right:4px">▸</span> ')
      .replace(/\n/g,'<br/>');
  };

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"10px 14px",fontSize:12,outline:"none",width:"100%",fontFamily:"inherit"};

  if(checking)return<div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:TXM}}>Verificando permissão...</div></div>;
  if(!isAdmin)return<div style={{minHeight:"100vh",background:BG,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}><div style={{fontSize:48}}>🔒</div><div style={{fontSize:18,fontWeight:700,color:R}}>Acesso Restrito</div><div style={{fontSize:12,color:TXM}}>Apenas administradores podem acessar a Central de Desenvolvimento.</div><a href="/dashboard" style={{padding:"10px 24px",borderRadius:8,background:GOL,color:BG,fontSize:12,fontWeight:600,textDecoration:"none"}}>← Dashboard</a></div>;

  return(
    <div style={{padding:20,maxWidth:1200,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:GOL}}>🛠️ Central de Desenvolvimento</div>
          <div style={{fontSize:11,color:TXM}}>Ambiente seguro para desenvolvimento, testes e deploy — PS Gestão e Capital</div>
        </div>
        <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:16}}>
        {([["ambientes","🌐 Ambientes"],["chat","💬 Chat Dev"],["seguranca","🔒 Segurança"],["changelog","📋 Changelog"]] as const).map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{
            padding:"8px 18px",borderRadius:10,fontSize:12,cursor:"pointer",fontWeight:tab===k?600:400,
            border:tab===k?`1px solid ${GO}50`:`1px solid ${BD}`,
            background:tab===k?GO+"12":"transparent",color:tab===k?GOL:TXM,
          }}>{l}</button>
        ))}
      </div>

      {/* AMBIENTES */}
      {tab==="ambientes"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {/* Staging */}
            <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${Y}30`,borderLeft:`4px solid ${Y}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:Y+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🟡</div>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:Y}}>STAGING (Homologação)</div>
                  <div style={{fontSize:10,color:TXM}}>Teste aqui ANTES de ir para produção</div>
                </div>
              </div>
              <div style={{background:BG3,borderRadius:8,padding:10,marginBottom:12,fontSize:11,color:TXM,wordBreak:"break-all"}}>{STAGING_URL}</div>
              <a href={STAGING_URL} target="_blank" style={{display:"inline-block",padding:"8px 20px",borderRadius:8,background:Y+"20",border:`1px solid ${Y}40`,color:Y,fontSize:12,fontWeight:600,textDecoration:"none"}}>🔗 Abrir Staging</a>
              <div style={{fontSize:10,color:TXD,marginTop:10}}>
                <div>▸ Todas as mudanças vão aqui primeiro</div>
                <div>▸ Testar funcionalidades novas</div>
                <div>▸ Verificar segurança de acessos</div>
                <div>▸ Não afeta clientes em produção</div>
              </div>
            </div>

            {/* Produção */}
            <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${G}30`,borderLeft:`4px solid ${G}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:G+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🟢</div>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:G}}>PRODUÇÃO</div>
                  <div style={{fontSize:10,color:TXM}}>Ambiente do cliente — só código aprovado</div>
                </div>
              </div>
              <div style={{background:BG3,borderRadius:8,padding:10,marginBottom:12,fontSize:11,color:TXM,wordBreak:"break-all"}}>{PROD_URL}</div>
              <a href={PROD_URL} target="_blank" style={{display:"inline-block",padding:"8px 20px",borderRadius:8,background:G+"20",border:`1px solid ${G}40`,color:G,fontSize:12,fontWeight:600,textDecoration:"none"}}>🔗 Abrir Produção</a>
              <div style={{fontSize:10,color:TXD,marginTop:10}}>
                <div>▸ Clientes acessam aqui</div>
                <div>▸ Só recebe código testado em staging</div>
                <div>▸ Rollback: Vercel → deploy anterior → Promote</div>
              </div>
            </div>
          </div>

          {/* Fluxo de Deploy */}
          <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${BD}`,marginTop:14}}>
            <div style={{fontSize:14,fontWeight:600,color:GOL,marginBottom:12}}>📋 Fluxo de Deploy Seguro</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {[
                {icon:"💻",label:"Desenvolvimento",desc:"Claude faz as mudanças",cor:B},
                {icon:"→",label:"",desc:"",cor:TXD},
                {icon:"🟡",label:"Staging",desc:"Push → branch staging",cor:Y},
                {icon:"→",label:"",desc:"",cor:TXD},
                {icon:"✅",label:"Homologação",desc:"Admin testa e aprova",cor:GOL},
                {icon:"→",label:"",desc:"",cor:TXD},
                {icon:"🟢",label:"Produção",desc:"Merge → branch main",cor:G},
              ].map((s,i)=>s.label?(
                <div key={i} style={{background:BG3,borderRadius:10,padding:"10px 16px",textAlign:"center",border:`1px solid ${s.cor}30`}}>
                  <div style={{fontSize:18}}>{s.icon}</div>
                  <div style={{fontSize:11,fontWeight:600,color:s.cor}}>{s.label}</div>
                  <div style={{fontSize:9,color:TXD}}>{s.desc}</div>
                </div>
              ):(
                <div key={i} style={{fontSize:18,color:TXD}}>→</div>
              ))}
            </div>
          </div>

          {/* Rollback */}
          <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${R}20`,marginTop:14}}>
            <div style={{fontSize:14,fontWeight:600,color:R,marginBottom:8}}>🚨 Procedimento de Rollback (emergência)</div>
            <div style={{fontSize:12,color:TX,lineHeight:1.8}}>
              <div>1. Acesse <strong style={{color:GOL}}>Vercel → Deployments</strong></div>
              <div>2. Encontre o <strong style={{color:GOL}}>último deploy que funcionava</strong> (antes do problema)</div>
              <div>3. Clique nos <strong style={{color:GOL}}>3 pontinhos (⋯) → Promote to Production</strong></div>
              <div>4. Em <strong style={{color:G}}>30 segundos</strong> a produção volta ao normal</div>
            </div>
          </div>
        </div>
      )}

      {/* CHAT DEV */}
      {tab==="chat"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:14}}>
          {/* Chat area */}
          <div style={{background:BG2,borderRadius:14,border:`1px solid ${BD}`,display:"flex",flexDirection:"column",height:600}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${BD}`,display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:BG}}>PS</div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:TX}}>Engenheiro de Sistemas</div>
                <div style={{fontSize:9,color:G}}>● Online — modo desenvolvimento</div>
              </div>
            </div>

            <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
              {msgs.length===0&&(
                <div style={{textAlign:"center",padding:40,color:TXD}}>
                  <div style={{fontSize:28,marginBottom:8}}>🛠️</div>
                  <div style={{fontSize:13,color:TX,fontWeight:500}}>Chat de Desenvolvimento</div>
                  <div style={{fontSize:11,marginTop:4}}>Converse sobre mudanças, bugs, melhorias e novos módulos.</div>
                  <div style={{fontSize:11,marginTop:2}}>Todo o histórico fica salvo automaticamente.</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center",marginTop:12}}>
                    {["Quais módulos temos?","Como está a segurança?","Próximos passos do roadmap","Preciso de um novo relatório"].map((s,i)=>(
                      <button key={i} onClick={()=>setInput(s)} style={{padding:"4px 10px",borderRadius:6,fontSize:9,border:`1px solid ${BD}`,background:BG3,color:TXM,cursor:"pointer"}}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                  <div style={{maxWidth:"85%",padding:"10px 14px",borderRadius:14,background:m.role==="user"?GO+"15":BG3,border:`1px solid ${m.role==="user"?GO+"30":BD}`,borderBottomRightRadius:m.role==="user"?4:14,borderBottomLeftRadius:m.role==="assistant"?4:14}}>
                    <div style={{fontSize:12,color:TX,lineHeight:1.7}} dangerouslySetInnerHTML={{__html:formatMsg(m.content)}}/>
                    <div style={{fontSize:8,color:TXD,marginTop:4,textAlign:m.role==="user"?"right":"left"}}>{m.time}</div>
                  </div>
                </div>
              ))}
              {chatLoading&&<div style={{padding:"10px 14px",borderRadius:14,borderBottomLeftRadius:4,background:BG3,border:`1px solid ${BD}`,alignSelf:"flex-start"}}><div style={{display:"flex",gap:4}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:3,background:GO,animation:`pulse 1.4s ease-in-out ${i*0.2}s infinite`}}/>)}</div></div>}
            </div>

            <div style={{padding:"10px 14px",borderTop:`1px solid ${BD}`,display:"flex",gap:8,background:BG3}}>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey)enviarChat();}} placeholder="Descreva a mudança, bug ou melhoria..." style={{...inp,background:BG2}}/>
              <button onClick={enviarChat} disabled={chatLoading||!input.trim()} style={{width:38,height:38,borderRadius:10,border:"none",cursor:chatLoading?"wait":"pointer",background:input.trim()?`linear-gradient(135deg,${GO},${GOL})`:BD,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:16,color:input.trim()?BG:TXD}}>↑</span>
              </button>
            </div>
          </div>

          {/* History sidebar */}
          <div style={{background:BG2,borderRadius:14,border:`1px solid ${BD}`,padding:14,height:600,overflowY:"auto"}}>
            <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>📋 Histórico Salvo</div>
            {chatHistory.length===0&&<div style={{fontSize:10,color:TXD}}>Nenhuma conversa ainda.</div>}
            {chatHistory.map((h,i)=>(
              <div key={i} style={{padding:"8px 10px",borderRadius:8,marginBottom:6,background:BG3,border:`1px solid ${BD}`,cursor:"pointer"}}
                onClick={()=>{setMsgs([{role:"user",content:h.pergunta,time:new Date(h.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})},{role:"assistant",content:h.resposta,time:new Date(h.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}]);}}>
                <div style={{fontSize:10,color:TX,fontWeight:500}}>{h.pergunta?.substring(0,60)}...</div>
                <div style={{fontSize:8,color:TXD,marginTop:2}}>{new Date(h.created_at).toLocaleDateString("pt-BR")} {new Date(h.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SEGURANÇA */}
      {tab==="seguranca"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:14,fontWeight:600,color:TX}}>Auditoria de Segurança — Quem vê o quê?</div>
            <button onClick={testarSeguranca} disabled={secLoading} style={{padding:"8px 18px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>{secLoading?"Verificando...":"🔍 Verificar Acessos"}</button>
          </div>

          {secResults.length>0&&(
            <div style={{background:BG2,borderRadius:14,border:`1px solid ${BD}`,overflow:"hidden"}}>
              <table style={{width:"100%",fontSize:11}}>
                <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                  <th style={{padding:10,textAlign:"left",color:GO,fontSize:10}}>USUÁRIO</th>
                  <th style={{padding:10,textAlign:"left",color:GO,fontSize:10}}>NÍVEL</th>
                  <th style={{padding:10,textAlign:"center",color:GO,fontSize:10}}>STATUS</th>
                  <th style={{padding:10,textAlign:"left",color:GO,fontSize:10}}>EMPRESAS COM ACESSO</th>
                </tr></thead>
                <tbody>
                  {secResults.map((r,i)=>(
                    <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`}}>
                      <td style={{padding:10,color:TX,fontWeight:500}}>{r.user}</td>
                      <td style={{padding:10,color:TXM}}>{r.role}</td>
                      <td style={{padding:10,textAlign:"center"}}><span style={{padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:600,background:`${r.cor}15`,color:r.cor,border:`1px solid ${r.cor}30`}}>{r.status==="ok"?"✅ Seguro":r.status==="alerta"?"⚠️ Atenção":"ℹ️ Info"}</span></td>
                      <td style={{padding:10,fontSize:10,color:TXM}}>{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {secResults.length===0&&!secLoading&&(
            <div style={{background:BG2,borderRadius:14,padding:40,border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:8}}>🔒</div>
              <div style={{fontSize:14,color:TX}}>Clique "Verificar Acessos" para auditar</div>
              <div style={{fontSize:11,color:TXM,marginTop:4}}>Verifica cada usuário e quais empresas pode ver.</div>
            </div>
          )}
        </div>
      )}

      {/* CHANGELOG */}
      {tab==="changelog"&&(
        <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${BD}`}}>
          <div style={{fontSize:14,fontWeight:600,color:GOL,marginBottom:12}}>📋 Changelog — Histórico de Mudanças</div>
          <div style={{fontSize:11,color:TXM,marginBottom:16}}>Registro das principais entregas e mudanças no sistema.</div>
          {[
            {data:"08/04/2026",ver:"v7.3",items:["🔒 AuthProvider centralizado","🔒 Admin oculto para não-admin","🔒 Segurança em todas as páginas","🛠️ Central de Desenvolvimento","🟡 Ambiente Staging criado","📧 Notificação por e-mail em Sugestões","🗑️ Excluir convites","📁 Convite por grupo","🚫 Remover todos os acessos"]},
            {data:"07/04/2026",ver:"v7.2",items:["💳 Conciliação de Cartão (OFX/CSV)","🤖 Agente IA flutuante","🔧 Ficha Técnica (50 fichas, 35 materiais)","📊 Orçamento (real vs orçado)","🤖 BPO Automação IA","📋 12 níveis de acesso","🔒 RLS no Supabase (16 tabelas)","📐 Viabilidade","📚 Tutorial"]},
            {data:"06/04/2026",ver:"v7.1",items:["📊 Dashboard com 8 abas","📊 DRE com mapa de custos","📊 Indicadores Fundamentalistas","📊 Fluxo de Caixa Diário","📊 Relatório V19 CEO Edition","📊 Filtro de período flexível","🔗 Integração Omie API"]},
          ].map((v,i)=>(
            <div key={i} style={{marginBottom:16,paddingLeft:16,borderLeft:`3px solid ${i===0?G:i===1?GOL:TXD}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:13,fontWeight:700,color:i===0?G:i===1?GOL:TX}}>{v.ver}</span>
                <span style={{fontSize:10,color:TXD}}>{v.data}</span>
                {i===0&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:G+"20",color:G,fontWeight:600}}>ATUAL</span>}
              </div>
              {v.items.map((item,j)=><div key={j} style={{fontSize:11,color:TXM,padding:"2px 0"}}>{item}</div>)}
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes pulse{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
    </div>
  );
}
