"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PLANO_MODULOS, PLANOS, ROLES_POR_PLANO, ROLE_NAMES, ROLE_TABS, isAdminRole, type Plano } from "@/lib/planos";

// ═══ CORES COM CSS VARIABLES (adapta ao tema claro/escuro) ═══
const GO="var(--ps-gold,#C8941A)",GOL="var(--ps-gold,#C8941A)",BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)",
    G="#22C55E",R="#EF4444",Y="#FACC15",BL="#3B82F6",
    BD="var(--ps-border,#E0D8CC)",TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";

const PLANO_ICONS: Record<string,string> = { erp_cs:'🏪', industrial:'🏭', agro:'🌾', bpo:'💼', wealth:'💰', producao:'🎨', assessoria:'📊' };

const ROLES = [
  {role:"adm_investimentos",nome:"Admin Investimentos",desc:"Acesso IRRESTRITO a todos os modulos, planos e configuracoes. PS Gestao e Capital.",cor:"#D4AF37",icon:"🏆",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"adm",nome:"Administrador",desc:"Acesso total. Gestão de empresas, usuários e configurações.",cor:"#C8941A",icon:"👑",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"socio",nome:"Sócio / CEO",desc:"Dashboard completo, relatórios, indicadores, plano de ação.",cor:"#C8941A",icon:"💼",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"diretor_industrial",nome:"Diretor Industrial",desc:"Gestão industrial, produção, custos e indicadores operacionais.",cor:"#F59E0B",icon:"🏭",tabs:["geral","negocios","resultado","financeiro","precos"]},
  {role:"gerente_planta",nome:"Gerente de Planta",desc:"Operação da planta, eficiência, custos diretos, equipe.",cor:"#F97316",icon:"🔧",tabs:["geral","negocios","resultado","financeiro"]},
  {role:"financeiro",nome:"Financeiro",desc:"DRE, custos, contas a pagar/receber. Sem gestão de usuários.",cor:G,icon:"📊",tabs:["geral","resultado","financeiro","precos"]},
  {role:"comercial",nome:"Comercial",desc:"Receitas, clientes, vendas. Sem visibilidade de custos detalhados.",cor:BL,icon:"🎯",tabs:["geral","negocios","precos"]},
  {role:"supervisor",nome:"Supervisor",desc:"Supervisão operacional, metas de equipe, indicadores de produção.",cor:"#06B6D4",icon:"📋",tabs:["geral","negocios","resultado"]},
  {role:"coordenador",nome:"Coordenador",desc:"Coordenação de área específica, relatórios setoriais.",cor:"#8B5CF6",icon:"📌",tabs:["geral","negocios","resultado"]},
  {role:"operacional",nome:"Operacional",desc:"Plano de ação, alertas, dados operacionais básicos.",cor:Y,icon:"⚙️",tabs:["geral","negocios"]},
  {role:"consultor",nome:"Consultor Externo",desc:"Acesso completo em leitura. Para consultores PS Gestão.",cor:"#A855F7",icon:"🔍",tabs:["geral","negocios","resultado","financeiro","precos","relatorio"]},
  {role:"conselheiro",nome:"Conselheiro",desc:"Acesso a relatórios e indicadores. Visão estratégica.",cor:"#EC4899",icon:"🎓",tabs:["geral","resultado","financeiro","relatorio"]},
  {role:"contador",nome:"Contador",desc:"Portal contábil — DRE, Balancete, Razão, SPED, Impostos.",cor:"#14B8A6",icon:"📒",tabs:["geral","resultado","indicadores"]},
  {role:"atendimento",nome:"Atendimento",desc:"Gestão de jobs e projetos. Para agências.",cor:"#F59E0B",icon:"📞",tabs:["geral","negocios"]},
  {role:"designer",nome:"Designer",desc:"Acesso ao módulo de produção. Timesheet e jobs.",cor:"#A855F7",icon:"🎨",tabs:["geral"]},
  {role:"visualizador",nome:"Visualizador",desc:"Apenas painel geral. Sem acesso a dados detalhados.",cor:"#9C8E80",icon:"👁️",tabs:["geral"]},
];
const getRN=(r:string)=>ROLES.find(x=>x.role===r)?.nome||r;
const getRC=(r:string)=>ROLES.find(x=>x.role===r)?.cor||"#9C8E80";
const getPlanBadge=(plano:string)=>{const p=PLANOS[plano as Plano];return p?{icon:p.icon,nome:p.nome.replace('ERP ','').replace('PS ',''),cor:p.cor}:{icon:'🏪',nome:'Comércio & Serviços',cor:'#22C55E'};};

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
  const [newEmp,setNewEmp]=useState({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:"",group_id:"",plano:"erp_cs"});
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
  const [grupos,setGrupos]=useState<any[]>([]);
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({});
  const [showNewGroup,setShowNewGroup]=useState(false);
  const [newGroupName,setNewGroupName]=useState("");
  const [newGroupCor,setNewGroupCor]=useState("#C8941A");
  const [movingEmpresa,setMovingEmpresa]=useState<string|null>(null);
  const groupColors=["#C8941A","#FF9800","#4CAF50","#3B82F6","#A855F7","#EF4444","#14B8A6","#FF5722","#8BC34A","#E91E63"];

  useEffect(()=>{checkAuth();},[]);

  const checkAuth=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setCheckingAuth(false);return;}
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){setIsAuthorized(true);setCurrentEmail(user.email||"");loadData();}
    setCheckingAuth(false);
  };

  const loadData=async()=>{
    const{data:emp}=await supabase.from("companies").select("*").order("nome_fantasia");
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
    try{const res=await fetch("/api/audit?limit=100");const d=await res.json();if(d.success){setAuditLogs(d.logs||[]);setSessions(d.sessions||[]);}}catch{}
  };

  const getUserCompIds=(uid:string)=>userComps.filter(uc=>uc.user_id===uid).map(uc=>uc.company_id);
  const toggleUserCompany=async(uid:string,compId:string)=>{const exists=userComps.find(uc=>uc.user_id===uid&&uc.company_id===compId);if(exists){await supabase.from("user_companies").delete().eq("user_id",uid).eq("company_id",compId);setUserComps(userComps.filter(uc=>!(uc.user_id===uid&&uc.company_id===compId)));}else{const role=usuarios.find(u=>u.id===uid)?.role||"visualizador";const{data}=await supabase.from("user_companies").insert({user_id:uid,company_id:compId,role}).select().single();if(data)setUserComps([...userComps,data]);}setMsg(exists?"Empresa removida do usuário":"Empresa vinculada ao usuário!");};
  const vincularTodas=async(uid:string)=>{const role=usuarios.find(u=>u.id===uid)?.role||"visualizador";const existing=getUserCompIds(uid);const toAdd=empresas.filter(e=>!existing.includes(e.id));for(const e of toAdd){const{data}=await supabase.from("user_companies").insert({user_id:uid,company_id:e.id,role}).select().single();if(data)setUserComps(prev=>[...prev,data]);}setMsg(`${toAdd.length} empresas vinculadas!`);};
  const vincularGrupo=async(uid:string,groupId:string)=>{const role=usuarios.find(u=>u.id===uid)?.role||"visualizador";const existing=getUserCompIds(uid);const gc=empresas.filter(e=>e.group_id===groupId&&!existing.includes(e.id));for(const e of gc){const{data}=await supabase.from("user_companies").insert({user_id:uid,company_id:e.id,role}).select().single();if(data)setUserComps(prev=>[...prev,data]);}setMsg(`✅ ${gc.length} empresas do grupo vinculadas!`);setTimeout(()=>setMsg(""),3000);};
  const desvincularGrupo=async(uid:string,groupId:string)=>{const gci=empresas.filter(e=>e.group_id===groupId).map(e=>e.id);for(const cid of gci){await supabase.from("user_companies").delete().eq("user_id",uid).eq("company_id",cid);}setUserComps(userComps.filter(uc=>!(uc.user_id===uid&&gci.includes(uc.company_id))));setMsg("Empresas do grupo desvinculadas.");setTimeout(()=>setMsg(""),3000);};

  const criarEmpresa=async(e:React.FormEvent)=>{
    e.preventDefault();const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    let orgId=up?.org_id;
    if(!orgId){const{data:org}=await supabase.from("organizations").insert({name:"PS Gestão e Capital",slug:"psgestao-"+Date.now()}).select().single();if(org){orgId=org.id;await supabase.from("users").upsert({id:user.id,org_id:orgId,full_name:"Administrador",email:user.email!,role:"adm"});}}
    const empData:any={razao_social:newEmp.razao_social,nome_fantasia:newEmp.nome_fantasia,cnpj:newEmp.cnpj,cidade_estado:newEmp.cidade_estado,org_id:orgId,plano:newEmp.plano||"erp_cs"};
    if(newEmp.group_id)empData.group_id=newEmp.group_id;
    const{error}=await supabase.from("companies").insert(empData);
    if(error){setMsg("Erro: "+error.message);return;}
    setMsg("Empresa cadastrada!");setNewEmp({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:"",group_id:"",plano:"erp_cs"});setShowForm(false);loadData();
  };

  const criarGrupo=async()=>{if(!newGroupName.trim())return;const{data:{user}}=await supabase.auth.getUser();if(!user)return;const{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();const{error}=await supabase.from("company_groups").insert({nome:newGroupName.trim(),cor:newGroupCor,org_id:up?.org_id});if(error){setMsg("Erro: "+error.message);return;}setMsg("Grupo criado!");setNewGroupName("");setShowNewGroup(false);loadData();};
  const moverEmpresaGrupo=async(empId:string,groupId:string|null)=>{const{error}=await supabase.from("companies").update({group_id:groupId}).eq("id",empId);if(error){setMsg("Erro: "+error.message);return;}setMsg("Empresa movida!");setMovingEmpresa(null);loadData();};
  const excluirGrupo=async(gid:string)=>{const n=empresas.filter(e=>e.group_id===gid);if(n.length>0){setMsg("Mova todas as empresas antes de excluir o grupo.");return;}await supabase.from("company_groups").delete().eq("id",gid);setMsg("Grupo excluído!");loadData();};
  const toggleGroup=(gid:string)=>setExpandedGroups(prev=>({...prev,[gid]:!prev[gid]}));
  const expandAllGroups=()=>{const all:any={};grupos.forEach(g=>{all[g.id]=true;});all["sem_grupo"]=true;setExpandedGroups(all);};
  const collapseAllGroups=()=>setExpandedGroups({});

  const gerarConvite=async()=>{
    if(!selectedCompany&&!selectedGroup){setMsg("Selecione uma empresa ou grupo.");return;}
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    const code="conv_"+Math.random().toString(36).substring(2,10)+Date.now().toString(36);
    const inviteData:any={org_id:up?.org_id,email:inviteEmail||null,role:inviteRole,invite_code:code,created_by:user.id};
    if(selectedGroup){inviteData.group_id=selectedGroup;const fc=empresas.find(e=>e.group_id===selectedGroup);inviteData.company_id=fc?.id||null;}else{inviteData.company_id=selectedCompany;}
    const{error}=await supabase.from("invites").insert(inviteData);
    if(error){setMsg("Erro: "+error.message);return;}
    setGeneratedLink("https://erp-psgestao.vercel.app/convite?code="+code);setCopied(false);loadData();
  };

  const atualizarRole=async(uid:string,nr:string)=>{await supabase.from("users").update({role:nr}).eq("id",uid);setUsuarios(usuarios.map(u=>u.id===uid?{...u,role:nr}:u));setMsg("Nível atualizado!");};
  const atualizarPlano=async(compId:string,novoPlano:string)=>{await supabase.from("companies").update({plano:novoPlano}).eq("id",compId);setEmpresas(empresas.map(e=>e.id===compId?{...e,plano:novoPlano}:e));setMsg("Plano atualizado!");setTimeout(()=>setMsg(""),3000);};

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  // ═══ EMPRESA ROW — reutilizado em grupos e sem grupo ═══
  const EmpresaRow=({emp,grupoId}:{emp:any;grupoId?:string})=>{
    const pb=getPlanBadge(emp.plano||"erp_cs");
    return(
      <div style={{padding:"8px 16px 8px 44px",borderBottom:`0.5px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:500,color:TX}}>{emp.nome_fantasia||emp.razao_social}</span>
            <span style={{fontSize:8,padding:"2px 8px",borderRadius:6,background:pb.cor+"15",color:pb.cor,fontWeight:600,whiteSpace:"nowrap"}}>{pb.icon} {pb.nome}</span>
          </div>
          <div style={{fontSize:10,color:TXD}}>{emp.cnpj||"Sem CNPJ"} · {emp.cidade_estado||""}</div>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
          <select value={emp.plano||"erp_cs"} onChange={e=>atualizarPlano(emp.id,e.target.value)} style={{fontSize:9,padding:"3px 6px",borderRadius:6,background:BG3,color:TX,border:`1px solid ${BD}`,cursor:"pointer"}}>
            {(Object.entries(PLANOS) as [string,any][]).map(([k,v])=>(<option key={k} value={k}>{v.icon} {v.nome}</option>))}
          </select>
          {movingEmpresa===emp.id?(
            <select onChange={e=>{moverEmpresaGrupo(emp.id,e.target.value||null);}} style={{...inp,width:"auto",fontSize:10,padding:"4px 8px"}}>
              <option value="">Sem grupo</option>
              {grupos.filter(g=>g.id!==grupoId).map(g=><option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
          ):(
            <button onClick={()=>setMovingEmpresa(emp.id)} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,color:TXM,fontSize:10,cursor:"pointer",padding:"3px 8px"}} title="Mover para outro grupo">↗️</button>
          )}
        </div>
      </div>
    );
  };

  if(checkingAuth) return(<div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:TXM,fontSize:13}}>Verificando permissão...</div></div>);

  if(!isAuthorized) return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>🔒</div>
      <div style={{fontSize:18,fontWeight:700,color:R}}>Acesso Restrito</div>
      <div style={{fontSize:12,color:TXM,textAlign:"center",maxWidth:300}}>Esta área é exclusiva para administradores do sistema.</div>
      <a href="/dashboard" style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,textDecoration:"none",marginTop:8}}>← Voltar ao Dashboard</a>
    </div>
  );

  return(
  <div style={{padding:"20px",maxWidth:1000,margin:"0 auto",background:BG,minHeight:"100vh"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:GO}}>Painel Administrativo</div>
        <div style={{fontSize:11,color:TXD}}>Gestão de empresas, usuários e permissões</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        <a href="/dashboard/conectores" style={{padding:"8px 16px",border:`1px solid ${GO}`,borderRadius:8,color:GO,fontSize:11,textDecoration:"none"}}>🔌 Conectores</a>
        <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${G}`,borderRadius:8,color:G,fontSize:11,textDecoration:"none"}}>📊 BPO</a>
      </div>
    </div>

    {msg&&<div style={{background:G+"20",border:`1px solid ${G}`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

    <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
      {[{id:"empresas",n:"Empresas"},{id:"usuarios",n:"Usuários & Níveis"},{id:"convites",n:"Convites"},{id:"niveis",n:"Mapa de Permissões"},{id:"seguranca",n:"Horários & Segurança"},{id:"auditoria",n:"Sessões & Auditoria"}].map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 16px",borderRadius:20,fontSize:11,border:`1px solid ${tab===t.id?GO:BD}`,background:tab===t.id?`${G}08`:"transparent",color:tab===t.id?GO:TXM,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>{t.n}</button>
      ))}
    </div>

    {/* ═══ EMPRESAS COM GRUPOS ═══ */}
    {tab==="empresas"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>{empresas.length} empresas · {grupos.length} grupos</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setShowNewGroup(true)} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${GO}`,background:"transparent",color:GO,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Grupo</button>
          <button onClick={()=>setShowForm(!showForm)} style={{padding:"6px 14px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Empresa</button>
          <button onClick={expandAllGroups} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>▼ Expandir</button>
          <button onClick={collapseAllGroups} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>▲ Recolher</button>
        </div>
      </div>

      {showNewGroup&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${GO}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:10}}>Criar Novo Grupo</div>
          <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome do Grupo</div>
              <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="Ex: Grupo Tryo Gessos" style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cor</div>
              <div style={{display:"flex",gap:4}}>{groupColors.map(c=>(
                <div key={c} onClick={()=>setNewGroupCor(c)} style={{width:24,height:24,borderRadius:6,background:c,cursor:"pointer",border:newGroupCor===c?"2px solid #3D2314":"2px solid transparent"}}/>
              ))}</div></div>
            <button onClick={criarGrupo} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Criar</button>
            <button onClick={()=>setShowNewGroup(false)} style={{padding:"8px 16px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}

      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${BD}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:10}}>Cadastrar Nova Empresa</div>
          <form onSubmit={criarEmpresa}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"Razão Social *",k:"razao_social",p:"Razão Social"},{l:"Nome Fantasia",k:"nome_fantasia",p:"Nome comercial"},{l:"CNPJ",k:"cnpj",p:"00.000.000/0000-00"},{l:"Cidade/UF",k:"cidade_estado",p:"São Miguel do Oeste/SC"}].map(f=>(
                <div key={f.k}><div style={{fontSize:10,color:TXD,marginBottom:3}}>{f.l}</div>
                <input value={(newEmp as any)[f.k]} onChange={e=>setNewEmp({...newEmp,[f.k]:e.target.value})} placeholder={f.p} style={inp}/></div>
              ))}
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Grupo</div>
                <select value={newEmp.group_id} onChange={e=>setNewEmp({...newEmp,group_id:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="">Sem grupo</option>
                  {grupos.map(g=><option key={g.id} value={g.id}>{g.nome}</option>)}
                </select></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Plano</div>
                <select value={newEmp.plano} onChange={e=>setNewEmp({...newEmp,plano:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  {(Object.entries(PLANOS) as [string,any][]).map(([k,v])=>(<option key={k} value={k}>{v.icon} {v.nome}</option>))}
                </select></div>
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button type="submit" style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
              <button type="button" onClick={()=>setShowForm(false)} style={{padding:"8px 16px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Grupos com empresas */}
      {grupos.map(grupo=>{
        const empsDoGrupo=empresas.filter(e=>e.group_id===grupo.id);
        const isOpen=!!expandedGroups[grupo.id];
        return(
          <div key={grupo.id} style={{background:BG2,borderRadius:10,marginBottom:6,border:`1px solid ${BD}`,borderLeft:`4px solid ${grupo.cor||"#C8941A"}`,overflow:"hidden"}}>
            <div onClick={()=>toggleGroup(grupo.id)} style={{padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:14,color:grupo.cor||"#C8941A",transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                <span style={{fontSize:14,fontWeight:600,color:TX}}>{grupo.nome}</span>
                <span style={{fontSize:10,color:TXD}}>{empsDoGrupo.length} empresa{empsDoGrupo.length!==1?"s":""}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,fontWeight:700,color:grupo.cor||"#C8941A",background:(grupo.cor||"#C8941A")+"20",padding:"2px 8px",borderRadius:8}}>{empsDoGrupo.length}</span>
                {empsDoGrupo.length===0&&<button onClick={(e)=>{e.stopPropagation();excluirGrupo(grupo.id);}} style={{background:"none",border:"none",color:R,fontSize:12,cursor:"pointer",padding:"2px 4px"}} title="Excluir grupo vazio">🗑</button>}
              </div>
            </div>
            {isOpen&&(
              <div style={{borderTop:`1px solid ${BD}`}}>
                {empsDoGrupo.length===0&&<div style={{padding:16,textAlign:"center",fontSize:11,color:TXD}}>Nenhuma empresa neste grupo</div>}
                {empsDoGrupo.map(emp=><EmpresaRow key={emp.id} emp={emp} grupoId={grupo.id}/>)}
              </div>
            )}
          </div>
        );
      })}

      {/* Sem grupo */}
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
            {isOpen&&(<div style={{borderTop:`1px solid ${BD}`}}>{semGrupo.map(emp=><EmpresaRow key={emp.id} emp={emp}/>)}</div>)}
          </div>
        );
      })()}
    </div>)}

    {/* ═══ USUÁRIOS ═══ */}
    {tab==="usuarios"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>{usuarios.length} usuários</div>
      {usuarios.map(u=>{
        const uComps=getUserCompIds(u.id);const isEditing=editingUser===u.id;
        return(
        <div key={u.id} style={{background:BG2,borderRadius:10,padding:"12px 16px",marginBottom:8,border:`1px solid ${BD}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:getRC(u.role)+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{ROLES.find(r=>r.role===u.role)?.icon||"👤"}</div>
              <div><div style={{fontSize:13,fontWeight:600,color:TX}}>{u.full_name||u.email||"Sem nome"}</div>
              <div style={{fontSize:10,color:TXD}}>{u.email||""}</div></div>
            </div>
            <select value={u.role||"visualizador"} onChange={e=>atualizarRole(u.id,e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:getRC(u.role),borderRadius:6,padding:"6px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
              {ROLES.map(r=><option key={r.role} value={r.role}>{r.icon} {r.nome}</option>)}
            </select>
          </div>
          <div style={{fontSize:9,color:TXD,marginTop:6}}>{ROLES.find(r=>r.role===u.role)?.desc}</div>
          <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:TXD}}>Empresas:</span>
            {uComps.length===0&&<span style={{fontSize:10,color:Y,fontStyle:"italic"}}>Nenhuma empresa vinculada</span>}
            {uComps.map(cid=>{const emp=empresas.find(e=>e.id===cid);return emp?<span key={cid} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:G+"20",color:G,border:`1px solid ${G}30`}}>{emp.nome_fantasia||emp.razao_social}</span>:null;})}
            <button onClick={()=>setEditingUser(isEditing?null:u.id)} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}`,cursor:"pointer"}}>{isEditing?"Fechar":"Gerenciar"}</button>
          </div>
          {isEditing&&(
            <div style={{marginTop:8,background:BG3,borderRadius:8,padding:10,borderLeft:`3px solid #C8941A`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:10,fontWeight:600,color:GO}}>Empresas que este usuário pode acessar:</span>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>vincularTodas(u.id)} style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:G+"20",color:G,border:`1px solid ${G}30`,cursor:"pointer"}}>✅ Vincular todas</button>
                  <button onClick={async()=>{if(!confirm("Remover TODOS os acessos?"))return;await supabase.from("user_companies").delete().eq("user_id",u.id);setUserComps(userComps.filter(uc=>uc.user_id!==u.id));setMsg("Todos os acessos removidos!");}} style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:R+"20",color:R,border:`1px solid ${R}30`,cursor:"pointer"}}>🚫 Remover todos</button>
                </div>
              </div>
              {grupos.length>0&&(
                <div style={{marginBottom:10,padding:"8px 10px",background:BG2,borderRadius:8,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXM,fontWeight:600,marginBottom:6}}>📁 VINCULAR POR GRUPO</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {grupos.map(g=>{const gc=empresas.filter(e=>e.group_id===g.id);const allL=gc.every(e=>uComps.includes(e.id));const someL=gc.some(e=>uComps.includes(e.id));return(
                      <button key={g.id} onClick={()=>allL?desvincularGrupo(u.id,g.id):vincularGrupo(u.id,g.id)} style={{padding:"6px 14px",borderRadius:8,fontSize:10,cursor:"pointer",fontWeight:600,background:allL?G+"15":someL?Y+"15":"transparent",border:`1px solid ${allL?G:someL?Y:BD}40`,color:allL?G:someL?Y:TXM}}>{allL?"✅":"📁"} {g.nome} ({gc.length})</button>
                    );})}
                  </div>
                </div>
              )}
              {empresas.map(emp=>{const linked=uComps.includes(emp.id);const pb=getPlanBadge(emp.plano||"erp_cs");return(
                <div key={emp.id} onClick={()=>toggleUserCompany(u.id,emp.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",marginBottom:2,borderRadius:6,cursor:"pointer",background:linked?G+"10":"transparent",border:`1px solid ${linked?G+"30":BD}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14,color:linked?G:TXD}}>{linked?"✓":"○"}</span>
                    <span style={{fontSize:11,color:linked?TX:TXM}}>{emp.nome_fantasia||emp.razao_social}</span>
                    <span style={{fontSize:7,padding:"1px 6px",borderRadius:4,background:pb.cor+"12",color:pb.cor}}>{pb.icon}</span>
                  </div>
                  <span style={{fontSize:9,color:TXD}}>{emp.cnpj||""}</span>
                </div>
              );})}
            </div>
          )}
        </div>);
      })}
    </div>)}

    {/* ═══ CONVITES ═══ */}
    {tab==="convites"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Convidar usuário</div>
        <button onClick={()=>setShowInvite(!showInvite)} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Gerar Convite</button>
      </div>
      {showInvite&&(
        <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:10,border:`1px solid ${BD}`}}>
          <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:10}}>Gerar Link de Convite</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>📁 Grupo</div>
            <select value={selectedGroup} onChange={e=>{setSelectedGroup(e.target.value);if(e.target.value)setSelectedCompany("");}} style={{...inp,borderColor:selectedGroup?G:""}}>
              <option value="">— Empresa individual —</option>
              {grupos.map(g=>{const cnt=empresas.filter(e=>e.group_id===g.id).length;return <option key={g.id} value={g.id}>📁 {g.nome} ({cnt})</option>;})}
            </select></div>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>🏢 Empresa</div>
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
          <button onClick={gerarConvite} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Gerar Link</button>
          {generatedLink&&(
            <div style={{marginTop:12,background:BG3,borderRadius:8,padding:12,border:`1px solid ${G}`}}>
              <div style={{fontSize:10,fontWeight:600,color:G,marginBottom:6}}>Link gerado!</div>
              <div style={{display:"flex",gap:8}}>
                <input value={generatedLink} readOnly style={{...inp,flex:1,fontSize:10}}/>
                <button onClick={()=>{navigator.clipboard.writeText(generatedLink);setCopied(true);setTimeout(()=>setCopied(false),3000);}} style={{padding:"8px 14px",borderRadius:6,background:copied?G:"#C8941A",color:"#FFF",border:"none",fontSize:11,fontWeight:600,cursor:"pointer"}}>{copied?"✓ Copiado!":"Copiar"}</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,marginBottom:8}}>
        <div style={{fontSize:12,fontWeight:600,color:TX}}>Convites recentes</div>
        <button onClick={async()=>{if(!confirm("Excluir convites pendentes?"))return;await supabase.from("invites").delete().eq("is_used",false);setConvites(prev=>prev.filter(c=>c.is_used));setMsg("Convites pendentes excluídos!");}} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:R+"15",border:`1px solid ${R}30`,color:R,cursor:"pointer"}}>🗑 Limpar pendentes</button>
      </div>
      {convites.map((inv,i)=>(
        <div key={inv.id||i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,border:`1px solid ${BD}`,borderLeft:`3px solid ${inv.is_used?G:getRC(inv.role)}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:12,fontWeight:600,color:TX}}>{inv.companies?.nome_fantasia||inv.companies?.razao_social||"Grupo"}</div>
            <div style={{fontSize:9,color:TXD}}>{inv.email||"Sem e-mail"} | <span style={{color:getRC(inv.role),fontWeight:600}}>{getRN(inv.role)}</span> | {new Date(inv.created_at).toLocaleDateString("pt-BR")}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:inv.is_used?G+"20":Y+"20",color:inv.is_used?G:Y,fontWeight:600}}>{inv.is_used?"Usado":"Pendente"}</span>
              <button onClick={async()=>{if(!confirm("Excluir?"))return;await supabase.from("invites").delete().eq("id",inv.id);setConvites(prev=>prev.filter(c=>c.id!==inv.id));setMsg("Excluído!");}} style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:R+"10",border:`1px solid ${R}25`,color:R,cursor:"pointer"}}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>)}

    {/* ═══ MAPA DE PERMISSÕES ═══ */}
    {tab==="niveis"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:14}}>Permissões por Plano — Módulos e Roles</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:16}}>
        {(Object.entries(PLANOS) as [Plano,any][]).map(([k,p])=>(
          <div key={k} style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${p.cor}`}}>
            <div style={{fontSize:9,color:TXD}}>{p.icon} {p.nome}</div>
            <div style={{fontSize:13,fontWeight:600,color:p.cor}}>{p.preco.split("/")[0]}</div>
            <div style={{fontSize:8,color:TXM}}>{Object.values(PLANO_MODULOS).filter(m=>m[k]==="full").length} módulos</div>
          </div>
        ))}
      </div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
            <th style={{padding:"10px 12px",textAlign:"left",color:GO,fontSize:10,width:200}}>Módulo</th>
            {(Object.entries(PLANOS) as [Plano,any][]).map(([k,p])=>(<th key={k} style={{padding:"8px 4px",textAlign:"center",color:p.cor,fontSize:8,lineHeight:1.3}}>{p.nome.split(" ").slice(0,2).join(" ")}</th>))}
          </tr></thead>
          <tbody>
            {[{section:"CORE"},{mod:"visao-diaria",nome:"Visão Diária"},{mod:"dados",nome:"Dados"},{mod:"importar",nome:"Importar"},{mod:"ajuda",nome:"Ajuda"},
              {section:"GESTÃO"},{mod:"operacional",nome:"Operacional"},{mod:"rateio",nome:"Rateio"},{mod:"orcamento",nome:"Orçamento"},{mod:"viabilidade",nome:"Viabilidade"},
              {section:"INTELIGÊNCIA"},{mod:"consultor-ia",nome:"Consultor IA"},{mod:"contador",nome:"Contador"},{mod:"assessor",nome:"PS Assessor"},{mod:"anti-fraude-basico",nome:"Anti-Fraude"},{mod:"custeio",nome:"Custeio"},
              {section:"EXCLUSIVOS"},{mod:"ficha-tecnica",nome:"Ficha Técnica"},{mod:"industrial",nome:"Industrial"},{mod:"custo",nome:"Custo"},{mod:"noc",nome:"NOC"},{mod:"wealth",nome:"Wealth"},{mod:"producao",nome:"Produção"},
            ].map((row,i)=>{
              if("section" in row)return(<tr key={i}><td colSpan={8} style={{padding:"8px 12px",fontSize:9,fontWeight:700,color:GO,background:BG3,borderTop:`1px solid ${BD}`}}>{row.section}</td></tr>);
              const perms=PLANO_MODULOS[row.mod!]||{};
              return(<tr key={i} style={{borderBottom:`0.5px solid ${BD}`}}>
                <td style={{padding:"6px 12px",fontWeight:500,color:TX,fontSize:11}}>{row.nome}</td>
                {(Object.keys(PLANOS) as Plano[]).map(plan=>{const a=perms[plan]||"none";return(
                  <td key={plan} style={{padding:6,textAlign:"center"}}><span style={{display:"inline-block",padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:600,background:a==="full"?G+"18":a==="addon"?Y+"18":R+"10",color:a==="full"?G:a==="addon"?Y:R,minWidth:28}}>{a==="full"?"✓":a==="addon"?"🔒":"✕"}</span></td>
                );})}
              </tr>);
            })}
          </tbody>
        </table>
      </div>

      <div style={{fontSize:14,fontWeight:600,color:TX,marginTop:24,marginBottom:12}}>Plano por Empresa</div>
      <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`}}>
        {empresas.map((c:any)=>{const pb=getPlanBadge(c.plano||"erp_cs");return(
          <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`0.5px solid ${BD}`}}>
            <div><span style={{fontSize:12,fontWeight:500,color:TX}}>{c.nome_fantasia||c.razao_social}</span><span style={{fontSize:9,color:TXD,marginLeft:8}}>{c.cnpj}</span></div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:pb.cor+"18",color:pb.cor,fontWeight:600}}>{pb.icon} {pb.nome}</span>
              <select value={c.plano||"erp_cs"} onChange={e=>atualizarPlano(c.id,e.target.value)} style={{fontSize:10,padding:"3px 6px",borderRadius:6,background:BG3,color:TX,border:`1px solid ${BD}`}}>
                {(Object.entries(PLANOS) as [string,any][]).map(([k,v])=>(<option key={k} value={k}>{v.icon} {v.nome}</option>))}
              </select>
            </div>
          </div>
        );})}
      </div>
    </div>)}

    {/* ═══ SEGURANÇA (mantido igual, cores adaptadas) ═══ */}
    {tab==="seguranca"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:14}}>Restrições de Horário e Segurança por Role</div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto",marginBottom:16}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
            <th style={{padding:"10px 12px",textAlign:"left",color:GO,fontSize:10}}>Role</th>
            <th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Horário</th>
            <th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Dias</th>
            <th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Timeout</th>
            <th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Ativo</th>
            <th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Ações</th>
          </tr></thead>
          <tbody>
            {ROLES.map(r=>{
              const cfg=accessConfigs.find((a:any)=>a.role===r.role);const inicio=cfg?.horario_inicio||"00:00";const fim=cfg?.horario_fim||"23:59";const timeout=cfg?.timeout_minutos||30;const ativo=cfg?.ativo!==false;const isAdmR=r.role==="adm"||r.role==="adm_investimentos"||r.role==="acesso_total";
              return(
                <tr key={r.role} style={{borderBottom:`0.5px solid ${BD}`,opacity:isAdmR?0.5:1}}>
                  <td style={{padding:"8px 12px"}}><span style={{color:r.cor,marginRight:6}}>{r.icon}</span><span style={{fontWeight:500,color:TX}}>{r.nome}</span>{isAdmR&&<span style={{fontSize:8,color:TXD,marginLeft:6}}>(sem restrição)</span>}</td>
                  <td style={{padding:6,textAlign:"center"}}>{!isAdmR?(<div style={{display:"flex",gap:4,justifyContent:"center",alignItems:"center"}}><input type="time" defaultValue={inicio} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:10,width:70}} data-role={r.role} data-field="horario_inicio"/><span style={{color:TXD,fontSize:9}}>-</span><input type="time" defaultValue={fim} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:10,width:70}} data-role={r.role} data-field="horario_fim"/></div>):<span style={{color:TXD,fontSize:10}}>24h</span>}</td>
                  <td style={{padding:6,textAlign:"center"}}>{!isAdmR?(<select defaultValue={(cfg?.dias_semana||["seg","ter","qua","qui","sex","sab","dom"]).join(",")} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:9}} data-role={r.role} data-field="dias_semana"><option value="seg,ter,qua,qui,sex">Seg-Sex</option><option value="seg,ter,qua,qui,sex,sab">Seg-Sáb</option><option value="seg,ter,qua,qui,sex,sab,dom">Todos</option></select>):<span style={{color:TXD,fontSize:10}}>7 dias</span>}</td>
                  <td style={{padding:6,textAlign:"center"}}>{!isAdmR?(<select defaultValue={String(timeout)} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"2px 4px",fontSize:9}} data-role={r.role} data-field="timeout_minutos"><option value="0">Sem timeout</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hora</option><option value="120">2 horas</option><option value="480">8 horas</option></select>):<span style={{color:TXD,fontSize:10}}>Nunca</span>}</td>
                  <td style={{padding:6,textAlign:"center"}}>{!isAdmR&&(<div onClick={async()=>{if(cfg){await supabase.from("access_config").update({ativo:!ativo}).eq("id",cfg.id);}else{await supabase.from("access_config").insert({role:r.role,ativo:!ativo});}loadData();}} style={{width:36,height:20,borderRadius:10,background:ativo?G:"#9C8E80",cursor:"pointer",position:"relative",transition:"background 0.2s",margin:"0 auto"}}><div style={{width:16,height:16,borderRadius:8,background:"white",position:"absolute",top:2,left:ativo?18:2,transition:"left 0.2s"}}/></div>)}</td>
                  <td style={{padding:6,textAlign:"center"}}>{!isAdmR&&(<button onClick={async()=>{const hi=(document.querySelector(`[data-role="${r.role}"][data-field="horario_inicio"]`) as HTMLInputElement)?.value||"00:00";const hf=(document.querySelector(`[data-role="${r.role}"][data-field="horario_fim"]`) as HTMLInputElement)?.value||"23:59";const ds=((document.querySelector(`[data-role="${r.role}"][data-field="dias_semana"]`) as HTMLSelectElement)?.value||"seg,ter,qua,qui,sex,sab,dom").split(",");const tm=parseInt((document.querySelector(`[data-role="${r.role}"][data-field="timeout_minutos"]`) as HTMLSelectElement)?.value||"30");const data={role:r.role,horario_inicio:hi,horario_fim:hf,dias_semana:ds,timeout_minutos:tm,ativo:true};if(cfg){await supabase.from("access_config").update(data).eq("id",cfg.id);}else{await supabase.from("access_config").insert(data);}setMsg("Regra salva para "+r.nome);loadData();}} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:GO+"15",border:`1px solid ${GO}`,color:GO,cursor:"pointer"}}>Salvar</button>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>)}

    {/* ═══ AUDITORIA ═══ */}
    {tab==="auditoria"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:12}}>Sessões Ativas</div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,marginBottom:20,overflow:"auto"}}>
        {sessions.length===0?(<div style={{padding:20,textAlign:"center",color:TXD,fontSize:12}}>Nenhuma sessão ativa.</div>):(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{borderBottom:`2px solid ${BD}`}}><th style={{padding:"10px 12px",textAlign:"left",color:GO,fontSize:10}}>Usuário</th><th style={{padding:8,textAlign:"left",color:GO,fontSize:10}}>Dispositivo</th><th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Status</th><th style={{padding:8,textAlign:"center",color:GO,fontSize:10}}>Login</th></tr></thead>
            <tbody>{sessions.map((s:any,i:number)=>(<tr key={i} style={{borderBottom:`0.5px solid ${BD}`}}><td style={{padding:"8px 12px",fontWeight:500,color:TX}}>{s.user_email?.split("@")[0]||"?"}</td><td style={{padding:8,color:TXM,fontSize:10}}>{s.device||"?"}</td><td style={{padding:8,textAlign:"center"}}><span style={{fontSize:9,padding:"2px 8px",borderRadius:6,fontWeight:600,background:s.status==="ativo"?G+"18":Y+"18",color:s.status==="ativo"?G:Y}}>{s.status==="ativo"?"Ativo":s.status}</span></td><td style={{padding:8,textAlign:"center",color:TXD,fontSize:10}}>{new Date(s.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</td></tr>))}</tbody>
          </table>
        )}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Log de Auditoria</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {["","login","logout","page_visit","access_blocked"].map(f=>(<button key={f} onClick={()=>setAuditFilter(f)} style={{fontSize:9,padding:"4px 10px",borderRadius:6,cursor:"pointer",background:auditFilter===f?GO+"15":"transparent",border:`1px solid ${auditFilter===f?GO:BD}`,color:auditFilter===f?GO:TXM}}>{f||"Todos"}</button>))}
          <button onClick={loadData} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:BL+"15",border:`1px solid ${BL}30`,color:BL,cursor:"pointer"}}>Atualizar</button>
        </div>
      </div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden",maxHeight:500,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}><tr style={{borderBottom:`2px solid ${BD}`}}><th style={{padding:"8px 12px",textAlign:"left",color:GO,fontSize:9}}>Hora</th><th style={{padding:8,textAlign:"left",color:GO,fontSize:9}}>Usuário</th><th style={{padding:8,textAlign:"left",color:GO,fontSize:9}}>Ação</th><th style={{padding:8,textAlign:"left",color:GO,fontSize:9}}>Detalhe</th></tr></thead>
          <tbody>{auditLogs.filter((l:any)=>!auditFilter||l.action===auditFilter).map((l:any,i:number)=>{const ac:any={"login":G,"logout":Y,"page_visit":BL,"access_blocked":R};return(<tr key={i} style={{borderBottom:`0.5px solid ${BD}`}}><td style={{padding:"6px 12px",color:TXD,fontSize:10,whiteSpace:"nowrap"}}>{new Date(l.created_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})} {new Date(l.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</td><td style={{padding:6,color:BL,fontWeight:500,fontSize:10}}>{l.user_email?.split("@")[0]||"sistema"}</td><td style={{padding:6}}><span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:(ac[l.action]||TXD)+"18",color:ac[l.action]||TXD,fontWeight:600}}>{l.action}</span></td><td style={{padding:6,color:TXM,fontSize:9,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.detail||l.module||"—"}</td></tr>);})}</tbody>
        </table>
        {auditLogs.length===0&&<div style={{padding:20,textAlign:"center",color:TXD,fontSize:12}}>Nenhum registro.</div>}
      </div>
    </div>)}

    <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:24}}>PS Gestão e Capital — Painel Administrativo v9.0</div>
  </div>);
}
