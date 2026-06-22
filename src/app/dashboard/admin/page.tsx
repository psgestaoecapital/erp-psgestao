"use client";
import { Fragment, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import AreasContratadasModal from "@/components/admin/AreasContratadasModal";
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
  // ADMIN-AREAS-DINAMICAS-v1: aba "📂 Áreas" · le area_menu_config via RPCs
  const [areasSubTab,setAreasSubTab]=useState<"empresa"|"usuario">("empresa");
  const [areaCompanyId,setAreaCompanyId]=useState<string>("");
  const [areaUserId,setAreaUserId]=useState<string>("");
  const [areasEmpresa,setAreasEmpresa]=useState<any[]>([]);
  const [areasUsuario,setAreasUsuario]=useState<any[]>([]);
  const [areasLoading,setAreasLoading]=useState(false);
  const [areasError,setAreasError]=useState<string|null>(null);
  const [showForm,setShowForm]=useState(false);
  const [showInvite,setShowInvite]=useState(false);
  const [selectedCompany,setSelectedCompany]=useState("");
  const [selectedGroup,setSelectedGroup]=useState("");
  const [inviteRole,setInviteRole]=useState("socio");
  const [inviteEmail,setInviteEmail]=useState("");
  const [generatedLink,setGeneratedLink]=useState("");
  const [copied,setCopied]=useState(false);
  // RD-41 · escopo de area no convite. Teto = areas habilitadas da empresa.
  // inviteAreasAll=true (default) envia areas_liberadas=null (sem restricao).
  type InviteArea={area_slug:string;nome_menu:string};
  const [inviteAreasTeto,setInviteAreasTeto]=useState<InviteArea[]>([]);
  const [inviteAreasSel,setInviteAreasSel]=useState<Set<string>>(new Set());
  const [inviteAreasAll,setInviteAreasAll]=useState(true);
  const [inviteAreasLoading,setInviteAreasLoading]=useState(false);
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
  // admin-escopado-dono · CLIENT_OWNER pode abrir /admin (escopado a sua empresa)
  const [ownerScoped,setOwnerScoped]=useState(false);
  const [ownerCompanyIds,setOwnerCompanyIds]=useState<string[]>([]);
  const [grupos,setGrupos]=useState<any[]>([]);
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({});
  const [showNewGroup,setShowNewGroup]=useState(false);
  const [newGroupName,setNewGroupName]=useState("");
  const [newGroupCor,setNewGroupCor]=useState("#C8941A");
  const [movingEmpresa,setMovingEmpresa]=useState<string|null>(null);
  // empresa-habilitar-areas · modal de areas contratadas por empresa
  const [areasModalEmp,setAreasModalEmp]=useState<{id:string;nome:string}|null>(null);
  // badge-empresa-areas-reais · mapa company_id -> areas contratadas (chips)
  type AreaChip={area_slug:string;nome_menu:string;ordem:number};
  const [areasByCompany,setAreasByCompany]=useState<Map<string,AreaChip[]>>(new Map());
  // saneamento-verticais · planos vivos lidos do plan_catalog (ativo=true, legacy=false)
  // agrupados por vertical · ate aqui a lista estava hardcoded em PLANOS.
  const [planCat,setPlanCat]=useState<Array<{id:string;nome:string;vertical:string|null;preco_min?:number|null;preco_max?:number|null}>>([]);
  // mapa-permissoes-catalogo-novo · modulos + plan_modules pra matriz
  const [moduleCat,setModuleCat]=useState<Array<{id:string;nome:string;grupo:string|null;ordem:number|null}>>([]);
  const [planModulesSet,setPlanModulesSet]=useState<Map<string,Set<string>>>(new Map());
  const groupColors=["#C8941A","#FF9800","#4CAF50","#3B82F6","#A855F7","#EF4444","#14B8A6","#FF5722","#8BC34A","#E91E63"];

  // ═══ Screen Watcher + Visual Truth (M.A.7.5.1) ═══
  const [screens,setScreens]=useState<any[]>([]);
  const [screenLoading,setScreenLoading]=useState(false);
  const [filtroArea,setFiltroArea]=useState("");
  const [filtroPrioridade,setFiltroPrioridade]=useState("");
  const [rotaDetail,setRotaDetail]=useState<any>(null);
  const [capturandoNow,setCapturandoNow]=useState(false);
  const [vtStatus,setVtStatus]=useState<any>(null);
  const [vtAlerts,setVtAlerts]=useState<any[]>([]);
  // ═══ PR-SW · Screen Watcher Hierarquico (Area > Modulo > Tela) ═══
  const [swHier,setSwHier]=useState<any>(null);
  const [swHierLoading,setSwHierLoading]=useState(false);
  const [swAreasExpand,setSwAreasExpand]=useState<Set<string>>(new Set(['gestao_empresarial']));
  const [swModulosExpand,setSwModulosExpand]=useState<Set<string>>(new Set());
  const [swSoComScreenshot,setSwSoComScreenshot]=useState(false);

  useEffect(()=>{checkAuth();},[]);
  // admin-escopado-dono · trava empresa selecionada para o dono
  useEffect(()=>{
    if(ownerScoped&&ownerCompanyIds.length>0&&!selectedCompany) setSelectedCompany(ownerCompanyIds[0]);
    if(ownerScoped&&!["socio","financeiro","operacional","visualizador"].includes(inviteRole)) setInviteRole("socio");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ownerScoped,ownerCompanyIds]);

  useEffect(()=>{
    if(!isAuthorized) return;
    if(tab==="screen_watcher"&&screens.length===0) loadScreens();
    if(tab==="visual_truth"&&!vtStatus) loadVisualTruth();
  },[tab,isAuthorized]);

  const checkAuth=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setCheckingAuth(false);return;}
    const{data:up}=await supabase.from("users").select("role,system_role").eq("id",user.id).single();
    const isSystemAdmin=up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"||!!up?.system_role;
    // Dono de empresa? (CLIENT_OWNER ativo) — RLS tur_self_read permite ler o proprio papel
    const{data:ownerRoles}=await supabase.from("tenant_user_roles").select("company_id").eq("user_id",user.id).eq("role","CLIENT_OWNER").eq("is_active",true);
    const ownerIds=(ownerRoles??[]).map((r:any)=>r.company_id);
    const isOwner=ownerIds.length>0;
    if(isSystemAdmin||isOwner){
      const scoped=isOwner&&!isSystemAdmin;
      setIsAuthorized(true);
      setOwnerScoped(scoped);
      setOwnerCompanyIds(ownerIds);
      setCurrentEmail(user.email||"");
      if(scoped) setTab("usuarios");
      loadData(scoped,ownerIds);
    }
    setCheckingAuth(false);
  };

  const loadData=async(scopedArg?:boolean,ownIdsArg?:string[])=>{
    const scoped=scopedArg??ownerScoped;
    const ownIds=ownIdsArg??ownerCompanyIds;
    let empQ=supabase.from("companies").select("*").order("nome_fantasia");
    if(scoped&&ownIds.length>0) empQ=empQ.in("id",ownIds);
    const{data:emp}=await empQ;
    if(emp)setEmpresas(emp);
    let invQ=supabase.from("invites").select("*,companies(nome_fantasia,razao_social)").order("created_at",{ascending:false}).limit(20);
    if(scoped&&ownIds.length>0) invQ=invQ.in("company_id",ownIds);
    const{data:inv}=await invQ;
    if(inv)setConvites(inv);
    const{data:uc}=await supabase.from("user_companies").select("*");
    if(uc)setUserComps(uc);
    const{data:usr}=await supabase.from("users").select("*").order("created_at",{ascending:false});
    if(usr){
      if(scoped&&ownIds.length>0){
        const allowed=new Set((uc??[]).filter((x:any)=>ownIds.includes(x.company_id)).map((x:any)=>x.user_id));
        setUsuarios(usr.filter((u:any)=>allowed.has(u.id)));
      } else setUsuarios(usr);
    }
    const{data:grps}=await supabase.from("company_groups").select("*").order("nome");
    if(grps)setGrupos(grps);
    const{data:ac}=await supabase.from("access_config").select("*").order("role");
    if(ac)setAccessConfigs(ac);
    try{const res=await fetch("/api/audit?limit=100");const d=await res.json();if(d.success){setAuditLogs(d.logs||[]);setSessions(d.sessions||[]);}}catch{}
    // saneamento-verticais · planos vivos pro dropdown de empresas
    const{data:pc}=await supabase.from("plan_catalog").select("id,nome,vertical,prioridade_comercial,preco_min,preco_max").eq("ativo",true).eq("legacy",false).order("vertical",{ascending:true}).order("prioridade_comercial",{ascending:true,nullsFirst:false});
    if(pc)setPlanCat(pc as any);
    // mapa-permissoes-catalogo-novo · modulos + plan_modules pra matriz
    const[mcR,pmR]=await Promise.all([
      supabase.from("module_catalog").select("id,nome,grupo,ordem").eq("ativo",true).order("grupo",{ascending:true}).order("ordem",{ascending:true,nullsFirst:false}),
      supabase.from("plan_modules").select("plan_id,module_id"),
    ]);
    if(mcR.data)setModuleCat(mcR.data as any);
    if(pmR.data){
      const m=new Map<string,Set<string>>();
      (pmR.data as Array<{plan_id:string;module_id:string}>).forEach(r=>{
        if(!m.has(r.plan_id))m.set(r.plan_id,new Set());
        m.get(r.plan_id)!.add(r.module_id);
      });
      setPlanModulesSet(m);
    }
    // badge-empresa-areas-reais · carrega areas contratadas (1 query batch)
    await loadAreasContratadas();
  };

  // Computa areas contratadas por empresa a partir de tenant_subscriptions + area_menu_config.
  // Mesma logica do fn_empresa_areas_status mas em batch (1 query · evita N RPCs).
  const loadAreasContratadas=async()=>{
    const[tsR,amcR,pcAll]=await Promise.all([
      supabase.from("tenant_subscriptions").select("company_id,plan_id").eq("status","active"),
      supabase.from("area_menu_config").select("area_slug,nome_menu,ordem,plano_principal_id").eq("ativo",true).order("ordem"),
      supabase.from("plan_catalog").select("id,vertical"),
    ]);
    const ts=(tsR.data??[]) as Array<{company_id:string;plan_id:string}>;
    const amc=(amcR.data??[]) as Array<{area_slug:string;nome_menu:string;ordem:number;plano_principal_id:string|null}>;
    const planosAll=(pcAll.data??[]) as Array<{id:string;vertical:string|null}>;
    const verticalDe=new Map(planosAll.map(p=>[p.id,p.vertical]));
    // multi: vertical com >1 area no amc
    const areaCountPorVert=new Map<string,number>();
    amc.forEach(a=>{
      if(!a.plano_principal_id)return;
      const v=verticalDe.get(a.plano_principal_id);
      if(!v)return;
      areaCountPorVert.set(v,(areaCountPorVert.get(v)??0)+1);
    });
    const out=new Map<string,AreaChip[]>();
    ts.forEach(sub=>{
      const subVert=verticalDe.get(sub.plan_id);
      if(!subVert)return;
      const isMulti=(areaCountPorVert.get(subVert)??0)>1;
      const matches=amc.filter(a=>{
        if(!a.plano_principal_id)return false;
        const av=verticalDe.get(a.plano_principal_id);
        if(av!==subVert)return false;
        if(isMulti)return a.plano_principal_id===sub.plan_id;
        return true;
      });
      const list=out.get(sub.company_id)??[];
      matches.forEach(a=>{
        if(!list.some(x=>x.area_slug===a.area_slug))list.push({area_slug:a.area_slug,nome_menu:a.nome_menu,ordem:a.ordem});
      });
      out.set(sub.company_id,list);
    });
    out.forEach(l=>l.sort((a,b)=>a.ordem-b.ordem));
    setAreasByCompany(out);
  };

  // Render dos chips de areas contratadas pra uma empresa.
  // Fallback "Sem area contratada" quando nenhuma · NUNCA "Comercio & Servicos".
  const ChipsAreas=({companyId,max=3}:{companyId:string;max?:number})=>{
    const areas=areasByCompany.get(companyId)??[];
    if(areas.length===0){
      return <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:"rgba(61,35,20,0.08)",color:TXM,fontWeight:500,whiteSpace:"nowrap"}}>Sem área contratada</span>;
    }
    const visiveis=areas.slice(0,max);
    const sobra=areas.length-visiveis.length;
    return(<>
      {visiveis.map(a=>(
        <span key={a.area_slug} style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:"#FAEEDA",color:"#854F0B",fontWeight:600,whiteSpace:"nowrap"}}>{a.nome_menu}</span>
      ))}
      {sobra>0&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:"rgba(133,79,11,0.10)",color:"#854F0B",fontWeight:600,whiteSpace:"nowrap"}}>+{sobra}</span>}
    </>);
  };

  // agrupa plan_catalog por vertical para optgroup. mantem ordem estavel.
  const planosPorVertical=()=>{
    const grupos=new Map<string,Array<{id:string;nome:string}>>();
    planCat.forEach(p=>{
      const v=p.vertical||"sem_vertical";
      if(!grupos.has(v))grupos.set(v,[]);
      grupos.get(v)!.push({id:p.id,nome:p.nome});
    });
    return Array.from(grupos.entries());
  };
  const VERTICAL_LABELS:Record<string,string>={
    gestao_empresarial:"Gestão Empresarial",
    bpo:"BPO Financeiro",
    oficina:"Oficina",
    pm:"P&M",
    industrial:"Industrial",
    hub:"Hub Projetos",
    wealth:"Wealth",
    agro:"Agro",
    compliance:"Compliance",
    custeio:"Custeio",
    odonto:"Clínica Odontológica",
    medica:"Clínica Médica",
    sem_vertical:"Outros",
  };
  // mostra fallback (id-only) se o plano atual nao esta na lista (ex: legacy)
  const PlanoOpcoes=({selected}:{selected:string})=>{
    const grupos=planosPorVertical();
    const idsConhecidos=new Set(planCat.map(p=>p.id));
    return(<>
      {!idsConhecidos.has(selected)&&selected&&<option value={selected}>{selected} (legado)</option>}
      {grupos.map(([vert,planos])=>(
        <optgroup key={vert} label={VERTICAL_LABELS[vert]||vert}>
          {planos.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
        </optgroup>
      ))}
    </>);
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

  // RD-41 · ao trocar de empresa no form de convite, carrega teto de areas
  // (fn_empresa_areas_status, mesma fonte do admin). Grupos: oculta seletor
  // (cada empresa do grupo tem teto distinto · escopo so para empresa unica).
  useEffect(()=>{
    if(!showInvite||selectedGroup||!selectedCompany){
      setInviteAreasTeto([]);setInviteAreasSel(new Set());setInviteAreasAll(true);return;
    }
    let cancelled=false;
    (async()=>{
      setInviteAreasLoading(true);
      const{data,error}=await supabase.rpc('fn_empresa_areas_status',{p_company_id:selectedCompany});
      if(cancelled)return;
      if(error||!data){setInviteAreasTeto([]);setInviteAreasSel(new Set());setInviteAreasLoading(false);return;}
      const teto=(data as any[]).filter(a=>a.habilitada).sort((a,b)=>(a.ordem??0)-(b.ordem??0))
        .map(a=>({area_slug:a.area_slug,nome_menu:a.nome_menu}));
      setInviteAreasTeto(teto);
      setInviteAreasSel(new Set(teto.map(t=>t.area_slug)));
      setInviteAreasAll(true);
      setInviteAreasLoading(false);
    })();
    return()=>{cancelled=true;};
  },[selectedCompany,selectedGroup,showInvite]);

  const toggleInviteArea=(slug:string)=>{
    setInviteAreasSel(prev=>{
      const next=new Set(prev);
      if(next.has(slug))next.delete(slug);else next.add(slug);
      setInviteAreasAll(next.size===inviteAreasTeto.length);
      return next;
    });
  };

  const gerarConvite=async()=>{
    if(!selectedCompany&&!selectedGroup){setMsg("Selecione uma empresa ou grupo.");return;}
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    let{data:up}=await supabase.from("users").select("org_id").eq("id",user.id).single();
    const code="conv_"+Math.random().toString(36).substring(2,10)+Date.now().toString(36);
    const inviteData:any={org_id:up?.org_id,email:inviteEmail||null,role:inviteRole,invite_code:code,created_by:user.id};
    if(selectedGroup){inviteData.group_id=selectedGroup;const fc=empresas.find(e=>e.group_id===selectedGroup);inviteData.company_id=fc?.id||null;}else{inviteData.company_id=selectedCompany;}
    // RD-41 · escopo de area. Somente para empresa unica. Todas marcadas = null.
    if(!selectedGroup&&inviteAreasTeto.length>0&&!inviteAreasAll){
      if(inviteAreasSel.size===0){setMsg("Selecione ao menos uma area liberada.");return;}
      inviteData.areas_liberadas=Array.from(inviteAreasSel);
    }
    const{error}=await supabase.from("invites").insert(inviteData);
    if(error){setMsg("Erro: "+error.message);return;}
    setGeneratedLink("https://erp-psgestao.vercel.app/convite?code="+code);setCopied(false);loadData();
  };

  const atualizarRole=async(uid:string,nr:string)=>{await supabase.from("users").update({role:nr}).eq("id",uid);setUsuarios(usuarios.map(u=>u.id===uid?{...u,role:nr}:u));setMsg("Nível atualizado!");};
  const atualizarPlano=async(compId:string,novoPlano:string)=>{await supabase.from("companies").update({plano:novoPlano}).eq("id",compId);setEmpresas(empresas.map(e=>e.id===compId?{...e,plano:novoPlano}:e));setMsg("Plano atualizado!");setTimeout(()=>setMsg(""),3000);};

  // ═══ Screen Watcher RPCs ═══
  const loadScreens=async()=>{
    setScreenLoading(true);
    const{data,error}=await supabase.rpc('fn_admin_screen_watcher_dashboard');
    if(error){setMsg("Erro: "+error.message);}
    if(data)setScreens(Array.isArray(data)?data:[]);
    setScreenLoading(false);
  };
  // PR-SW: hierarquia Area > Modulo > Tela via fn_screen_watcher_hierarquico
  const loadScreensHier=async()=>{
    setSwHierLoading(true);
    const{data,error}=await supabase.rpc('fn_screen_watcher_hierarquico',{
      p_area:filtroArea||null,
      p_modulo:null,
      p_so_com_screenshot:swSoComScreenshot,
    });
    if(error){setMsg("Erro: "+error.message);}
    if(data)setSwHier(data);
    setSwHierLoading(false);
  };
  useEffect(()=>{
    if(tab==='screen_watcher')loadScreensHier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab,filtroArea,swSoComScreenshot]);
  const abrirRota=async(rota:string)=>{
    const{data,error}=await supabase.rpc('fn_admin_screen_watcher_get',{p_rota:rota});
    if(error){setMsg("Erro: "+error.message);return;}
    setRotaDetail(data);
  };
  const capturarAgora=async()=>{
    setCapturandoNow(true);
    const{error}=await supabase.rpc('fn_disparar_screen_watcher');
    if(error){setMsg("Erro ao disparar: "+error.message);}else{setMsg("Captura disparada — resultado em alguns minutos.");}
    setCapturandoNow(false);
    setTimeout(()=>{loadScreens();setMsg("");},6000);
  };
  const loadVisualTruth=async()=>{
    const[s,a]=await Promise.all([
      supabase.rpc('fn_admin_visual_truth_status'),
      supabase.from('visual_truth_alerts').select('*').eq('status','novo').order('created_at',{ascending:false}).limit(50),
    ]);
    if(s.data)setVtStatus(s.data);
    if(a.data)setVtAlerts(a.data);
  };
  const resolverAlerta=async(id:string,novoStatus:'resolvido'|'falso_positivo')=>{
    const{error}=await supabase.from('visual_truth_alerts').update({status:novoStatus,resolved_at:new Date().toISOString()}).eq('id',id);
    if(error){setMsg("Erro: "+error.message);return;}
    setVtAlerts(prev=>prev.filter(x=>x.id!==id));
    setMsg(novoStatus==='resolvido'?"Alerta resolvido.":"Alerta marcado como falso positivo.");
    setTimeout(()=>setMsg(""),3000);
  };

  // ADMIN-AREAS-DINAMICAS-v1: loaders das RPCs ja existentes
  const loadAreasEmpresa=async(cid:string|null)=>{
    setAreasLoading(true);setAreasError(null);
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('fn_listar_areas_visiveis',{p_company_id:cid,p_user_id:user?.id??null});
    if(error){setAreasError(error.message);setAreasEmpresa([]);}
    else{setAreasEmpresa(data??[]);}
    setAreasLoading(false);
  };
  const loadAreasUsuario=async(uid:string)=>{
    setAreasLoading(true);setAreasError(null);
    const{data,error}=await supabase.rpc('fn_areas_visiveis_usuario',{p_user_id:uid});
    if(error){setAreasError(error.message);setAreasUsuario([]);}
    else{setAreasUsuario(data??[]);}
    setAreasLoading(false);
  };
  useEffect(()=>{
    if(tab!=='areas')return;
    if(areasSubTab==='empresa')loadAreasEmpresa(areaCompanyId||null);
    if(areasSubTab==='usuario'&&areaUserId)loadAreasUsuario(areaUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab,areasSubTab,areaCompanyId,areaUserId]);

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  // ═══ EMPRESA ROW — reutilizado em grupos e sem grupo ═══
  const EmpresaRow=({emp,grupoId}:{emp:any;grupoId?:string})=>{
    // badge-empresa-areas-reais: badge "Comercio & Servicos" era hardcoded.
    // Agora chips das areas contratadas reais via tenant_subscriptions.
    return(
      <div style={{padding:"8px 16px 8px 44px",borderBottom:`0.5px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:500,color:TX,marginRight:2}}>{emp.nome_fantasia||emp.razao_social}</span>
            <ChipsAreas companyId={emp.id}/>
          </div>
          <div style={{fontSize:10,color:TXD}}>{emp.cnpj||"Sem CNPJ"} · {emp.cidade_estado||""}</div>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
          <button onClick={()=>setAreasModalEmp({id:emp.id,nome:emp.nome_fantasia||emp.razao_social})} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,color:TXM,fontSize:11,cursor:"pointer",padding:"6px 10px"}} title="Áreas contratadas">⚙️ Áreas</button>
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
      {[{id:"empresas",n:"Empresas"},{id:"usuarios",n:"Usuários & Níveis"},{id:"areas",n:"📂 Áreas"},{id:"convites",n:"Convites"},{id:"niveis",n:"Mapa de Permissões"},{id:"seguranca",n:"Horários & Segurança"},{id:"auditoria",n:"Sessões & Auditoria"},{id:"screen_watcher",n:"📸 Screen Watcher"},{id:"visual_truth",n:"🛡️ Visual Truth"}].filter(t=>!ownerScoped||t.id==="usuarios"||t.id==="convites").map(t=>(
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
                  <PlanoOpcoes selected={newEmp.plano}/>
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
            {!ownerScoped&&(<div><div style={{fontSize:10,color:TXM,marginBottom:3}}>📁 Grupo</div>
            <select value={selectedGroup} onChange={e=>{setSelectedGroup(e.target.value);if(e.target.value)setSelectedCompany("");}} style={{...inp,borderColor:selectedGroup?G:""}}>
              <option value="">— Empresa individual —</option>
              {grupos.map(g=>{const cnt=empresas.filter(e=>e.group_id===g.id).length;return <option key={g.id} value={g.id}>📁 {g.nome} ({cnt})</option>;})}
            </select></div>)}
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>🏢 Empresa</div>
            <select value={selectedCompany} onChange={e=>{setSelectedCompany(e.target.value);if(e.target.value)setSelectedGroup("");}} disabled={!!selectedGroup||ownerScoped} style={{...inp,opacity:(selectedGroup||ownerScoped)?0.7:1}}>
              <option value="">Selecione</option>
              {empresas.map(emp=><option key={emp.id} value={emp.id}>{emp.nome_fantasia||emp.razao_social}</option>)}
            </select></div>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>Nível de Acesso *</div>
            <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{...inp,color:getRC(inviteRole),fontWeight:600}}>
              {ROLES.filter(r=>!ownerScoped||["socio","financeiro","operacional","visualizador"].includes(r.role)).map(r=><option key={r.role} value={r.role}>{r.icon} {r.nome}</option>)}
            </select></div>
            <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>E-mail (opcional)</div>
            <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="email@empresa.com" style={inp}/></div>
          </div>
          {/* RD-41 · escopo de area no convite (apenas empresa unica) */}
          {!selectedGroup&&selectedCompany&&(
            <div style={{marginBottom:12,padding:10,background:BG3,borderRadius:8,border:`1px solid ${BD}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontSize:10,fontWeight:600,color:TXM}}>📂 Áreas liberadas {inviteAreasAll?<span style={{color:G,fontWeight:500}}>(todas habilitadas)</span>:<span style={{color:Y,fontWeight:500}}>({inviteAreasSel.size}/{inviteAreasTeto.length})</span>}</div>
                {inviteAreasTeto.length>0&&(
                  <button type="button" onClick={()=>{if(inviteAreasAll){setInviteAreasSel(new Set());setInviteAreasAll(false);}else{setInviteAreasSel(new Set(inviteAreasTeto.map(t=>t.area_slug)));setInviteAreasAll(true);}}} style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:"transparent",border:`1px solid ${BD}`,color:TXM,cursor:"pointer"}}>{inviteAreasAll?"Limpar":"Marcar todas"}</button>
                )}
              </div>
              {inviteAreasLoading?(
                <div style={{fontSize:10,color:TXD}}>Carregando áreas contratadas...</div>
              ):inviteAreasTeto.length===0?(
                <div style={{fontSize:10,color:TXD}}>Empresa sem áreas habilitadas. Convite ficará sem escopo.</div>
              ):(
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {inviteAreasTeto.map(a=>{const sel=inviteAreasSel.has(a.area_slug);return(
                    <button key={a.area_slug} type="button" onClick={()=>toggleInviteArea(a.area_slug)} style={{fontSize:10,padding:"4px 10px",borderRadius:14,border:`1px solid ${sel?G:BD}`,background:sel?G+"15":"transparent",color:sel?G:TXM,fontWeight:sel?600:500,cursor:"pointer"}}>{sel?"✓":"○"} {a.nome_menu}</button>
                  );})}
                </div>
              )}
              <div style={{fontSize:9,color:TXD,marginTop:6}}>Todas marcadas = acesso integral. Subconjunto = usuário fica restrito às áreas escolhidas (cerca do teto aplicada no consumo).</div>
            </div>
          )}
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
            <div style={{fontSize:9,color:TXD}}>{inv.email||"Sem e-mail"} | <span style={{color:getRC(inv.role),fontWeight:600}}>{getRN(inv.role)}</span> | {new Date(inv.created_at).toLocaleDateString("pt-BR")}</div>
            {/* RD-41 · chips de escopo de area */}
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
              {Array.isArray(inv.areas_liberadas)&&inv.areas_liberadas.length>0?(
                inv.areas_liberadas.map((s:string)=>(<span key={s} style={{fontSize:8,padding:"1px 6px",borderRadius:10,background:Y+"18",color:Y,fontWeight:600,border:`1px solid ${Y}40`}}>📂 {s}</span>))
              ):(
                <span style={{fontSize:8,padding:"1px 6px",borderRadius:10,background:G+"15",color:G,fontWeight:600,border:`1px solid ${G}30`}}>📂 Todas as áreas</span>
              )}
            </div></div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:inv.is_used?G+"20":Y+"20",color:inv.is_used?G:Y,fontWeight:600}}>{inv.is_used?"Usado":"Pendente"}</span>
              <button onClick={async()=>{if(!confirm("Excluir?"))return;await supabase.from("invites").delete().eq("id",inv.id);setConvites(prev=>prev.filter(c=>c.id!==inv.id));setMsg("Excluído!");}} style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:R+"10",border:`1px solid ${R}25`,color:R,cursor:"pointer"}}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>)}

    {/* ═══ MAPA DE PERMISSÕES ═══ */}
    {tab==="niveis"&&(()=>{
      // mapa-permissoes-catalogo-novo · matriz vertical x modulo a partir do catalogo vivo.
      // Colunas: 1 por vertical (planos agrupados por plan_catalog.vertical).
      // Linhas: modulos do module_catalog que aparecem em pelo menos 1 plan_modules de plano ativo+!legacy.
      // Celula: vertical contem o modulo se ANY plano da vertical tem ele em plan_modules.
      const VERT_LABELS:Record<string,string>={
        gestao_empresarial:"Gestão Empresarial",bpo:"BPO Financeiro",oficina:"Oficina",
        pm:"P&M",industrial:"Industrial",hub:"Hub Projetos",wealth:"Wealth MFO",
        agro:"Agro",compliance:"Compliance",custeio:"Custeio",odonto:"Clínica Odontológica",medica:"Clínica Médica",
      };
      const VERT_COLOR="#C8941A";
      // agrupa planos por vertical
      const vertMap=new Map<string,{planos:string[];preco_min:number|null;preco_max:number|null;modules:Set<string>}>();
      planCat.forEach(p=>{
        if(!p.vertical)return;
        if(!vertMap.has(p.vertical))vertMap.set(p.vertical,{planos:[],preco_min:null,preco_max:null,modules:new Set()});
        const v=vertMap.get(p.vertical)!;
        v.planos.push(p.id);
        if(p.preco_min!=null)v.preco_min=v.preco_min==null?p.preco_min:Math.min(v.preco_min,p.preco_min);
        if(p.preco_max!=null)v.preco_max=v.preco_max==null?p.preco_max:Math.max(v.preco_max,p.preco_max);
        const mods=planModulesSet.get(p.id);
        if(mods)mods.forEach(m=>v.modules.add(m));
      });
      const verticais=Array.from(vertMap.entries()).map(([v,d])=>({vertical:v,label:VERT_LABELS[v]||v,...d})).sort((a,b)=>a.label.localeCompare(b.label,"pt-BR"));
      // modulos relevantes: aparecem em ao menos 1 vertical
      const modulosUsadosIds=new Set<string>();
      verticais.forEach(v=>v.modules.forEach(m=>modulosUsadosIds.add(m)));
      const modulosFiltrados=moduleCat.filter(m=>modulosUsadosIds.has(m.id));
      // agrupa por grupo
      const grupoOrder=modulosFiltrados.reduce<Array<{grupo:string;mods:typeof modulosFiltrados}>>((acc,m)=>{
        const g=m.grupo||"outros";
        let bucket=acc.find(x=>x.grupo===g);
        if(!bucket){bucket={grupo:g,mods:[]};acc.push(bucket);}
        bucket.mods.push(m);
        return acc;
      },[]);
      const GRUPO_LABELS:Record<string,string>={
        erp_core:"CORE",erp_ext:"GESTÃO",gestao_empresarial:"Gestão Empresarial",
        industrial:"Industrial",pm:"P&M",hub:"Hub Projetos",oficina:"Oficina",
        bpo:"BPO Financeiro",wealth:"Wealth",compliance:"Compliance",
        custeio_a:"Custeio Sub-A",custeio_b:"Custeio Sub-B",agro:"Agro",
        odonto:"Clínica Odontológica",medica:"Clínica Médica",
        contador:"Contador",assessor:"Assessor",fiscal:"Fiscal",admin:"Admin",dev:"Dev",
      };
      const brl=(n:number|null)=>n==null?null:n.toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
      return(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:14}}>Mapa de Permissões — Verticais × Módulos</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:16}}>
        {verticais.map(v=>{
          const preco=v.preco_min!=null||v.preco_max!=null
            ? (v.preco_min===v.preco_max?brl(v.preco_min):`${brl(v.preco_min)??"—"}–${brl(v.preco_max)??"—"}`)
            : "a definir";
          return(
            <div key={v.vertical} style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${VERT_COLOR}`}}>
              <div style={{fontSize:10,color:TXD,fontWeight:500}}>{v.label}</div>
              <div style={{fontSize:12,fontWeight:600,color:VERT_COLOR}}>{preco}</div>
              <div style={{fontSize:9,color:TXM,marginTop:2}}>{v.modules.size} módulos · {v.planos.length} tier{v.planos.length>1?"s":""}</div>
            </div>
          );
        })}
      </div>
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:Math.max(640,200+verticais.length*64)}}>
          <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
            <th style={{padding:"10px 12px",textAlign:"left",color:GO,fontSize:10,width:220,position:"sticky",left:0,background:BG2}}>Módulo</th>
            {verticais.map(v=>(<th key={v.vertical} style={{padding:"8px 4px",textAlign:"center",color:VERT_COLOR,fontSize:9,lineHeight:1.3,whiteSpace:"nowrap",minWidth:60}}>{v.label}</th>))}
          </tr></thead>
          <tbody>
            {grupoOrder.map(g=>(<Fragment key={g.grupo}>
              <tr><td colSpan={1+verticais.length} style={{padding:"8px 12px",fontSize:9,fontWeight:700,color:GO,background:BG3,borderTop:`1px solid ${BD}`,letterSpacing:.4,textTransform:"uppercase"}}>{GRUPO_LABELS[g.grupo]||g.grupo}</td></tr>
              {g.mods.map(mod=>(
                <tr key={mod.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                  <td style={{padding:"6px 12px",fontWeight:500,color:TX,fontSize:11,position:"sticky",left:0,background:BG2}}>{mod.nome}</td>
                  {verticais.map(v=>{
                    const tem=v.modules.has(mod.id);
                    return(<td key={v.vertical} style={{padding:6,textAlign:"center"}}>
                      <span style={{display:"inline-block",padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:600,background:tem?G+"18":R+"08",color:tem?G:R+"a0",minWidth:28}}>{tem?"✓":"✕"}</span>
                    </td>);
                  })}
                </tr>
              ))}
            </Fragment>))}
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
              <select value={c.plano||""} onChange={e=>atualizarPlano(c.id,e.target.value)} style={{fontSize:10,padding:"3px 6px",borderRadius:6,background:BG3,color:TX,border:`1px solid ${BD}`}}>
                <PlanoOpcoes selected={c.plano||""}/>
              </select>
            </div>
          </div>
        );})}
      </div>
    </div>);})()}

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
          <button onClick={()=>loadData()} style={{fontSize:9,padding:"4px 10px",borderRadius:6,background:BL+"15",border:`1px solid ${BL}30`,color:BL,cursor:"pointer"}}>Atualizar</button>
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

    {/* ═══ SCREEN WATCHER · Hierárquico (PR-SW · Área > Módulo > Tela) ═══ */}
    {tab==="screen_watcher"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>
          📸 Screen Watcher
          {swHier&&<span style={{marginLeft:8,fontSize:11,color:TXM,fontWeight:500}}>· {swHier.total_areas} áreas · {swHier.total_modulos} módulos · {swHier.total_telas} telas</span>}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <select value={filtroArea} onChange={e=>setFiltroArea(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"6px 10px"}}>
            <option value="">Todas áreas</option>
            {(swHier?.areas??[]).map((a:any)=>(<option key={a.area} value={a.area}>{a.area_display||a.area}</option>))}
          </select>
          <label style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,color:TXM,cursor:"pointer"}}>
            <input type="checkbox" checked={swSoComScreenshot} onChange={e=>setSwSoComScreenshot(e.target.checked)} />
            Só com screenshot
          </label>
          <button onClick={loadScreensHier} disabled={swHierLoading} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:11,cursor:"pointer",opacity:swHierLoading?0.5:1}}>{swHierLoading?"Carregando...":"Atualizar"}</button>
          <button onClick={capturarAgora} disabled={capturandoNow} style={{padding:"6px 14px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:11,fontWeight:600,border:"none",cursor:capturandoNow?"wait":"pointer",opacity:capturandoNow?0.6:1}}>{capturandoNow?"Disparando...":"📸 Capturar agora"}</button>
        </div>
      </div>

      {swHierLoading&&!swHier?(
        <div style={{padding:40,textAlign:"center",color:TXD,fontSize:13}}>Carregando árvore de áreas...</div>
      ):!swHier||!swHier.areas||swHier.areas.length===0?(
        <div style={{padding:24,textAlign:"center",color:TXD,fontSize:12,background:BG2,borderRadius:10,border:`1px dashed ${BD}`}}>Nenhuma área retornada. Verifique <code>fn_screen_watcher_hierarquico</code>.</div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {swHier.areas.map((area:any)=>{
            const aberto=swAreasExpand.has(area.area);
            return (
              <div key={area.area} style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
                <button onClick={()=>{const n=new Set(swAreasExpand);if(n.has(area.area))n.delete(area.area);else n.add(area.area);setSwAreasExpand(n);}}
                  style={{width:"100%",padding:"14px 18px",background:aberto?"rgba(200,148,26,0.08)":"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:10,textAlign:"left"}}>
                  <span style={{fontSize:12,color:TXM,width:14,display:"inline-block"}}>{aberto?"▼":"▶"}</span>
                  <span style={{fontSize:20}}>{area.area_icone||"📦"}</span>
                  <span style={{flex:1,fontSize:14,fontWeight:600,color:TX}}>{area.area_display||area.area}</span>
                  <span style={{fontSize:11,color:TXM,background:BG3,padding:"3px 10px",borderRadius:10,fontWeight:600}}>{area.total_telas} telas</span>
                </button>
                {aberto&&(
                  <div style={{padding:"0 14px 14px",display:"flex",flexDirection:"column",gap:8}}>
                    {(area.modulos??[]).map((mod:any)=>{
                      const modKey=`${area.area}::${mod.modulo||"_raiz"}`;
                      const mAberto=swModulosExpand.has(modKey);
                      return (
                        <div key={modKey} style={{background:BG,borderRadius:8,border:`1px solid ${BD}`}}>
                          <button onClick={()=>{const n=new Set(swModulosExpand);if(n.has(modKey))n.delete(modKey);else n.add(modKey);setSwModulosExpand(n);}}
                            style={{width:"100%",padding:"10px 14px",background:"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:8,textAlign:"left",flexWrap:"wrap"}}>
                            <span style={{fontSize:11,color:TXM,width:12,display:"inline-block"}}>{mAberto?"▼":"▶"}</span>
                            {mod.modulo_icone&&<span style={{fontSize:15}}>{mod.modulo_icone}</span>}
                            <span style={{flex:1,fontSize:13,fontWeight:600,color:TX,minWidth:140}}>{mod.modulo_display||"(Painel raiz)"}</span>
                            <span style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                              {mod.qtd_pronto>0&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:G+"22",color:G,fontWeight:700}}>✅ {mod.qtd_pronto}</span>}
                              {mod.qtd_parcial>0&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:GO+"22",color:GO,fontWeight:700}}>🟡 {mod.qtd_parcial}</span>}
                              {mod.qtd_desconhecida>0&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:BG3,color:TXM,fontWeight:700}}>⚠️ {mod.qtd_desconhecida}</span>}
                              {mod.qtd_placeholder>0&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:BG3,color:TXD,fontWeight:700}}>📦 {mod.qtd_placeholder}</span>}
                              <span style={{fontSize:10,color:TXD,padding:"2px 4px"}}>· {mod.qtd_telas}</span>
                            </span>
                          </button>
                          {mAberto&&(
                            <div style={{padding:"0 14px 14px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
                              {(mod.telas??[]).map((t:any)=>{
                                const cor=t.estado_real==="pronto"?G:t.estado_real==="parcial"?GO:t.estado_real==="placeholder"?TXD:BD;
                                return (
                                  <div key={t.id} onClick={()=>abrirRota(t.rota)} style={{background:BG2,border:`1px solid ${cor}`,borderRadius:8,overflow:"hidden",cursor:"pointer"}}>
                                    {t.screenshot_url?(
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={t.screenshot_url} alt={t.titulo||t.rota} loading="lazy" style={{width:"100%",aspectRatio:"16/10",objectFit:"cover",display:"block"}}/>
                                    ):(
                                      <div style={{width:"100%",aspectRatio:"16/10",background:BG3,display:"flex",alignItems:"center",justifyContent:"center",color:TXD,fontSize:10}}>Sem screenshot</div>
                                    )}
                                    <div style={{padding:10}}>
                                      <div style={{fontSize:11,color:TX,marginBottom:3,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.titulo||t.rota}</div>
                                      <div style={{fontSize:9,color:TXD,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.rota}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal detalhe da rota */}
      {rotaDetail&&(
        <div onClick={()=>setRotaDetail(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:BG,borderRadius:12,padding:24,maxWidth:820,width:"100%",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${BD}`,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:14,gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,color:TXD,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>Detalhe da rota</div>
                <div style={{fontSize:16,fontWeight:700,color:TX,fontFamily:"monospace",wordBreak:"break-all"}}>{rotaDetail?.screen?.rota||rotaDetail?.rota||"—"}</div>
              </div>
              <button onClick={()=>setRotaDetail(null)} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 12px",cursor:"pointer",color:TX,fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
            </div>
            {(rotaDetail?.screen?.descricao||rotaDetail?.descricao)&&<div style={{fontSize:12,color:TXM,marginBottom:14,lineHeight:1.5}}>{rotaDetail?.screen?.descricao||rotaDetail?.descricao}</div>}

            {Array.isArray(rotaDetail?.historico)&&rotaDetail.historico.length>0?(
              <div>
                <div style={{fontSize:12,fontWeight:600,color:TX,marginBottom:8}}>Histórico ({rotaDetail.historico.length} {rotaDetail.historico.length===1?"captura":"capturas"})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {rotaDetail.historico.map((h:any,i:number)=>(
                    <div key={i} style={{padding:10,background:BG2,borderRadius:8,border:`1px solid ${BD}`,fontSize:11}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,gap:8,flexWrap:"wrap"}}>
                        <span style={{color:TX,fontWeight:600}}>{new Date(h.captured_at||h.created_at).toLocaleString("pt-BR")}</span>
                        <span style={{color:h.status==="ok"?G:R,fontWeight:600,fontSize:10,textTransform:"uppercase"}}>{h.status||"—"}</span>
                      </div>
                      {h.html_hash&&<div style={{color:TXD,fontSize:9,fontFamily:"monospace",marginBottom:4}}>hash: {String(h.html_hash).substring(0,24)}…</div>}
                      {h.screenshot_url&&<a href={h.screenshot_url} target="_blank" rel="noopener noreferrer" style={{color:GO,fontSize:10,textDecoration:"none",fontWeight:600}}>Ver imagem ↗</a>}
                    </div>
                  ))}
                </div>
              </div>
            ):(
              <div style={{padding:20,textAlign:"center",color:TXD,fontSize:12,background:BG2,borderRadius:8,border:`1px dashed ${BD}`}}>Sem capturas registradas para esta rota.</div>
            )}
          </div>
        </div>
      )}
    </div>)}

    {/* ═══ VISUAL TRUTH (M.A.7.5.1) ═══ */}
    {tab==="visual_truth"&&(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>🛡️ Visual Truth Auditor</div>
        <button onClick={loadVisualTruth} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:11,cursor:"pointer"}}>Atualizar</button>
      </div>

      {vtStatus&&(
        <div style={{background:BG2,border:`2px solid ${vtStatus.alertas_criticos>0?R:vtStatus.alertas_abertos>0?Y:G}`,borderRadius:12,padding:18,marginBottom:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:14}}>
            <div>
              <div style={{fontSize:9,color:TXD,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Regras ativas</div>
              <div style={{fontSize:24,fontWeight:700,color:TX,marginTop:2}}>{vtStatus.regras_ativas??0}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:TXD,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Alertas abertos</div>
              <div style={{fontSize:24,fontWeight:700,color:vtStatus.alertas_abertos>0?Y:G,marginTop:2}}>{vtStatus.alertas_abertos??0}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:TXD,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Críticos</div>
              <div style={{fontSize:24,fontWeight:700,color:vtStatus.alertas_criticos>0?R:G,marginTop:2}}>{vtStatus.alertas_criticos??0}</div>
            </div>
            {vtStatus.ultima_execucao&&(
              <div>
                <div style={{fontSize:9,color:TXD,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Última execução</div>
                <div style={{fontSize:11,fontWeight:600,color:TX,marginTop:6}}>{new Date(vtStatus.ultima_execucao).toLocaleString("pt-BR")}</div>
              </div>
            )}
          </div>
          {vtStatus.mensagem&&<div style={{marginTop:12,padding:10,background:BG3,borderRadius:8,fontSize:12,color:TXM,lineHeight:1.5}}>{vtStatus.mensagem}</div>}
        </div>
      )}

      <div style={{fontSize:12,fontWeight:600,color:TX,marginBottom:8}}>Alertas abertos · {vtAlerts.length}</div>
      {vtAlerts.length===0?(
        <div style={{padding:24,textAlign:"center",color:G,fontSize:13,background:G+"10",border:`1px solid ${G}40`,borderRadius:10}}>✅ Nenhum alerta visual aberto. Sistema íntegro.</div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {vtAlerts.map((a:any)=>{
            const corSev=({critical:R,critica:R,warn:Y,warning:Y,info:BL} as Record<string,string>)[a.severity]||TXM;
            return(
              <div key={a.id} style={{background:BG2,border:`1px solid ${BD}`,borderLeft:`4px solid ${corSev}`,borderRadius:8,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:corSev+"18",color:corSev,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{a.severity||"info"}</span>
                      {a.rota&&<span style={{fontSize:10,color:TXD,fontFamily:"monospace"}}>{a.rota}</span>}
                      {a.rule_id&&<span style={{fontSize:10,color:TXD,fontFamily:"monospace"}}>· {a.rule_id}</span>}
                    </div>
                    <div style={{fontSize:12,color:TX,marginBottom:6,lineHeight:1.4}}>{a.mensagem||a.message||"Alerta sem mensagem."}</div>
                    {a.detalhe&&<div style={{fontSize:10,color:TXM,fontFamily:"monospace",background:BG3,padding:6,borderRadius:6,wordBreak:"break-all",marginBottom:6}}>{typeof a.detalhe==="string"?a.detalhe:JSON.stringify(a.detalhe)}</div>}
                    <div style={{fontSize:9,color:TXD}}>{new Date(a.created_at||a.detected_at).toLocaleString("pt-BR")}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                    <button onClick={()=>resolverAlerta(a.id,"resolvido")} style={{padding:"5px 12px",borderRadius:6,background:G,color:"#FFF",fontSize:10,fontWeight:600,border:"none",cursor:"pointer",whiteSpace:"nowrap"}}>Resolver</button>
                    <button onClick={()=>resolverAlerta(a.id,"falso_positivo")} style={{padding:"5px 12px",borderRadius:6,background:"transparent",border:`1px solid ${BD}`,color:TXM,fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>Falso pos.</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>)}

    {/* ═══ ADMIN-AREAS-DINAMICAS-v1: aba 📂 Áreas (le area_menu_config via RPC) ═══ */}
    {tab==="areas"&&(<div>
      <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:6}}>Áreas do catálogo · area_menu_config</div>
      <div style={{fontSize:11,color:TXD,marginBottom:14}}>Fonte da verdade: RPC <code style={{background:BG3,padding:"1px 6px",borderRadius:4}}>fn_listar_areas_visiveis</code> / <code style={{background:BG3,padding:"1px 6px",borderRadius:4}}>fn_areas_visiveis_usuario</code>. Catálogo dinâmico — sem lista hardcoded.</div>

      <div style={{display:"flex",gap:6,marginBottom:14}}>
        <button onClick={()=>setAreasSubTab('empresa')} style={{padding:"6px 14px",borderRadius:8,fontSize:11,border:`1px solid ${areasSubTab==='empresa'?GO:BD}`,background:areasSubTab==='empresa'?`${GO}10`:"transparent",color:areasSubTab==='empresa'?GO:TXM,fontWeight:areasSubTab==='empresa'?600:400,cursor:"pointer"}}>Por empresa</button>
        <button onClick={()=>setAreasSubTab('usuario')} style={{padding:"6px 14px",borderRadius:8,fontSize:11,border:`1px solid ${areasSubTab==='usuario'?GO:BD}`,background:areasSubTab==='usuario'?`${GO}10`:"transparent",color:areasSubTab==='usuario'?GO:TXM,fontWeight:areasSubTab==='usuario'?600:400,cursor:"pointer"}}>Por usuário</button>
      </div>

      {areasSubTab==='empresa'&&(
        <div>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:11,color:TXM,minWidth:80}}>Empresa:</span>
            <select value={areaCompanyId} onChange={e=>setAreaCompanyId(e.target.value)} style={{...inp,maxWidth:380}}>
              <option value="">— Todas (catálogo geral, sem contexto) —</option>
              {empresas.map(e=><option key={e.id} value={e.id}>{e.nome_fantasia||e.razao_social}</option>)}
            </select>
          </div>
          {areasLoading?(
            <div style={{textAlign:"center",padding:30,color:TXD,fontSize:12}}>Carregando áreas…</div>
          ):areasError?(
            <div style={{background:R+"15",border:`1px solid ${R}40`,borderRadius:8,padding:"10px 14px",fontSize:12,color:R}}>❌ {areasError}</div>
          ):areasEmpresa.length===0?(
            <div style={{textAlign:"center",padding:30,color:TXD,fontSize:12}}>Nenhuma área retornada pela RPC.</div>
          ):(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
              {[...areasEmpresa].sort((a,b)=>(a.ordem??999)-(b.ordem??999)).map((a:any)=>(
                <div key={a.area_slug} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`0.5px solid ${BD}`,gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                    <span style={{fontSize:18}}>{a.icone||"📁"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:TX,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {a.nome_menu}
                        {a.status_comercial&&(
                          <span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:(a.cor_destaque||GO)+"20",color:a.cor_destaque||GO,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{a.status_comercial}</span>
                        )}
                      </div>
                      <div style={{fontSize:10,color:TXD}}><code>{a.area_slug}</code> · {a.rota_raiz}</div>
                      {a.descricao_curta&&<div style={{fontSize:11,color:TXM,marginTop:2}}>{a.descricao_curta}</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    {areaCompanyId?(
                      <span title={a.motivo_acesso||""} style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:a.empresa_tem_acesso?G+"20":TXD+"20",color:a.empresa_tem_acesso?G:TXD,fontWeight:600,border:`1px solid ${a.empresa_tem_acesso?G:TXD}40`}}>
                        {a.empresa_tem_acesso?"✓ tem acesso":"sem acesso"}
                      </span>
                    ):(
                      <span style={{fontSize:10,color:TXD,fontStyle:"italic"}}>selecione empresa pra ver acesso</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {areasSubTab==='usuario'&&(
        <div>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:11,color:TXM,minWidth:80}}>Usuário:</span>
            <select value={areaUserId} onChange={e=>setAreaUserId(e.target.value)} style={{...inp,maxWidth:380}}>
              <option value="">— Selecione um usuário —</option>
              {usuarios.map(u=><option key={u.id} value={u.id}>{u.full_name||u.email||u.id}</option>)}
            </select>
          </div>
          {!areaUserId?(
            <div style={{textAlign:"center",padding:30,color:TXD,fontSize:12}}>Selecione um usuário acima.</div>
          ):areasLoading?(
            <div style={{textAlign:"center",padding:30,color:TXD,fontSize:12}}>Carregando áreas do usuário…</div>
          ):areasError?(
            <div style={{background:R+"15",border:`1px solid ${R}40`,borderRadius:8,padding:"10px 14px",fontSize:12,color:R}}>❌ {areasError}</div>
          ):areasUsuario.length===0?(
            <div style={{textAlign:"center",padding:30,color:TXD,fontSize:12}}>Nenhuma área visível para este usuário.</div>
          ):(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
              {[...areasUsuario].sort((a,b)=>(a.ordem??999)-(b.ordem??999)).map((a:any)=>(
                <div key={a.area_id||a.area_slug} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`0.5px solid ${BD}`,gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                    <span style={{fontSize:18}}>{a.icone||"📁"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:TX,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {a.nome_menu}
                        {a.status_comercial&&(
                          <span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:(a.cor_destaque||GO)+"20",color:a.cor_destaque||GO,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{a.status_comercial}</span>
                        )}
                      </div>
                      <div style={{fontSize:10,color:TXD}}>{a.rota_raiz}</div>
                    </div>
                  </div>
                  <span style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:a.restrito?Y+"20":G+"20",color:a.restrito?Y:G,fontWeight:600,border:`1px solid ${a.restrito?Y:G}40`}}>
                    {a.restrito?"restrito":"liberado"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>)}

    <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:24}}>PS Gestão e Capital — Painel Administrativo v9.1</div>
    {areasModalEmp&&(
      <AreasContratadasModal companyId={areasModalEmp.id} companyName={areasModalEmp.nome} onClose={()=>{setAreasModalEmp(null);loadAreasContratadas();}}/>
    )}
  </div>);
}
