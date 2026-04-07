"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#918C82";

const ROLES = [
  {role:"adm",nome:"Administrador",desc:"Acesso total. Gestão de empresas, usuários e configurações.",cor:GOL,icon:"👑",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"socio",nome:"Sócio / CEO",desc:"Dashboard completo, relatórios, Fale com PS, plano de ação.",cor:GO,icon:"💼",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"financeiro",nome:"Financeiro",desc:"DRE, custos, contas a pagar/receber. Sem gestão de usuários.",cor:G,icon:"📊",tabs:["geral","resultado","financeiro","precos"]},
  {role:"comercial",nome:"Comercial",desc:"Receitas, clientes, vendas. Sem visibilidade de custos detalhados.",cor:BL,icon:"🎯",tabs:["geral","negocios","precos"]},
  {role:"operacional",nome:"Operacional",desc:"Plano de ação, alertas, dados operacionais básicos.",cor:Y,icon:"⚙️",tabs:["geral","negocios"]},
  {role:"consultor",nome:"Consultor Externo",desc:"Acesso completo em leitura. Para consultores PS Gestão.",cor:"#A855F7",icon:"🔍",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"visualizador",nome:"Visualizador",desc:"Apenas painel geral. Sem acesso a dados detalhados.",cor:TXD,icon:"👁️",tabs:["geral"]},
];
const getRN=(r:string)=>ROLES.find(x=>x.role===r)?.nome||r;
const getRC=(r:string)=>ROLES.find(x=>x.role===r)?.cor||TXD;

