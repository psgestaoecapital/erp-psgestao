"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#6B6960";

type Sugestao = {
  id:string; user_id:string; user_email:string; user_name:string;
  tipo:string; titulo:string; descricao:string; prioridade:string;
  status:string; resposta:string; created_at:string;
};

const tipoConfig:Record<string,{icon:string;cor:string;label:string}>={
  melhoria:{icon:"💡",cor:GOL,label:"Melhoria"},
  bug:{icon:"🐛",cor:R,label:"Bug / Erro"},
  novo_recurso:{icon:"🚀",cor:G,label:"Novo Recurso"},
  visual:{icon:"🎨",cor:P,label:"Visual / Design"},
  performance:{icon:"⚡",cor:Y,label:"Performance"},
  outro:{icon:"💬",cor:B,label:"Outro"},
};

const statusConfig:Record<string,{icon:string;cor:string;label:string}>={
  pendente:{icon:"⏳",cor:TXM,label:"Pendente"},
  em_analise:{icon:"🔍",cor:Y,label:"Em Análise"},
  aprovado:{icon:"✅",cor:G,label:"Aprovado"},
  implementado:{icon:"🚀",cor:GO,label:"Implementado"},
  recusado:{icon:"❌",cor:R,label:"Recusado"},
};

export default function SugestoesPage(){
  const [sugestoes,setSugestoes]=useState<Sugestao[]>([]);
  const [loading,setLoading]=useState(true);
  const [user,setUser]=useState<any>(null);
  const [userRole,setUserRole]=useState("visualizador");
  const [showForm,setShowForm]=useState(false);
  const [titulo,setTitulo]=useState("");
  const [descricao,setDescricao]=useState("");
  const [tipo,setTipo]=useState("melhoria");
  const [prioridade,setPrioridade]=useState("media");
  const [msg,setMsg]=useState("");
  const [filtro,setFiltro]=useState("todos");
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const [resposta,setResposta]=useState("");

  useEffect(()=>{loadData();},[]);

  const loadData=async()=>{
    setLoading(true);
    const{data:{user:u}}=await supabase.auth.getUser();
    if(u){
      setUser(u);
      const{data:up}=await supabase.from("users").select("role,full_name").eq("id",u.id).single();
      if(up?.role) setUserRole(up.role);
    }
    const{data}=await supabase.from("sugestoes").select("*").order("created_at",{ascending:false});
    if(data) setSugestoes(data);
    setLoading(false);
  };

  const enviar=async()=>{
    if(!titulo.trim()||!descricao.trim())return;
    const{data:{user:u}}=await supabase.auth.getUser();
    const{data:up}=await supabase.from("users").select("full_name").eq("id",u?.id).single();
    await supabase.from("sugestoes").insert({
      user_id:u?.id,user_email:u?.email||"",user_name:up?.full_name||u?.email||"",
      tipo,titulo,descricao,prioridade,status:"pendente",resposta:"",
    });
    setShowForm(false);setTitulo("");setDescricao("");setTipo("melhoria");setPrioridade("media");
    setMsg("Sugestão enviada! Obrigado pelo feedback.");loadData();
    setTimeout(()=>setMsg(""),4000);
  };

  const atualizarStatus=async(id:string,novoStatus:string)=>{
    await supabase.from("sugestoes").update({status:novoStatus}).eq("id",id);
    setMsg("Status atualizado.");loadData();setTimeout(()=>setMsg(""),2000);
  };

  const salvarResposta=async(id:string)=>{
    await supabase.from("sugestoes").update({resposta}).eq("id",id);
    setMsg("Resposta salva.");setResposta("");loadData();setTimeout(()=>setMsg(""),2000);
  };

  const excluir=async(id:string)=>{
    await supabase.from("sugestoes").delete().eq("id",id);
    setMsg("Excluído.");loadData();setTimeout(()=>setMsg(""),2000);
  };

  const isAdmin=userRole==="admin"||userRole==="socio";
  const filtered=filtro==="todos"?sugestoes:sugestoes.filter(s=>s.status===filtro);
  const counts={
    total:sugestoes.length,
    pendente:sugestoes.filter(s=>s.status==="pendente").length,
    em_analise:sugestoes.filter(s=>s.status==="em_analise").length,
    aprovado:sugestoes.filter(s=>s.status==="aprovado").length,
    implementado:sugestoes.filter(s=>s.status==="implementado").length,
  };

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:10,padding:"10px 14px",fontSize:13,outline:"none",width:"100%",fontFamily:"inherit"};

  if(loading) return <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",color:TXM}}>Carregando...</div>;

  return(
    <div style={{padding:20,maxWidth:900,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>💡 Sugestões & Melhorias</div>
          <div style={{fontSize:11,color:TXM}}>Envie ideias para melhorar o sistema. Cada sugestão é avaliada pela equipe PS.</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowForm(true)} style={{padding:"8px 18px",borderRadius:10,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",boxShadow:`0 4px 12px rgba(198,151,63,0.3)`}}>+ Nova Sugestão</button>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:G+"15",border:`1px solid ${G}30`,borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:12,color:G,cursor:"pointer"}}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))",gap:8,marginBottom:14}}>
        {[
          {label:"Total",value:counts.total,cor:TX,icon:"📋"},
          {label:"Pendentes",value:counts.pendente,cor:TXM,icon:"⏳"},
          {label:"Em Análise",value:counts.em_analise,cor:Y,icon:"🔍"},
          {label:"Aprovados",value:counts.aprovado,cor:G,icon:"✅"},
          {label:"Implementados",value:counts.implementado,cor:GO,icon:"🚀"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:12,padding:"12px",border:`1px solid ${BD}`,textAlign:"center"}}>
            <div style={{fontSize:18,marginBottom:2}}>{k.icon}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.cor}}>{k.value}</div>
            <div style={{fontSize:9,color:TXM,marginTop:2}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>
        {[["todos","Todos"],["pendente","Pendentes"],["em_analise","Em Análise"],["aprovado","Aprovados"],["implementado","Implementados"],["recusado","Recusados"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFiltro(k)} style={{
            padding:"6px 14px",borderRadius:8,fontSize:11,cursor:"pointer",fontWeight:filtro===k?600:400,
            border:filtro===k?`1px solid ${GO}50`:`1px solid ${BD}`,
            background:filtro===k?`${GO}10`:"transparent",color:filtro===k?GOL:TXM,
          }}>{l}</button>
        ))}
      </div>

      {/* Form */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:16,padding:20,border:`1px solid ${GO}30`,marginBottom:14}}>
          <div style={{fontSize:16,fontWeight:600,color:GOL,marginBottom:14}}>Nova Sugestão</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div>
              <div style={{fontSize:10,color:TXM,marginBottom:4,fontWeight:600}}>Tipo</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {Object.entries(tipoConfig).map(([k,v])=>(
                  <button key={k} onClick={()=>setTipo(k)} style={{
                    padding:"6px 12px",borderRadius:8,fontSize:10,cursor:"pointer",
                    border:tipo===k?`1px solid ${v.cor}50`:`1px solid ${BD}`,
                    background:tipo===k?`${v.cor}15`:"transparent",color:tipo===k?v.cor:TXM,fontWeight:tipo===k?600:400,
                  }}>{v.icon} {v.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,color:TXM,marginBottom:4,fontWeight:600}}>Prioridade</div>
              <div style={{display:"flex",gap:4}}>
                {[["baixa","Baixa",G],["media","Média",Y],["alta","Alta",R]].map(([k,l,c])=>(
                  <button key={k} onClick={()=>setPrioridade(k)} style={{
                    padding:"6px 14px",borderRadius:8,fontSize:10,cursor:"pointer",flex:1,
                    border:prioridade===k?`1px solid ${c}50`:`1px solid ${BD}`,
                    background:prioridade===k?`${c}15`:"transparent",color:prioridade===k?c:TXM,fontWeight:prioridade===k?600:400,
                  }}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:TXM,marginBottom:4,fontWeight:600}}>Título *</div>
            <input value={titulo} onChange={e=>setTitulo(e.target.value)} placeholder="Ex: Adicionar gráfico de evolução mensal no dashboard" style={inp}/>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,color:TXM,marginBottom:4,fontWeight:600}}>Descrição Detalhada *</div>
            <textarea value={descricao} onChange={e=>setDescricao(e.target.value)} rows={4} placeholder="Descreva em detalhes o que gostaria de ver no sistema, como deveria funcionar, e por que seria útil..." style={{...inp,resize:"vertical",lineHeight:1.6}}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={enviar} disabled={!titulo.trim()||!descricao.trim()} style={{
              padding:"10px 24px",borderRadius:10,border:"none",
              background:titulo.trim()&&descricao.trim()?`linear-gradient(135deg,${GO},${GOL})`:"#333",
              color:titulo.trim()&&descricao.trim()?BG:TXD,fontSize:13,fontWeight:700,cursor:titulo.trim()&&descricao.trim()?"pointer":"default",
            }}>Enviar Sugestão</button>
            <button onClick={()=>setShowForm(false)} style={{padding:"10px 20px",borderRadius:10,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length===0?(
        <div style={{background:BG2,borderRadius:14,padding:32,border:`1px solid ${BD}`,textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:8}}>💡</div>
          <div style={{fontSize:14,color:TX,fontWeight:500}}>Nenhuma sugestão ainda</div>
          <div style={{fontSize:11,color:TXM,marginTop:4}}>Clique em "+ Nova Sugestão" para enviar a primeira ideia!</div>
        </div>
      ):(
        filtered.map(s=>{
          const tp=tipoConfig[s.tipo]||tipoConfig.outro;
          const st=statusConfig[s.status]||statusConfig.pendente;
          const isOpen=expandedId===s.id;
          return(
            <div key={s.id} style={{background:BG2,borderRadius:14,marginBottom:8,border:`1px solid ${BD}`,borderLeft:`4px solid ${tp.cor}`,overflow:"hidden"}}>
              <div onClick={()=>setExpandedId(isOpen?null:s.id)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                  <div style={{width:36,height:36,borderRadius:10,background:`${tp.cor}15`,border:`1px solid ${tp.cor}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{tp.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:TX}}>{s.titulo}</div>
                    <div style={{fontSize:10,color:TXM,marginTop:2}}>
                      {s.user_name||s.user_email} · {new Date(s.created_at).toLocaleDateString("pt-BR")} · <span style={{color:tp.cor}}>{tp.label}</span>
                    </div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:10,padding:"3px 10px",borderRadius:8,background:`${st.cor}15`,color:st.cor,fontWeight:600,border:`1px solid ${st.cor}30`}}>{st.icon} {st.label}</span>
                  <span style={{fontSize:12,color:TXD,transition:"transform 0.2s",transform:isOpen?"rotate(180deg)":""}}>▾</span>
                </div>
              </div>

              {isOpen&&(
                <div style={{borderTop:`1px solid ${BD}`,padding:"14px 16px"}}>
                  <div style={{fontSize:13,color:TX,lineHeight:1.7,marginBottom:12,whiteSpace:"pre-wrap"}}>{s.descricao}</div>

                  {s.resposta&&(
                    <div style={{padding:"10px 14px",borderRadius:10,background:`${GO}08`,border:`1px solid ${GO}25`,marginBottom:12}}>
                      <div style={{fontSize:10,fontWeight:700,color:GOL,marginBottom:4}}>💬 Resposta da Equipe PS</div>
                      <div style={{fontSize:12,color:TX,lineHeight:1.6}}>{s.resposta}</div>
                    </div>
                  )}

                  {/* Admin controls */}
                  {isAdmin&&(
                    <div style={{borderTop:`1px solid ${BD}`,paddingTop:12}}>
                      <div style={{fontSize:10,color:TXM,marginBottom:6,fontWeight:600}}>Ações do Admin</div>
                      <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
                        {Object.entries(statusConfig).map(([k,v])=>(
                          <button key={k} onClick={()=>atualizarStatus(s.id,k)} style={{
                            padding:"4px 10px",borderRadius:6,fontSize:10,cursor:"pointer",
                            border:s.status===k?`1px solid ${v.cor}`:`1px solid ${BD}`,
                            background:s.status===k?`${v.cor}15`:"transparent",color:s.status===k?v.cor:TXM,
                          }}>{v.icon} {v.label}</button>
                        ))}
                        <button onClick={()=>excluir(s.id)} style={{padding:"4px 10px",borderRadius:6,fontSize:10,border:`1px solid ${R}30`,background:"transparent",color:R,cursor:"pointer",marginLeft:"auto"}}>🗑 Excluir</button>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <input value={resposta} onChange={e=>setResposta(e.target.value)} placeholder="Escreva uma resposta para o usuário..." style={{...inp,fontSize:11}}/>
                        <button onClick={()=>salvarResposta(s.id)} style={{padding:"8px 14px",borderRadius:8,background:GO,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",whiteSpace:"nowrap"}}>Responder</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
