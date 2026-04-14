"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PLANO_MODULOS, PLANOS, ROLES_POR_PLANO, ROLE_NAMES, ROLE_TABS, isAdminRole, type Plano } from "@/lib/planos";

const GO="#C6973F",GOL="#E8C872",BG="#111110",BG2="#252320",BG3="#33312A",G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="#504D40",TX="#F0ECE3",TXM="#CCC7BB",TXD="#918C82";

const ROLES = [
  {role:"adm_investimentos",nome:"Admin Investimentos",desc:"Acesso IRRESTRITO a todos os modulos, planos e configuracoes. PS Gestao e Capital.",cor:"#D4AF37",icon:"🏆",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"adm",nome:"Administrador",desc:"Acesso total. Gestão de empresas, usuários e configurações.",cor:GOL,icon:"👑",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"socio",nome:"Sócio / CEO",desc:"Dashboard completo, relatórios, indicadores, plano de ação.",cor:GO,icon:"💼",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"diretor_industrial",nome:"Diretor Industrial",desc:"Gestão industrial, produção, custos e indicadores operacionais.",cor:"#F59E0B",icon:"🏭",tabs:["geral","negocios","resultado","financeiro","precos"]},
  {role:"gerente_planta",nome:"Gerente de Planta",desc:"Operação da planta, eficiência, custos diretos, equipe.",cor:"#F97316",icon:"🔧",tabs:["geral","negocios","resultado","financeiro"]},
  {role:"financeiro",nome:"Financeiro",desc:"DRE, custos, contas a pagar/receber. Sem gestão de usuários.",cor:G,icon:"📊",tabs:["geral","resultado","financeiro","precos"]},
  {role:"comercial",nome:"Comercial",desc:"Receitas, clientes, vendas. Sem visibilidade de custos detalhados.",cor:BL,icon:"🎯",tabs:["geral","negocios","precos"]},
  {role:"supervisor",nome:"Supervisor",desc:"Supervisão operacional, metas de equipe, indicadores de produção.",cor:"#06B6D4",icon:"📋",tabs:["geral","negocios","resultado"]},
  {role:"coordenador",nome:"Coordenador",desc:"Coordenação de área específica, relatórios setoriais.",cor:"#8B5CF6",icon:"📌",tabs:["geral","negocios","resultado"]},
  {role:"operacional",nome:"Operacional",desc:"Plano de ação, alertas, dados operacionais básicos.",cor:Y,icon:"⚙️",tabs:["geral","negocios"]},
  {role:"consultor",nome:"Consultor Externo",desc:"Acesso completo em leitura. Para consultores PS Gestão.",cor:"#A855F7",icon:"🔍",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"conselheiro",nome:"Conselheiro",desc:"Acesso a relatórios e indicadores. Visão estratégica.",cor:"#EC4899",icon:"🎓",tabs:["geral","resultado","financeiro","relatorio"]},
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
  const [accessConfigs,setAccessConfigs]=useState<any[]>([]);
  const [auditLogs,setAuditLogs]=useState<any[]>([]);
  const [sessions,setSessions]=useState<any[]>([]);
  const [auditFilter,setAuditFilter]=useState("");
  const [currentEmail,setCurrentEmail]=useState("");
  const [editingUser,setEditingUser]=useState<string|null>(null);
  const [isAuthorized,setIsAuthorized]=useState(false);
  const [checkingAuth,setCheckingAuth]=useState(true);
  // Grupos
  const [grupos,setGrupos]=useState<any[]>([]);
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({});
  const [showNewGroup,setShowNewGroup]=useState(false);
  const [newGroupName,setNewGroupName]=useState("");
  const [newGroupCor,setNewGroupCor]=useState("#C6973F");
  const [movingEmpresa,setMovingEmpresa]=useState<string|null>(null);
  const groupColors=["#C6973F","#FF9800","#4CAF50","#3B82F6","#A855F7","#EF4444","#14B8A6","#FF5722","#8BC34A","#E91E63"];

  useEffect(()=>{checkAuth();},[]);

  const checkAuth=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setCheckingAuth(false);return;}
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){
      setIsAuthorized(true);
      loadData();
    }
    setCheckingAuth(false);
  };

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
    const{data:ac}=await supabase.from("access_config").select("*").order("role");
    if(ac)setAccessConfigs(ac);
    // Load audit log
    try{
      const res=await fetch("/api/audit?limit=100");
      const d=await res.json();
      if(d.success){setAuditLogs(d.logs||[]);setSessions(d.sessions||[]);}
    }catch{}
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
    setCurrentEmail(user.email||"");
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

  if(checkingAuth) return(<div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:TXM,fontSize:13}}>Verificando permissão...</div></div>);

  if(!isAuthorized) return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>🔒</div>
      <div style={{fontSize:18,fontWeight:700,color:R}}>Acesso Restrito</div>
      <div style={{fontSize:12,color:TXM,textAlign:"center",maxWidth:300}}>Esta área é exclusiva para administradores do sistema. Se você acredita que deveria ter acesso, entre em contato com o administrador.</div>
      <a href="/dashboard" style={{padding:"10px 24px",borderRadius:8,background:GOL,color:BG,fontSize:12,fontWeight:600,textDecoration:"none",marginTop:8}}>← Voltar ao Dashboard</a>
    </div>
  );

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
      {[{id:"empresas",n:"Empresas"},{id:"usuarios",n:"Usuários & Níveis"},{id:"convites",n:"Convites"},{id:"niveis",n:"Mapa de Permissões"},{id:"seguranca",n:"Horários & Segurança"},{id:"auditoria",n:"Sessões & Auditoria"}].map(t=>(
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
                <span style={{fontSize:10,fontWeight:600,color:GO}}>Empresas que este usuário pode acessar:</span>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>vincularTodas(u.id)} style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:G+"20",color:G,border:`1px solid ${G}30`,cursor:"pointer"}}>✅ Vincular todas</button>
                  <button onClick={async()=>{if(!confirm("Remover TODOS os acessos deste usuário?"))return;await supabase.from("user_companies").delete().eq("user_id",u.id);setUserComps(userComps.filter(uc=>uc.user_id!==u.id));setMsg("Todos os acessos removidos!");}} style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:R+"20",color:R,border:`1px solid ${R}30`,cursor:"pointer"}}>🚫 Remover todos</button>
                </div>
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
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,marginBottom:8}}>
        <div style={{fontSize:12,fontWeight:600,color:TX}}>Convites recentes</div>
        <button onClick={async()=>{if(!confirm("Excluir TODOS os convites pendentes?"))return;await supabase.from("invites").delete().eq("is_used",false);setConvites(prev=>prev.filter(c=>c.is_used));setMsg("Convites pendentes excluídos!");}} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:R+"15",border:`1px solid ${R}30`,color:R,cursor:"pointer"}}>🗑 Limpar pendentes</button>
      </div>
      {convites.map((inv,i)=>(
        <div key={inv.id||i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,borderLeft:`3px solid ${inv.used?G:getRC(inv.role)}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{inv.companies?.nome_fantasia||inv.companies?.razao_social||"Grupo/Empresa"}</div>
            <div style={{fontSize:9,color:TXD}}>{inv.email||"Sem e-mail"} | <span style={{color:getRC(inv.role),fontWeight:600}}>{getRN(inv.role)}</span> | {new Date(inv.created_at).toLocaleDateString("pt-BR")}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:inv.is_used?G+"20":Y+"20",color:inv.is_used?G:Y,fontWeight:600}}>{inv.is_used?"Usado":"Pendente"}</span>
              <button onClick={async(e)=>{e.stopPropagation();if(!confirm("Excluir este convite?"))return;await supabase.from("invites").delete().eq("id",inv.id);setConvites(prev=>prev.filter(c=>c.id!==inv.id));setMsg("Convite excluído!");}} style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:R+"10",border:`1px solid ${R}25`,color:R,cursor:"pointer"}}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>)}

    {/* MAPA DE PERMISSÕES — FASE 1 TOGGLES */}
    {tab==="niveis"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Permissões por Plano — Módulos e Roles</div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {(Object.entries(PLANOS) as [Plano,any][]).map(([k,p])=>(
          <div key={k} style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${p.cor}`}}>
            <div style={{fontSize:9,color:TXD}}>{p.nome}</div>
            <div style={{fontSize:13,fontWeight:600,color:p.cor}}>{p.preco.split("/")[0]}</div>
            <div style={{fontSize:8,color:TXM}}>{Object.values(PLANO_MODULOS).filter(m=>m[k]==="full").length} módulos</div>
          </div>
        ))}
      </div>

      {/* Modules matrix */}
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead>
            <tr style={{borderBottom:`2px solid ${BD}`}}>
              <th style={{padding:"10px 12px",textAlign:"left",color:GOL,fontSize:10,width:200}}>Módulo</th>
              {(Object.entries(PLANOS) as [Plano,any][]).map(([k,p])=>(
                <th key={k} style={{padding:"8px 6px",textAlign:"center",color:p.cor,fontSize:8,lineHeight:1.3,width:90}}>{p.nome.split(" ").slice(0,2).join(" ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {section:"DASHBOARD"},
              {mod:"visao-diaria",nome:"Visão Diária",desc:"DRE, KPIs, gráficos"},
              {mod:"dados",nome:"Dados (Hub)",desc:"API, Excel, Manual"},
              {mod:"rateio",nome:"Rateio",desc:"Centro de custo"},
              {mod:"orcamento",nome:"Orçamento",desc:"Budget vs Actual"},
              {mod:"viabilidade",nome:"Viabilidade",desc:"Análise projetos"},
              {section:"RELATÓRIOS"},
              {mod:"consultor-ia",nome:"Consultor IA",desc:"Análise com IA"},
              {section:"ENTRADA DE DADOS"},
              {mod:"conectores",nome:"Conectores",desc:"Omie, Nibo, ContaAzul"},
              {mod:"importar",nome:"Importar",desc:"CSV, OFX"},
              {section:"ANTI-FRAUDE"},
              {mod:"anti-fraude-basico",nome:"Anti-Fraude (6 cam)",desc:"Duplicatas, outliers"},
              {mod:"anti-fraude-full",nome:"Anti-Fraude (11 cam)",desc:"Score 0-100, parecer"},
              {mod:"anti-fraude-bpo",nome:"Score BPO",desc:"Bloqueio aprovação"},
              {section:"BPO"},
              {mod:"bpo",nome:"BPO Central",desc:"9 módulos + Rodar Dia"},
              {mod:"bpo-automacao",nome:"BPO Automação",desc:"Classificação IA"},
              {mod:"bpo-rotinas",nome:"BPO Rotinas",desc:"14 rotinas"},
              {mod:"bpo-conciliacao",nome:"BPO Conciliação",desc:"OFX bancário"},
              {mod:"bpo-supervisor",nome:"BPO Supervisor",desc:"Operadores"},
              {section:"INDUSTRIAL / CUSTO"},
              {mod:"custo",nome:"Custo CPC 16",desc:"13 grupos absorção"},
              {mod:"ficha-tecnica",nome:"Ficha Técnica",desc:"Explosão insumos"},
              {mod:"industrial",nome:"Industrial",desc:"Fábricas + CEO"},
              {mod:"operacional",nome:"Operacional",desc:"Gestão operacional"},
              {section:"ASSESSORIA"},
              {mod:"assessor",nome:"PS Assessor",desc:"5 Pilares + Health Score"},
              {mod:"plano-acao",nome:"Plano de Ação",desc:"Conectado diagnóstico"},
              {section:"OUTROS"},
              {mod:"wealth",nome:"Wealth MFO",desc:"Multi Family Office"},
              {mod:"noc",nome:"NOC",desc:"Monitoramento"},
              {mod:"contador",nome:"Contador",desc:"Portal contábil"},
              {mod:"admin",nome:"Admin",desc:"Gestão usuários"},
              {mod:"ajuda",nome:"Ajuda",desc:"Tutoriais"},
            ].map((row,i)=>{
              if("section" in row) return(
                <tr key={i}><td colSpan={6} style={{padding:"8px 12px",fontSize:9,fontWeight:700,color:GOL,background:BG3,borderTop:`1px solid ${BD}`,borderBottom:`1px solid ${BD}`,letterSpacing:"0.05em"}}>{row.section}</td></tr>
              );
              const perms = PLANO_MODULOS[row.mod!] || {};
              return(
                <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`}}>
                  <td style={{padding:"6px 12px"}}>
                    <div style={{fontWeight:500,color:TX,fontSize:11}}>{row.nome}</div>
                    <div style={{fontSize:8,color:TXD}}>{row.desc}</div>
                  </td>
                  {(Object.keys(PLANOS) as Plano[]).map(plan=>{
                    const access = perms[plan] || "none";
                    const bg = access==="full"?"#22C55E18":access==="addon"?"#FACC1518":"#EF444410";
                    const color = access==="full"?G:access==="addon"?Y:R;
                    const label = access==="full"?"✓":access==="addon"?"🔒":"✕";
                    return(
                      <td key={plan} style={{padding:6,textAlign:"center"}}>
                        <span style={{display:"inline-block",padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:600,background:bg,color,minWidth:28}}>{label}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:8}}>✓ Incluso | 🔒 Addon (compra separada) | ✕ Não disponível</div>

      {/* Roles by Plan */}
      <div style={{fontSize:14,fontWeight:600,color:TX,marginTop:24,marginBottom:12}}>Roles disponíveis por Plano</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10}}>
        {(Object.entries(ROLES_POR_PLANO) as [Plano,string[]][]).map(([plan,roles])=>{
          const p = PLANOS[plan];
          return(
            <div key={plan} style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`,borderTop:`3px solid ${p.cor}`}}>
              <div style={{fontSize:12,fontWeight:600,color:p.cor,marginBottom:8}}>{p.nome}</div>
              {roles.map(r=>(
                <div key={r} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`0.5px solid ${BD}30`}}>
                  <div>
                    <span style={{fontSize:11,fontWeight:500,color:TX}}>{ROLE_NAMES[r]||r}</span>
                    <span style={{fontSize:8,color:TXD,marginLeft:6}}>{r}</span>
                  </div>
                  <span style={{fontSize:8,color:TXM}}>{(ROLE_TABS[r]||[]).length} abas</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Company plans */}
      <div style={{fontSize:14,fontWeight:600,color:TX,marginTop:24,marginBottom:12}}>Plano por Empresa</div>
      <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`}}>
        {empresas.map((c:any)=>{
          const plan = c.plano || "erp_cs";
          const p = PLANOS[plan as Plano] || PLANOS.erp_cs;
          return(
            <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`0.5px solid ${BD}30`}}>
              <div>
                <span style={{fontSize:12,fontWeight:500,color:TX}}>{c.nome_fantasia||c.razao_social}</span>
                <span style={{fontSize:9,color:TXD,marginLeft:8}}>{c.cnpj}</span>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:p.cor+"18",color:p.cor,fontWeight:600}}>{p.nome}</span>
                <select value={plan} onChange={async(e)=>{
                  await supabase.from("companies").update({plano:e.target.value}).eq("id",c.id);
                  loadData();
                }} style={{fontSize:10,padding:"3px 6px",borderRadius:6,background:BG3,color:TX,border:`1px solid ${BD}`}}>
                  {(Object.entries(PLANOS) as [string,any][]).map(([k,v])=>(
                    <option key={k} value={k}>{v.nome}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>)}

    {/* HORÁRIOS & SEGURANÇA */}
    {tab==="seguranca"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:14}}>Restrições de Horário e Segurança por Role</div>

      {/* Default configs for all roles */}
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden",marginBottom:16}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
            <th style={{padding:"10px 12px",textAlign:"left",color:GOL,fontSize:10}}>Role</th>
            <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Horário</th>
            <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Dias</th>
            <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Timeout</th>
            <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Ativo</th>
            <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Ações</th>
          </tr></thead>
          <tbody>
            {ROLES.map(r=>{
              const cfg=accessConfigs.find((a:any)=>a.role===r.role);
              const inicio=cfg?.horario_inicio||"00:00";
              const fim=cfg?.horario_fim||"23:59";
              const dias=(cfg?.dias_semana||["seg","ter","qua","qui","sex","sab","dom"]).join(",");
              const timeout=cfg?.timeout_minutos||30;
              const ativo=cfg?.ativo!==false;
              const isAdmRole=r.role==="adm"||r.role==="adm_investimentos"||r.role==="acesso_total";
              return(
                <tr key={r.role} style={{borderBottom:`0.5px solid ${BD}30`,opacity:isAdmRole?0.5:1}}>
                  <td style={{padding:"8px 12px"}}>
                    <span style={{color:r.cor,marginRight:6}}>{r.icon}</span>
                    <span style={{fontWeight:500,color:TX}}>{r.nome}</span>
                    {isAdmRole&&<span style={{fontSize:8,color:TXD,marginLeft:6}}>(sem restrição)</span>}
                  </td>
                  <td style={{padding:6,textAlign:"center"}}>
                    {!isAdmRole?(
                      <div style={{display:"flex",gap:4,justifyContent:"center",alignItems:"center"}}>
                        <input type="time" defaultValue={inicio} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:10,width:70}} data-role={r.role} data-field="horario_inicio"/>
                        <span style={{color:TXD,fontSize:9}}>-</span>
                        <input type="time" defaultValue={fim} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:10,width:70}} data-role={r.role} data-field="horario_fim"/>
                      </div>
                    ):<span style={{color:TXD,fontSize:10}}>24h</span>}
                  </td>
                  <td style={{padding:6,textAlign:"center"}}>
                    {!isAdmRole?(
                      <select defaultValue={dias} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:9}} data-role={r.role} data-field="dias_semana">
                        <option value="seg,ter,qua,qui,sex">Seg-Sex</option>
                        <option value="seg,ter,qua,qui,sex,sab">Seg-Sáb</option>
                        <option value="seg,ter,qua,qui,sex,sab,dom">Todos</option>
                      </select>
                    ):<span style={{color:TXD,fontSize:10}}>7 dias</span>}
                  </td>
                  <td style={{padding:6,textAlign:"center"}}>
                    {!isAdmRole?(
                      <select defaultValue={String(timeout)} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:9}} data-role={r.role} data-field="timeout_minutos">
                        <option value="0">Sem timeout</option>
                        <option value="15">15 min</option>
                        <option value="30">30 min</option>
                        <option value="60">1 hora</option>
                        <option value="120">2 horas</option>
                        <option value="480">8 horas</option>
                      </select>
                    ):<span style={{color:TXD,fontSize:10}}>Nunca</span>}
                  </td>
                  <td style={{padding:6,textAlign:"center"}}>
                    {!isAdmRole&&(
                      <div onClick={async()=>{
                        const newAtivo=!ativo;
                        if(cfg){
                          await supabase.from("access_config").update({ativo:newAtivo}).eq("id",cfg.id);
                        }else{
                          await supabase.from("access_config").insert({role:r.role,ativo:newAtivo});
                        }
                        loadData();
                      }} style={{width:36,height:20,borderRadius:10,background:ativo?G:BD,cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
                        <div style={{width:16,height:16,borderRadius:8,background:"white",position:"absolute",top:2,left:ativo?18:2,transition:"left 0.2s"}}/>
                      </div>
                    )}
                  </td>
                  <td style={{padding:6,textAlign:"center"}}>
                    {!isAdmRole&&(
                      <button onClick={async()=>{
                        const row=document.querySelector(`[data-role="${r.role}"][data-field="horario_inicio"]`) as HTMLInputElement;
                        const row2=document.querySelector(`[data-role="${r.role}"][data-field="horario_fim"]`) as HTMLInputElement;
                        const row3=document.querySelector(`[data-role="${r.role}"][data-field="dias_semana"]`) as HTMLSelectElement;
                        const row4=document.querySelector(`[data-role="${r.role}"][data-field="timeout_minutos"]`) as HTMLSelectElement;
                        const data={
                          role:r.role,
                          horario_inicio:row?.value||"00:00",
                          horario_fim:row2?.value||"23:59",
                          dias_semana:(row3?.value||"seg,ter,qua,qui,sex,sab,dom").split(","),
                          timeout_minutos:parseInt(row4?.value||"30"),
                          ativo:true,
                        };
                        if(cfg){
                          await supabase.from("access_config").update(data).eq("id",cfg.id);
                        }else{
                          await supabase.from("access_config").insert(data);
                        }
                        setMsg("Regra salva para "+r.nome);
                        loadData();
                      }} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:GO+"18",border:`1px solid ${GO}30`,color:GOL,cursor:"pointer"}}>Salvar</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Security settings */}
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Configurações de Segurança Global</div>
      <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
        {[
          {label:"Bloqueio após tentativas erradas",desc:"Conta bloqueada após 3 tentativas com senha errada",key:"block_attempts",def:true},
          {label:"Notificar admin em login fora do horário",desc:"Email para admin quando tentativa fora do permitido",key:"notify_outside",def:true},
          {label:"Exigir senha forte",desc:"Mínimo 8 caracteres, letra maiúscula, número e símbolo",key:"strong_pass",def:false},
          {label:"Log de auditoria ativo",desc:"Registrar todas as ações de todos os usuários",key:"audit_log",def:true},
        ].map((item,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i<3?`0.5px solid ${BD}30`:"none"}}>
            <div>
              <div style={{fontSize:12,fontWeight:500,color:TX}}>{item.label}</div>
              <div style={{fontSize:9,color:TXD}}>{item.desc}</div>
            </div>
            <div style={{width:36,height:20,borderRadius:10,background:item.def?G:BD,cursor:"pointer",position:"relative"}} onClick={(e)=>{
              const el=e.currentTarget;
              const isOn=el.style.background===G;
              el.style.background=isOn?BD:G;
              const dot=el.firstChild as HTMLElement;
              if(dot)dot.style.left=isOn?"2px":"18px";
            }}>
              <div style={{width:16,height:16,borderRadius:8,background:"white",position:"absolute",top:2,left:item.def?18:2,transition:"left 0.2s"}}/>
            </div>
          </div>
        ))}
      </div>
    </div>)}

    {/* SESSÕES & AUDITORIA */}
    {tab==="auditoria"&&(<div>
      {/* Active Sessions */}
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Sessões Ativas</div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,marginBottom:20,overflow:"hidden"}}>
        {sessions.length===0?(
          <div style={{padding:20,textAlign:"center",color:TXD,fontSize:12}}>Nenhuma sessão ativa detectada. Recarregue para atualizar.</div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
              <th style={{padding:"10px 12px",textAlign:"left",color:GOL,fontSize:10}}>Usuário</th>
              <th style={{padding:8,textAlign:"left",color:GOL,fontSize:10}}>Dispositivo</th>
              <th style={{padding:8,textAlign:"left",color:GOL,fontSize:10}}>IP</th>
              <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Status</th>
              <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Login</th>
              <th style={{padding:8,textAlign:"center",color:GOL,fontSize:10}}>Ação</th>
            </tr></thead>
            <tbody>
              {sessions.map((s:any,i:number)=>(
                <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`}}>
                  <td style={{padding:"8px 12px",fontWeight:500,color:TX}}>{s.user_email?.split("@")[0]||"?"}</td>
                  <td style={{padding:8,color:TXM,fontSize:10}}>{s.device||"?"}</td>
                  <td style={{padding:8,color:TXD,fontSize:10}}>{s.ip_address||"?"}</td>
                  <td style={{padding:8,textAlign:"center"}}>
                    <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,fontWeight:600,
                      background:s.status==="ativo"?G+"18":s.status==="inativo"?Y+"18":R+"18",
                      color:s.status==="ativo"?G:s.status==="inativo"?Y:R,
                    }}>{s.status==="ativo"?"Ativo agora":s.status==="inativo"?`Inativo ${s.minutes_ago} min`:"Expirado"}</span>
                  </td>
                  <td style={{padding:8,textAlign:"center",color:TXD,fontSize:10}}>
                    {new Date(s.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
                  </td>
                  <td style={{padding:8,textAlign:"center"}}>
                    {s.user_email!==currentEmail&&(
                      <button onClick={async()=>{
                        if(!confirm("Encerrar sessão de "+s.user_email+"?"))return;
                        await fetch("/api/audit",{method:"POST",headers:{"Content-Type":"application/json"},
                          body:JSON.stringify({user_email:currentEmail,action:"force_logout",detail:`Admin encerrou sessão de ${s.user_email}`})
                        });
                        setMsg("Sessão encerrada (o usuário será deslogado no próximo check)");
                      }} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:R+"15",border:`1px solid ${R}30`,color:R,cursor:"pointer"}}>Encerrar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit Log */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Log de Auditoria</div>
        <div style={{display:"flex",gap:6}}>
          {["","login","logout","page_visit","access_blocked","sync","force_logout"].map(f=>(
            <button key={f} onClick={()=>setAuditFilter(f)} style={{
              fontSize:9,padding:"4px 10px",borderRadius:6,cursor:"pointer",
              background:auditFilter===f?GO+"18":"transparent",
              border:`1px solid ${auditFilter===f?GO:BD}`,
              color:auditFilter===f?GOL:TXM,
            }}>{f||"Todos"}</button>
          ))}
          <button onClick={loadData} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:BL+"15",border:`1px solid ${BL}30`,color:BL,cursor:"pointer"}}>Atualizar</button>
        </div>
      </div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden",maxHeight:500,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}><tr style={{borderBottom:`2px solid ${BD}`}}>
            <th style={{padding:"8px 12px",textAlign:"left",color:GOL,fontSize:9,width:70}}>Hora</th>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>Usuário</th>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>Ação</th>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>Detalhe</th>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>Dispositivo</th>
            <th style={{padding:8,textAlign:"left",color:GOL,fontSize:9}}>IP</th>
          </tr></thead>
          <tbody>
            {auditLogs.filter((l:any)=>!auditFilter||l.action===auditFilter).map((l:any,i:number)=>{
              const actionColors:any={"login":G,"logout":Y,"page_visit":BL,"access_blocked":R,"sync":GOL,"force_logout":R};
              const actionLabels:any={"login":"Login","logout":"Logout","page_visit":"Página","access_blocked":"Bloqueado","sync":"Sync","force_logout":"Forçar Logout"};
              return(
                <tr key={i} style={{borderBottom:`0.5px solid ${BD}20`}}>
                  <td style={{padding:"6px 12px",color:TXD,fontSize:10,whiteSpace:"nowrap"}}>
                    {new Date(l.created_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}{" "}
                    {new Date(l.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
                  </td>
                  <td style={{padding:6,color:BL,fontWeight:500,fontSize:10}}>{l.user_email?.split("@")[0]||"sistema"}</td>
                  <td style={{padding:6}}>
                    <span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:(actionColors[l.action]||TXD)+"18",color:actionColors[l.action]||TXD,fontWeight:600}}>
                      {actionLabels[l.action]||l.action}
                    </span>
                  </td>
                  <td style={{padding:6,color:TXM,fontSize:9,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.detail||l.module||"—"}</td>
                  <td style={{padding:6,color:TXD,fontSize:9}}>{l.device||"—"}</td>
                  <td style={{padding:6,color:TXD,fontSize:9}}>{l.ip_address||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {auditLogs.length===0&&<div style={{padding:20,textAlign:"center",color:TXD,fontSize:12}}>Nenhum registro de auditoria. Navegue pelo ERP para gerar logs.</div>}
      </div>
      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:8}}>Mostrando últimos {auditLogs.filter((l:any)=>!auditFilter||l.action===auditFilter).length} registros {auditFilter?`(filtro: ${auditFilter})`:""}</div>
    </div>)}
  </div>);
}