export default function AdminPage(){
  const [empresas,setEmpresas]=useState<any[]>([]);
  const [usuarios,setUsuarios]=useState<any[]>([]);
  const [convites,setConvites]=useState<any[]>([]);
  const [tab,setTab]=useState("empresas");
  const [showForm,setShowForm]=useState(false);
  const [showInvite,setShowInvite]=useState(false);
  const [selectedCompany,setSelectedCompany]=useState("");
  const [selectedGroup,setSelectedGroup]=useState("");
  const [inviteRole,setInviteRole]=useState("socio");
  const [inviteEmail,setInviteEmail]=useState("");
  const [generatedLink,setGeneratedLink]=useState("");
  const [copied,setCopied]=useState(false);
  const [newEmp,setNewEmp]=useState({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:"",group_id:""});
  const [msg,setMsg]=useState("");
  const [userComps,setUserComps]=useState<any[]>([]);
  const [editingUser,setEditingUser]=useState<string|null>(null);
  // Grupos
  const [grupos,setGrupos]=useState<any[]>([]);
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({});
  const [showNewGroup,setShowNewGroup]=useState(false);
  const [newGroupName,setNewGroupName]=useState("");
  const [newGroupCor,setNewGroupCor]=useState("#C6973F");
  const [movingEmpresa,setMovingEmpresa]=useState<string|null>(null);
  const groupColors=["#C6973F","#FF9800","#4CAF50","#3B82F6","#A855F7","#EF4444","#14B8A6","#FF5722","#8BC34A","#E91E63"];

  useEffect(()=>{loadData();},[]);
  const loadData=async()=>{
    const{data:emp}=await supabase.from("companies").select("*").order("created_at",{ascending:false});
    if(emp)setEmpresas(emp);
    const{data:inv}=await supabase.from("invites").select("*,companies(nome_fantasia,razao_social)").order("created_at",{ascending:false}).limit(20);
    if(inv)setConvites(inv);
    const{data:usr}=await supabase.from("users").select("*").order("created_at",{ascending:false});
    if(usr)setUsuarios(usr);
    const{data:uc}=await supabase.from("user_companies").select("*");
    if(uc)setUserComps(uc);
    const{data:grps}=await supabase.from("company_groups").select("*").order("nome");
    if(grps)setGrupos(grps);
  };

  const getUserCompIds=(uid:string)=>userComps.filter(uc=>uc.user_id===uid).map(uc=>uc.company_id);
  
  const toggleUserCompany=async(uid:string,compId:string)=>{
    const exists=userComps.find(uc=>uc.user_id===uid&&uc.company_id===compId);
    if(exists){
      await supabase.from("user_companies").delete().eq("user_id",uid).eq("company_id",compId);
      setUserComps(userComps.filter(uc=>!(uc.user_id===uid&&uc.company_id===compId)));
    }else{
      const role=usuarios.find(u=>u.id===uid)?.role||"visualizador";
      const{data}=await supabase.from("user_companies").insert({user_id:uid,company_id:compId,role}).select().single();
      if(data)setUserComps([...userComps,data]);
    }
    setMsg(exists?"Empresa removida do usuário":"Empresa vinculada ao usuário!");
  };

  const vincularTodas=async(uid:string)=>{
    const role=usuarios.find(u=>u.id===uid)?.role||"visualizador";
    const existing=getUserCompIds(uid);
    const toAdd=empresas.filter(e=>!existing.includes(e.id));
    for(const e of toAdd){
      const{data}=await supabase.from("user_companies").insert({user_id:uid,company_id:e.id,role}).select().single();
      if(data)setUserComps(prev=>[...prev,data]);
    }
    setMsg(`${toAdd.length} empresas vinculadas!`);
  };

  const vincularGrupo=async(uid:string,groupId:string)=>{
    const role=usuarios.find(u=>u.id===uid)?.role||"visualizador";
    const existing=getUserCompIds(uid);
    const groupCompanies=empresas.filter(e=>e.group_id===groupId&&!existing.includes(e.id));
    for(const e of groupCompanies){
      const{data}=await supabase.from("user_companies").insert({user_id:uid,company_id:e.id,role}).select().single();
      if(data)setUserComps(prev=>[...prev,data]);
    }
    const grupoNome=grupos.find(g=>g.id===groupId)?.nome||"Grupo";
    setMsg(`✅ ${groupCompanies.length} empresas do grupo "${grupoNome}" vinculadas!`);
    setTimeout(()=>setMsg(""),3000);
  };

  const desvincularGrupo=async(uid:string,groupId:string)=>{
    const groupCompIds=empresas.filter(e=>e.group_id===groupId).map(e=>e.id);
    for(const compId of groupCompIds){
      await supabase.from("user_companies").delete().eq("user_id",uid).eq("company_id",compId);
    }
    setUserComps(userComps.filter(uc=>!(uc.user_id===uid&&groupCompIds.includes(uc.company_id))));
    const grupoNome=grupos.find(g=>g.id===groupId)?.nome||"Grupo";
    setMsg(`Empresas do grupo "${grupoNome}" desvinculadas.`);
    setTimeout(()=>setMsg(""),3000);
  };

  const criarEmpresa=async(e:React.FormEvent)=>{
    e.preventDefault();
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    let orgId=up?.org_id;
    if(!orgId){
      const{data:org}=await supabase.from("organizations").insert({name:"PS Gestão e Capital",slug:"psgestao-"+Date.now()}).select().single();
      if(org){orgId=org.id;await supabase.from("users").upsert({id:user.id,org_id:orgId,full_name:"Administrador",email:user.email!,role:"adm"});}
    }
    const empData:any={razao_social:newEmp.razao_social,nome_fantasia:newEmp.nome_fantasia,cnpj:newEmp.cnpj,cidade_estado:newEmp.cidade_estado,org_id:orgId};
    if(newEmp.group_id)empData.group_id=newEmp.group_id;
    const{error}=await supabase.from("companies").insert(empData);
    if(error){setMsg("Erro: "+error.message);return;}
    setMsg("Empresa cadastrada!");setNewEmp({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:"",group_id:""});setShowForm(false);loadData();
  };

  const criarGrupo=async()=>{
    if(!newGroupName.trim())return;
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    const{error}=await supabase.from("company_groups").insert({nome:newGroupName.trim(),cor:newGroupCor,org_id:up?.org_id});
    if(error){setMsg("Erro: "+error.message);return;}
    setMsg("Grupo criado!");setNewGroupName("");setShowNewGroup(false);loadData();
  };

  const moverEmpresaGrupo=async(empId:string,groupId:string|null)=>{
    const{error}=await supabase.from("companies").update({group_id:groupId}).eq("id",empId);
    if(error){setMsg("Erro: "+error.message);return;}
    setMsg("Empresa movida!");setMovingEmpresa(null);loadData();
  };

  const excluirGrupo=async(gid:string)=>{
    const empsNoGrupo=empresas.filter(e=>e.group_id===gid);
    if(empsNoGrupo.length>0){setMsg("Mova todas as empresas antes de excluir o grupo.");return;}
    await supabase.from("company_groups").delete().eq("id",gid);
    setMsg("Grupo excluído!");loadData();
  };

  const toggleGroup=(gid:string)=>setExpandedGroups(prev=>({...prev,[gid]:!prev[gid]}));
  const expandAllGroups=()=>{const all:any={};grupos.forEach(g=>{all[g.id]=true;});all["sem_grupo"]=true;setExpandedGroups(all);};
  const collapseAllGroups=()=>setExpandedGroups({});

  const gerarConvite=async()=>{
    if(!selectedCompany&&!selectedGroup){setMsg("Selecione uma empresa ou grupo.");return;}
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    const code="conv_"+Math.random().toString(36).substring(2,10)+Date.now().toString(36);
    const inviteData:any={org_id:up?.org_id,email:inviteEmail||null,role:inviteRole,invite_code:code,created_by:user.id};
    if(selectedGroup){
      inviteData.group_id=selectedGroup;
      // Use first company of group as company_id for display
      const firstComp=empresas.find(e=>e.group_id===selectedGroup);
      inviteData.company_id=firstComp?.id||null;
    } else {
      inviteData.company_id=selectedCompany;
    }
    const{error}=await supabase.from("invites").insert(inviteData);
    if(error){setMsg("Erro: "+error.message);return;}
    setGeneratedLink(window.location.origin+"/convite?code="+code);setCopied(false);loadData();
  };

  const atualizarRole=async(uid:string,nr:string)=>{
    await supabase.from("users").update({role:nr}).eq("id",uid);
    setUsuarios(usuarios.map(u=>u.id===uid?{...u,role:nr}:u));setMsg("Nível atualizado!");
  };

  const inp={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
  <div style={{padding:"20px",maxWidth:1000,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:GOL}}>Painel Administrativo</div>
        <div style={{fontSize:11,color:TXD}}>Gestão de empresas, usuários e permissões</div>
      </div>
      <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        <a href="/dashboard/conectores" style={{padding:"8px 16px",border:`1px solid ${GO}`,borderRadius:8,color:GO,fontSize:11,textDecoration:"none",marginLeft:8}}>🔌 Conectores</a>
        <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${G}`,borderRadius:8,color:G,fontSize:11,textDecoration:"none",marginLeft:8}}>📊 BPO</a>
    </div>

    {msg&&<div style={{background:G+"20",border:`1px solid ${G}`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G}} onClick={()=>setMsg("")}>{msg}</div>}

    <div style={{display:"flex",gap:4,marginBottom:16}}>
      {[{id:"empresas",n:"Empresas"},{id:"usuarios",n:"Usuários & Níveis"},{id:"convites",n:"Convites"},{id:"niveis",n:"Mapa de Permissões"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 16px",borderRadius:20,fontSize:11,border:`1px solid ${tab===t.id?GO:BD}`,background:tab===t.id?GO+"18":"transparent",color:tab===t.id?GOL:TXM,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>{t.n}</button>
      ))}
    </div>

    {/* EMPRESAS COM GRUPOS */}
    {tab==="empresas"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>{empresas.length} empresas · {grupos.length} grupos</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setShowNewGroup(true)} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${GO}`,background:"transparent",color:GO,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Grupo</button>
          <button onClick={()=>setShowForm(!showForm)} style={{padding:"6px 14px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Empresa</button>
          <button onClick={expandAllGroups} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>▼ Expandir</button>
          <button onClick={collapseAllGroups} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>▲ Recolher</button>
        </div>
      </div>

      {/* New Group Form */}
      {showNewGroup&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${GO}40`}}>
          <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:10}}>Criar Novo Grupo</div>
          <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome do Grupo</div>
              <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="Ex: Grupo Tryo Gessos" style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cor</div>
              <div style={{display:"flex",gap:4}}>{groupColors.map(c=>(
                <div key={c} onClick={()=>setNewGroupCor(c)} style={{width:24,height:24,borderRadius:6,background:c,cursor:"pointer",border:newGroupCor===c?"2px solid white":"2px solid transparent"}}/>
              ))}</div></div>
            <button onClick={criarGrupo} style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Criar</button>
            <button onClick={()=>setShowNewGroup(false)} style={{padding:"8px 16px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* New Empresa Form */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${BD}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:10}}>Cadastrar Nova Empresa</div>
          <form onSubmit={criarEmpresa}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"Razão Social *",k:"razao_social",p:"Razão Social"},{l:"Nome Fantasia",k:"nome_fantasia",p:"Nome comercial"},{l:"CNPJ",k:"cnpj",p:"00.000.000/0000-00"},{l:"Cidade/UF",k:"cidade_estado",p:"Chapecó/SC"}].map(f=>(
                <div key={f.k}><div style={{fontSize:10,color:TXD,marginBottom:3}}>{f.l}</div>
                <input value={(newEmp as any)[f.k]} onChange={e=>setNewEmp({...newEmp,[f.k]:e.target.value})} placeholder={f.p} style={inp}/></div>
              ))}
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Grupo</div>
                <select value={newEmp.group_id} onChange={e=>setNewEmp({...newEmp,group_id:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="">Sem grupo</option>
                  {grupos.map(g=><option key={g.id} value={g.id}>{g.nome}</option>)}
                </select></div>
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button type="submit" style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{padding:"8px 16px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Groups with companies */}
      {grupos.map(grupo=>{
        const empsDoGrupo=empresas.filter(e=>e.group_id===grupo.id);
        const isOpen=!!expandedGroups[grupo.id];
        return(
          <div key={grupo.id} style={{background:BG2,borderRadius:10,marginBottom:6,border:`1px solid ${BD}`,borderLeft:`4px solid ${grupo.cor||GO}`,overflow:"hidden"}}>
            <div onClick={()=>toggleGroup(grupo.id)} style={{padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:14,color:grupo.cor||GO,transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                <div>
                  <span style={{fontSize:14,fontWeight:600,color:TX}}>{grupo.nome}</span>
                  <span style={{fontSize:10,color:TXD,marginLeft:8}}>{empsDoGrupo.length} empresa{empsDoGrupo.length!==1?"s":""}</span>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,fontWeight:700,color:grupo.cor||GO,background:(grupo.cor||GO)+"20",padding:"2px 8px",borderRadius:8}}>{empsDoGrupo.length}</span>
                {empsDoGrupo.length===0&&<button onClick={(e)=>{e.stopPropagation();excluirGrupo(grupo.id);}} style={{background:"none",border:"none",color:R,fontSize:12,cursor:"pointer",padding:"2px 4px"}} title="Excluir grupo vazio">🗑</button>}
              </div>
            </div>
            {isOpen&&(
              <div style={{borderTop:`1px solid ${BD}`}}>
                {empsDoGrupo.length===0&&<div style={{padding:16,textAlign:"center",fontSize:11,color:TXD}}>Nenhuma empresa neste grupo</div>}
                {empsDoGrupo.map(emp=>(
                  <div key={emp.id} style={{padding:"8px 16px 8px 44px",borderBottom:`0.5px solid ${BD}40`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><div style={{fontSize:13,fontWeight:500,color:TX}}>{emp.nome_fantasia||emp.razao_social}</div>
                    <div style={{fontSize:10,color:TXD}}>{emp.cnpj||"Sem CNPJ"} · {emp.cidade_estado||""}</div></div>
                    <div style={{display:"flex",gap:4}}>
                      {movingEmpresa===emp.id?(
                        <select onChange={e=>{moverEmpresaGrupo(emp.id,e.target.value||null);}} style={{...inp,width:"auto",fontSize:10,padding:"4px 8px"}}>
                          <option value="">Sem grupo</option>
                          {grupos.filter(g=>g.id!==grupo.id).map(g=><option key={g.id} value={g.id}>{g.nome}</option>)}
                        </select>
                      ):(
                        <button onClick={()=>setMovingEmpresa(emp.id)} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,color:TXM,fontSize:10,cursor:"pointer",padding:"3px 8px"}} title="Mover para outro grupo">↗️ Mover</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Empresas sem grupo */}
      {(()=>{
        const semGrupo=empresas.filter(e=>!e.group_id||!grupos.find(g=>g.id===e.group_id));
        if(semGrupo.length===0)return null;
        const isOpen=!!expandedGroups["sem_grupo"];
        return(
          <div style={{background:BG2,borderRadius:10,marginBottom:6,border:`1px solid ${BD}`,borderLeft:`4px solid ${TXD}`,overflow:"hidden"}}>
            <div onClick={()=>toggleGroup("sem_grupo")} style={{padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:14,color:TXD,transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                <span style={{fontSize:14,fontWeight:600,color:TXM}}>Sem Grupo</span>
                <span style={{fontSize:10,color:TXD}}>{semGrupo.length} empresa{semGrupo.length!==1?"s":""}</span>
              </div>
              <span style={{fontSize:11,fontWeight:700,color:TXD,background:TXD+"20",padding:"2px 8px",borderRadius:8}}>{semGrupo.length}</span>
            </div>
            {isOpen&&(
              <div style={{borderTop:`1px solid ${BD}`}}>
                {semGrupo.map(emp=>(
                  <div key={emp.id} style={{padding:"8px 16px 8px 44px",borderBottom:`0.5px solid ${BD}40`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><div style={{fontSize:13,fontWeight:500,color:TX}}>{emp.nome_fantasia||emp.razao_social}</div>
                    <div style={{fontSize:10,color:TXD}}>{emp.cnpj||"Sem CNPJ"} · {emp.cidade_estado||""}</div></div>
                    <div style={{display:"flex",gap:4}}>
                      {movingEmpresa===emp.id?(
                        <select onChange={e=>{moverEmpresaGrupo(emp.id,e.target.value||null);}} style={{...inp,width:"auto",fontSize:10,padding:"4px 8px"}}>
                          <option value="">Mover para...</option>
                          {grupos.map(g=><option key={g.id} value={g.id}>{g.nome}</option>)}
                        </select>
                      ):(
                        <button onClick={()=>setMovingEmpresa(emp.id)} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,color:TXM,fontSize:10,cursor:"pointer",padding:"3px 8px"}} title="Mover para grupo">↗️ Mover</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>)}

    {/* USUÁRIOS */}
    {tab==="usuarios"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>{usuarios.length} usuários</div>
      {usuarios.map(u=>{
        const uComps=getUserCompIds(u.id);
        const isEditing=editingUser===u.id;
        return(
        <div key={u.id} style={{background:BG2,borderRadius:10,padding:"12px 16px",marginBottom:8,border:`1px solid ${BD}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:getRC(u.role)+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
                {ROLES.find(r=>r.role===u.role)?.icon||"👤"}
              </div>
              <div><div style={{fontSize:13,fontWeight:600,color:TX}}>{u.full_name||u.email||"Sem nome"}</div>
              <div style={{fontSize:10,color:TXD}}>{u.email||""}</div></div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <select value={u.role||"visualizador"} onChange={e=>atualizarRole(u.id,e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:getRC(u.role),borderRadius:6,padding:"6px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                {ROLES.map(r=><option key={r.role} value={r.role}>{r.icon} {r.nome}</option>)}
              </select>
            </div>
          </div>
          <div style={{fontSize:9,color:TXD,marginTop:6}}>{ROLES.find(r=>r.role===u.role)?.desc}</div>
          
          {/* Company assignments */}
          <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:TXD}}>Empresas:</span>
            {uComps.length===0&&<span style={{fontSize:10,color:Y,fontStyle:"italic"}}>Nenhuma empresa vinculada (vê todas por fallback)</span>}
            {uComps.map(cid=>{
              const emp=empresas.find(e=>e.id===cid);
              return emp?<span key={cid} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:G+"20",color:G,border:`1px solid ${G}30`}}>{emp.nome_fantasia||emp.razao_social}</span>:null;
            })}
            <button onClick={()=>setEditingUser(isEditing?null:u.id)} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:GO+"20",color:GO,border:`1px solid ${GO}30`,cursor:"pointer"}}>{isEditing?"Fechar":"Gerenciar"}</button>
          </div>

          {/* Expanded company toggle */}
          {isEditing&&(
            <div style={{marginTop:8,background:BG3,borderRadius:8,padding:10,borderLeft:`3px solid ${GO}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:10,fontWeight:600,color:GO}}>Selecione as empresas que este usuário pode acessar:</span>
                <button onClick={()=>vincularTodas(u.id)} style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:G+"20",color:G,border:`1px solid ${G}30`,cursor:"pointer"}}>Vincular todas</button>
              </div>

              {/* Group assignment buttons */}
              {grupos.length>0&&(
                <div style={{marginBottom:10,padding:"8px 10px",background:BG2,borderRadius:8,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXM,fontWeight:600,marginBottom:6}}>📁 VINCULAR POR GRUPO (todas as empresas do grupo de uma vez)</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {grupos.map(g=>{
                      const gComps=empresas.filter(e=>e.group_id===g.id);
                      const allLinked=gComps.every(e=>uComps.includes(e.id));
                      const someLinked=gComps.some(e=>uComps.includes(e.id));
                      return(
                        <button key={g.id} onClick={()=>allLinked?desvincularGrupo(u.id,g.id):vincularGrupo(u.id,g.id)} style={{
                          padding:"6px 14px",borderRadius:8,fontSize:10,cursor:"pointer",fontWeight:600,
                          background:allLinked?G+"15":someLinked?Y+"15":"transparent",
                          border:`1px solid ${allLinked?G:someLinked?Y:BD}40`,
                          color:allLinked?G:someLinked?Y:TXM,
                        }}>
                          {allLinked?"✅":"📁"} {g.nome} ({gComps.length})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Individual companies */}
              {empresas.map(emp=>{
                const linked=uComps.includes(emp.id);
                return(
                  <div key={emp.id} onClick={()=>toggleUserCompany(u.id,emp.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",marginBottom:2,borderRadius:6,cursor:"pointer",background:linked?G+"10":"transparent",border:`1px solid ${linked?G+"30":BD+"40"}`}}
                    onMouseEnter={e=>(e.currentTarget.style.background=linked?G+"18":BG2)} onMouseLeave={e=>(e.currentTarget.style.background=linked?G+"10":"transparent")}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:14,color:linked?G:TXD}}>{linked?"✓":"○"}</span>
                      <span style={{fontSize:11,color:linked?TX:TXM}}>{emp.nome_fantasia||emp.razao_social}</span>
                    </div>
                    <span style={{fontSize:9,color:TXD}}>{emp.cnpj||""}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>);
      })}
    </div>)}

    {/* CONVITES */}
    {tab==="convites"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Convidar usuário</div>
        <button onClick={()=>setShowInvite(!showInvite)} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Gerar Convite</button>
      </div>
      {showInvite&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${BD}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:10}}>Gerar Link de Convite</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>📁 Grupo (acesso a TODAS as empresas)</div>
            <select value={selectedGroup} onChange={e=>{setSelectedGroup(e.target.value);if(e.target.value)setSelectedCompany("");}} style={{...inp,borderColor:selectedGroup?"#34D399":""}}>
              <option value="">— Sem grupo (empresa individual) —</option>
              {grupos.map(g=>{const cnt=empresas.filter(e=>e.group_id===g.id).length;return <option key={g.id} value={g.id}>📁 {g.nome} ({cnt} empresas)</option>;})}
            </select></div>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>🏢 Ou empresa individual</div>
            <select value={selectedCompany} onChange={e=>{setSelectedCompany(e.target.value);if(e.target.value)setSelectedGroup("");}} disabled={!!selectedGroup} style={{...inp,opacity:selectedGroup?0.4:1}}>
              <option value="">Selecione</option>
              {empresas.map(emp=><option key={emp.id} value={emp.id}>{emp.nome_fantasia||emp.razao_social}</option>)}
            </select></div>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>Nível de Acesso *</div>
            <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{...inp,color:getRC(inviteRole),fontWeight:600}}>
              {ROLES.map(r=><option key={r.role} value={r.role}>{r.icon} {r.nome}</option>)}
            </select></div>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>E-mail (opcional)</div>
            <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="email@empresa.com" style={inp}/></div>
          </div>
          {selectedGroup&&(
            <div style={{background:"#34D39910",borderRadius:8,padding:10,marginBottom:12,border:"1px solid #34D39930"}}>
              <div style={{fontSize:11,fontWeight:600,color:"#34D399"}}>✅ Convite de GRUPO — o usuário terá acesso a todas as empresas do grupo:</div>
              <div style={{fontSize:10,color:TXM,marginTop:4}}>{empresas.filter(e=>e.group_id===selectedGroup).map(e=>e.nome_fantasia||e.razao_social).join(" • ")}</div>
            </div>
          )}
          <div style={{background:BG3,borderRadius:8,padding:10,marginBottom:12,borderLeft:`3px solid ${getRC(inviteRole)}`}}>
            <div style={{fontSize:11,fontWeight:600,color:getRC(inviteRole)}}>{ROLES.find(r=>r.role===inviteRole)?.icon} {getRN(inviteRole)}</div>
            <div style={{fontSize:10,color:TXM,marginTop:3}}>{ROLES.find(r=>r.role===inviteRole)?.desc}</div>
          </div>
          <button onClick={gerarConvite} style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Gerar Link</button>
          {generatedLink&&(
            <div style={{marginTop:12,background:BG3,borderRadius:8,padding:12,border:`1px solid ${G}`}}>
              <div style={{fontSize:10,fontWeight:600,color:G,marginBottom:6}}>Link gerado! Envie para o usuário:</div>
              <div style={{display:"flex",gap:8}}>
                <input value={generatedLink} readOnly style={{...inp,flex:1,fontSize:10}}/>
                <button onClick={()=>{navigator.clipboard.writeText(generatedLink);setCopied(true);setTimeout(()=>setCopied(false),3000);}} style={{padding:"8px 14px",borderRadius:6,background:copied?G:GO,color:BG,border:"none",fontSize:11,fontWeight:600,cursor:"pointer"}}>{copied?"✓ Copiado!":"Copiar"}</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{fontSize:12,fontWeight:600,color:TX,marginTop:16,marginBottom:8}}>Convites recentes</div>
      {convites.map((inv,i)=>(
        <div key={inv.id||i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,borderLeft:`3px solid ${inv.used?G:getRC(inv.role)}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{inv.companies?.nome_fantasia||inv.companies?.razao_social||"Empresa"}</div>
            <div style={{fontSize:9,color:TXD}}>{inv.email||"Sem e-mail"} | <span style={{color:getRC(inv.role),fontWeight:600}}>{getRN(inv.role)}</span> | {new Date(inv.created_at).toLocaleDateString("pt-BR")}</div></div>
            <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:inv.used?G+"20":Y+"20",color:inv.used?G:Y,fontWeight:600}}>{inv.used?"Usado":"Pendente"}</span>
          </div>
        </div>
      ))}
    </div>)}

    {/* MAPA DE PERMISSÕES */}
    {tab==="niveis"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Mapa de Permissões por Nível</div>
      <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:700}}>
          <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>Funcionalidade</th>
            {ROLES.map(r=><th key={r.role} style={{padding:8,textAlign:"center",color:r.cor,fontSize:8,lineHeight:1.3}}>{r.icon}<br/>{r.nome.split("/")[0].split(" ")[0]}</th>)}
          </tr></thead>
          <tbody>
            {[
              {f:"Painel Geral",p:[1,1,1,1,1,1,1]},
              {f:"Negócios",p:[1,1,0,1,1,1,0]},
              {f:"Resultado (DRE)",p:[1,1,1,0,0,1,0]},
              {f:"Financeiro",p:[1,1,1,0,0,1,0]},
              {f:"Preços",p:[1,1,1,1,0,1,0]},
              {f:"Relatório PS",p:[1,1,0,0,0,1,0]},
              {f:"Fale com o PS",p:[1,1,0,0,0,1,0]},
              {f:"Entrada de Dados",p:[1,1,1,0,0,0,0]},
              {f:"Plano de Ação",p:[1,1,1,0,1,1,0]},
              {f:"Ver custos detalhados",p:[1,1,1,0,0,1,0]},
              {f:"Drill-down",p:[1,1,1,1,0,1,0]},
              {f:"Admin (esta tela)",p:[1,0,0,0,0,0,0]},
              {f:"Convidar usuários",p:[1,0,0,0,0,0,0]},
            ].map((row,i)=>(
              <tr key={i} style={{borderBottom:`0.5px solid ${BD}40`}}>
                <td style={{padding:"6px 8px",color:TX,fontWeight:500}}>{row.f}</td>
                {row.p.map((p,j)=><td key={j} style={{padding:6,textAlign:"center",fontSize:14,color:p?G:R}}>{p?"✓":"✕"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:8}}>✓ Acesso permitido | ✕ Sem acesso | Configure na aba "Usuários & Níveis"</div>
    </div>)}
  </div>);
}
