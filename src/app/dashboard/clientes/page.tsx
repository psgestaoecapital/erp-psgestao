"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Cliente = {
  id:string; company_id:string; codigo:string; razao_social:string; nome_fantasia:string;
  tipo_pessoa:string; cpf_cnpj:string; ie:string; im:string; data_nascimento:string;
  telefone:string; celular:string; whatsapp:string; email:string; site:string;
  cep:string; logradouro:string; numero:string; complemento:string; bairro:string; cidade:string; uf:string;
  atividade_principal:string; situacao_cadastral:string; data_abertura:string; regime_tributario:string;
  limite_credito:number; credito_utilizado:number; condicao_pagamento_padrao:string; prazo_medio_dias:number;
  score_inadimplencia:number; classificacao_risco:string;
  total_compras:number; qtd_compras:number; qtd_atrasos:number; dias_medio_atraso:number; ticket_medio:number;
  ultima_compra:string; primeira_compra:string;
  vendedor_nome:string; origem:string; tags:string[]; segmento:string; categoria:string;
  observacoes:string; observacoes_internas:string;
  ref_externa_sistema:string; ref_externa_id:string;
  ativo:boolean; bloqueado:boolean;
  created_at:string; updated_at:string;
};

const CONDS_PGTO = ['À vista','7 dias','14 dias','21 dias','28 dias','30 dias','30/60 dias','30/60/90 dias','45 dias','60 dias','90 dias','Boleto 30d','PIX'];
const REGIMES = ['Simples Nacional','Lucro Presumido','Lucro Real','MEI','Produtor Rural','Isento'];
const SEGMENTOS = ['Indústria','Comércio','Serviço','Construção','Agro','Transporte','Educação','Saúde','Tecnologia','Varejo','Atacado','Outro'];
const TAGS_DISPONIVEIS = ['VIP','Prospect','Inativo','Regular','Atenção','Fidelizado','Novo','Grande Conta','Governo'];
const ORIGENS = ['Indicação','Site','WhatsApp','Instagram','Google','Feira','Cold Call','Cliente Antigo','Parceiro','Outro'];

const EMPTY:Partial<Cliente> = {
  codigo:'',razao_social:'',nome_fantasia:'',tipo_pessoa:'PJ',cpf_cnpj:'',ie:'',
  telefone:'',celular:'',whatsapp:'',email:'',site:'',
  cep:'',logradouro:'',numero:'',complemento:'',bairro:'',cidade:'',uf:'',
  limite_credito:0,condicao_pagamento_padrao:'30 dias',prazo_medio_dias:30,
  vendedor_nome:'',origem:'',tags:[],segmento:'',
  observacoes:'',ativo:true,bloqueado:false,
};

const fmtCNPJ=(v:string)=>{const c=(v||'').replace(/\D/g,'');if(c.length===14)return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(c.length===11)return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return v;};
const fmtTel=(v:string)=>{const c=(v||'').replace(/\D/g,'');if(c.length===11)return c.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');if(c.length===10)return c.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');return v;};
const fmtR=(v:number)=>`R$ ${(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

export default function ClientesPage(){
  const [clientes,setClientes]=useState<Cliente[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroRisco,setFiltroRisco]=useState<string>("todos");
  const [filtroAtivo,setFiltroAtivo]=useState<string>("ativos");
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState<Cliente|null>(null);
  const [form,setForm]=useState<Partial<Cliente>>(EMPTY);
  const [msg,setMsg]=useState("");
  const [cnpjLoading,setCnpjLoading]=useState(false);
  const [cepLoading,setCepLoading]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [sortBy,setSortBy]=useState("razao_social");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel)loadClientes();},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadClientes=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_clientes").select("*").eq("company_id",sel).order("razao_social");
    if(data)setClientes(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const buscarCNPJ=async()=>{
    const cnpj=(form.cpf_cnpj||'').replace(/\D/g,'');
    if(cnpj.length!==14){setMsg("⚠️ CNPJ deve ter 14 dígitos.");return;}
    setCnpjLoading(true);
    try{
      const r=await fetch(`/api/cnpj-lookup?cnpj=${cnpj}`);
      const d=await r.json();
      if(d.error){setMsg("❌ "+d.error);setCnpjLoading(false);return;}
      setForm({...form,
        razao_social:d.razao_social||form.razao_social,
        nome_fantasia:d.nome_fantasia||form.nome_fantasia,
        cpf_cnpj:fmtCNPJ(d.cnpj),
        atividade_principal:d.atividade_principal||'',
        situacao_cadastral:d.situacao_cadastral||'',
        data_abertura:d.data_abertura||'',
        logradouro:d.logradouro||'',numero:d.numero||'',complemento:d.complemento||'',
        bairro:d.bairro||'',cidade:d.cidade||'',uf:d.uf||'',cep:d.cep||'',
        telefone:d.telefone||form.telefone||'',email:d.email||form.email||'',
      });
      setMsg("✅ Dados preenchidos automaticamente via Receita Federal");
    }catch(e){setMsg("❌ Erro ao consultar CNPJ.");}
    setCnpjLoading(false);
    setTimeout(()=>setMsg(""),4000);
  };

  const buscarCEP=async()=>{
    const cep=(form.cep||'').replace(/\D/g,'');
    if(cep.length!==8){setMsg("⚠️ CEP deve ter 8 dígitos.");return;}
    setCepLoading(true);
    try{
      const r=await fetch(`/api/cep-lookup?cep=${cep}`);
      const d=await r.json();
      if(d.error){setMsg("❌ "+d.error);setCepLoading(false);return;}
      setForm({...form,
        logradouro:d.logradouro||form.logradouro,
        bairro:d.bairro||form.bairro,
        cidade:d.cidade||form.cidade,
        uf:d.uf||form.uf,
        complemento:d.complemento||form.complemento||'',
      });
      setMsg("✅ Endereço preenchido automaticamente via ViaCEP");
    }catch(e){setMsg("❌ Erro ao consultar CEP.");}
    setCepLoading(false);
    setTimeout(()=>setMsg(""),4000);
  };

  const salvar=async()=>{
    if(!form.razao_social?.trim()){setMsg("❌ Razão Social é obrigatória.");return;}
    const dados={...form,company_id:sel,
      limite_credito:Number(form.limite_credito)||0,
      prazo_medio_dias:Number(form.prazo_medio_dias)||0,
      cpf_cnpj:(form.cpf_cnpj||'').replace(/\D/g,''),
    };
    delete(dados as any).id;delete(dados as any).created_at;delete(dados as any).updated_at;
    delete(dados as any).score_inadimplencia;delete(dados as any).classificacao_risco;
    delete(dados as any).total_compras;delete(dados as any).qtd_compras;delete(dados as any).qtd_atrasos;
    delete(dados as any).dias_medio_atraso;delete(dados as any).ticket_medio;delete(dados as any).credito_utilizado;

    if(editing){
      const{error}=await supabase.from("erp_clientes").update(dados).eq("id",editing.id);
      if(error){setMsg("Erro: "+error.message);return;}
      setMsg("✅ Cliente atualizado!");
    }else{
      const{error}=await supabase.from("erp_clientes").insert(dados);
      if(error){
        if(error.message.includes("unique"))setMsg("❌ CNPJ já cadastrado para esta empresa.");
        else setMsg("Erro: "+error.message);return;
      }
      setMsg("✅ Cliente cadastrado!");
    }
    setShowForm(false);setEditing(null);setForm(EMPTY);loadClientes();
    setTimeout(()=>setMsg(""),3000);
  };

  const abrirEdicao=(c:Cliente)=>{setEditing(c);setForm({...c,cpf_cnpj:fmtCNPJ(c.cpf_cnpj)});setShowForm(true);};
  const abrirNovo=()=>{setEditing(null);setForm({...EMPTY,codigo:String(clientes.length+1).padStart(4,'0')});setShowForm(true);};
  const toggleAtivo=async(c:Cliente)=>{await supabase.from("erp_clientes").update({ativo:!c.ativo}).eq("id",c.id);setClientes(clientes.map(x=>x.id===c.id?{...x,ativo:!x.ativo}:x));};
  const toggleBloqueado=async(c:Cliente)=>{await supabase.from("erp_clientes").update({bloqueado:!c.bloqueado}).eq("id",c.id);setClientes(clientes.map(x=>x.id===c.id?{...x,bloqueado:!x.bloqueado}:x));};

  const filtrados=useMemo(()=>{
    let r=clientes;
    if(filtroRisco!=="todos")r=r.filter(c=>(c.classificacao_risco||"NOVO")===filtroRisco);
    if(filtroAtivo==="ativos")r=r.filter(c=>c.ativo&&!c.bloqueado);
    else if(filtroAtivo==="inativos")r=r.filter(c=>!c.ativo);
    else if(filtroAtivo==="bloqueados")r=r.filter(c=>c.bloqueado);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(c=>(c.razao_social||"").toLowerCase().includes(b)||(c.nome_fantasia||"").toLowerCase().includes(b)||(c.cpf_cnpj||"").includes(b.replace(/\D/g,''))||(c.email||"").toLowerCase().includes(b)||(c.cidade||"").toLowerCase().includes(b));
    }
    return r;
  },[clientes,filtroRisco,filtroAtivo,busca]);

  const kpiTotal=clientes.filter(c=>c.ativo).length;
  const kpiVIP=clientes.filter(c=>c.tags?.includes('VIP')).length;
  const kpiRiscoAlto=clientes.filter(c=>c.classificacao_risco==='ALTO').length;
  const kpiLimite=clientes.reduce((s,c)=>s+(Number(c.limite_credito)||0),0);
  const kpiUtilizado=clientes.reduce((s,c)=>s+(Number(c.credito_utilizado)||0),0);

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};
  const corRisco=(r:string)=>r==='BAIXO'?G:r==='MEDIO'?Y:r==='ALTO'?R:TXD;
  const iconRisco=(r:string)=>r==='BAIXO'?'🟢':r==='MEDIO'?'🟡':r==='ALTO'?'🔴':'⚪';

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>👥 Clientes</div>
          <div style={{fontSize:11,color:TXD}}>Cadastro profissional com CNPJ automático, score de risco e limite de crédito</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <button onClick={()=>setShowImport(true)} style={{padding:"8px 14px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📥 Importar</button>
          <button onClick={abrirNovo} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Clientes Ativos",v:String(kpiTotal),c:B,icon:"👥"},
          {l:"Clientes VIP",v:String(kpiVIP),c:GO,icon:"⭐"},
          {l:"Risco Alto",v:String(kpiRiscoAlto),c:kpiRiscoAlto>0?R:G,icon:kpiRiscoAlto>0?"🔴":"✅"},
          {l:"Limite Total",v:fmtR(kpiLimite),c:G,icon:"💳"},
          {l:"Utilizado",v:fmtR(kpiUtilizado),c:kpiUtilizado>kpiLimite*0.8?R:Y,icon:"📊"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por nome, CNPJ, email ou cidade..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          {[{v:"todos",l:"Todos"},{v:"BAIXO",l:"🟢 Baixo"},{v:"MEDIO",l:"🟡 Médio"},{v:"ALTO",l:"🔴 Alto"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroRisco(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroRisco===f.v?GO:BD}`,background:filtroRisco===f.v?GO+"12":"transparent",color:filtroRisco===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroRisco===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4}}>
          {[{v:"ativos",l:"Ativos"},{v:"inativos",l:"Inativos"},{v:"bloqueados",l:"🚫 Bloqueados"},{v:"todos",l:"Todos"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroAtivo(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroAtivo===f.v?GO:BD}`,background:filtroAtivo===f.v?GO+"12":"transparent",color:filtroAtivo===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroAtivo===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <span style={{fontSize:10,color:TXD}}>{filtrados.length} resultado{filtrados.length!==1?"s":""}</span>
      </div>

      {/* Modal de Importação */}
      {showImport&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowImport(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:720,width:"100%",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>📥 Importar Clientes</div>
                <div style={{fontSize:11,color:TXD}}>Escolha a origem dos dados</div>
              </div>
              <button onClick={()=>setShowImport(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[
                {k:'omie',nome:'Omie',icon:'🟢',desc:'API direta — sync automático',cor:G,href:'/dashboard/conectores'},
                {k:'nibo',nome:'Nibo',icon:'🔵',desc:'API direta — sync automático',cor:B,href:'/dashboard/conectores'},
                {k:'contaazul',nome:'ContaAzul',icon:'🔷',desc:'OAuth — em configuração',cor:'#00A3E0',href:'/dashboard/conectores'},
                {k:'bling',nome:'Bling',icon:'🟡',desc:'Via CSV ou API token',cor:Y,href:'/dashboard/importar'},
                {k:'tiny',nome:'Tiny',icon:'🟠',desc:'Via CSV exportado',cor:'#FF6B35',href:'/dashboard/importar'},
                {k:'csv',nome:'Excel / CSV',icon:'📊',desc:'Qualquer sistema — mapeamento inteligente',cor:T,href:'/dashboard/importar'},
              ].map(o=>(
                <a key={o.k} href={o.href} style={{textDecoration:"none"}}>
                  <div style={{background:BG3,borderRadius:10,padding:14,border:`1px solid ${o.cor}30`,cursor:"pointer",transition:"all 0.2s"}} onMouseEnter={e=>(e.currentTarget.style.borderColor=o.cor,e.currentTarget.style.transform="translateY(-2px)")} onMouseLeave={e=>(e.currentTarget.style.borderColor=`${o.cor}30`,e.currentTarget.style.transform="translateY(0)")}>
                    <div style={{fontSize:24,marginBottom:4}}>{o.icon}</div>
                    <div style={{fontSize:13,fontWeight:700,color:o.cor}}>{o.nome}</div>
                    <div style={{fontSize:9,color:TXD,marginTop:3}}>{o.desc}</div>
                  </div>
                </a>
              ))}
            </div>
            <div style={{marginTop:16,padding:12,background:BG3,borderRadius:8,borderLeft:`3px solid ${B}`}}>
              <div style={{fontSize:10,fontWeight:600,color:B,marginBottom:4}}>💡 Dica</div>
              <div style={{fontSize:10,color:TXM,lineHeight:1.5}}>Para qualquer sistema não listado (Protheus, SAP, Sage, planilhas antigas), use o <b>Excel/CSV</b>. O Importador Universal mapeia as colunas automaticamente — basta arrastar o arquivo.</div>
            </div>
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${GO}40`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:16,fontWeight:700,color:TX}}>{editing?"Editar":"Novo"} Cliente</div>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{background:"none",border:"none",color:TXD,fontSize:18,cursor:"pointer"}}>✕</button>
          </div>

          {/* Identificação */}
          <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:8}}>📋 Identificação</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo</div>
              <select value={form.tipo_pessoa} onChange={e=>setForm({...form,tipo_pessoa:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="PJ">🏢 Pessoa Jurídica</option><option value="PF">👤 Pessoa Física</option>
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>{form.tipo_pessoa==='PJ'?'CNPJ':'CPF'}</div>
              <div style={{display:"flex",gap:4}}>
                <input value={form.cpf_cnpj} onChange={e=>setForm({...form,cpf_cnpj:e.target.value})} placeholder={form.tipo_pessoa==='PJ'?'00.000.000/0000-00':'000.000.000-00'} style={{...inp,fontFamily:"monospace"}}/>
                {form.tipo_pessoa==='PJ'&&<button onClick={buscarCNPJ} disabled={cnpjLoading} style={{padding:"0 12px",borderRadius:6,background:B+"15",color:B,border:`1px solid ${B}40`,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{cnpjLoading?"...":"🔍 Buscar"}</button>}
              </div></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Código</div>
              <input value={form.codigo} onChange={e=>setForm({...form,codigo:e.target.value})} style={{...inp,fontFamily:"monospace"}}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>IE</div>
              <input value={form.ie} onChange={e=>setForm({...form,ie:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Razão Social / Nome *</div>
              <input value={form.razao_social} onChange={e=>setForm({...form,razao_social:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome Fantasia</div>
              <input value={form.nome_fantasia} onChange={e=>setForm({...form,nome_fantasia:e.target.value})} style={inp}/></div>
          </div>

          {/* Contato */}
          <div style={{fontSize:11,fontWeight:600,color:B,marginBottom:8}}>📱 Contato</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Telefone</div>
              <input value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="(00) 0000-0000" style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Celular / WhatsApp</div>
              <input value={form.whatsapp} onChange={e=>setForm({...form,whatsapp:e.target.value})} placeholder="(00) 00000-0000" style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Email</div>
              <input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="contato@empresa.com.br" style={inp}/></div>
          </div>

          {/* Endereço */}
          <div style={{fontSize:11,fontWeight:600,color:P,marginBottom:8}}>📍 Endereço</div>
          <div style={{display:"grid",gridTemplateColumns:"120px 1fr 80px 1fr",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>CEP</div>
              <div style={{display:"flex",gap:4}}>
                <input value={form.cep} onChange={e=>setForm({...form,cep:e.target.value})} placeholder="00000-000" style={{...inp,fontFamily:"monospace"}}/>
                <button onClick={buscarCEP} disabled={cepLoading} style={{padding:"0 8px",borderRadius:6,background:B+"15",color:B,border:`1px solid ${B}40`,fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>{cepLoading?"...":"🔍"}</button>
              </div></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Logradouro</div>
              <input value={form.logradouro} onChange={e=>setForm({...form,logradouro:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Número</div>
              <input value={form.numero} onChange={e=>setForm({...form,numero:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Complemento</div>
              <input value={form.complemento} onChange={e=>setForm({...form,complemento:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Bairro</div>
              <input value={form.bairro} onChange={e=>setForm({...form,bairro:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cidade</div>
              <input value={form.cidade} onChange={e=>setForm({...form,cidade:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>UF</div>
              <input value={form.uf} onChange={e=>setForm({...form,uf:e.target.value.toUpperCase().slice(0,2)})} style={{...inp,textAlign:"center",fontWeight:600}}/></div>
          </div>

          {/* Comercial */}
          <div style={{fontSize:11,fontWeight:600,color:G,marginBottom:8}}>💰 Comercial</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Limite de Crédito (R$)</div>
              <input type="number" step="0.01" value={form.limite_credito||''} onChange={e=>setForm({...form,limite_credito:parseFloat(e.target.value)||0})} style={{...inp,color:G,fontWeight:600}}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cond. Pagamento Padrão</div>
              <select value={form.condicao_pagamento_padrao} onChange={e=>setForm({...form,condicao_pagamento_padrao:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{CONDS_PGTO.map(c=><option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Prazo Médio (dias)</div>
              <input type="number" value={form.prazo_medio_dias||''} onChange={e=>setForm({...form,prazo_medio_dias:parseInt(e.target.value)||0})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Vendedor</div>
              <input value={form.vendedor_nome} onChange={e=>setForm({...form,vendedor_nome:e.target.value})} style={inp}/></div>
          </div>

          {/* Segmentação */}
          <div style={{fontSize:11,fontWeight:600,color:T,marginBottom:8}}>🏷️ Segmentação</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Segmento</div>
              <select value={form.segmento} onChange={e=>setForm({...form,segmento:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{SEGMENTOS.map(s=><option key={s} value={s}>{s}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Origem (Como nos conheceu)</div>
              <select value={form.origem} onChange={e=>setForm({...form,origem:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{ORIGENS.map(o=><option key={o} value={o}>{o}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Regime Tributário</div>
              <select value={form.regime_tributario} onChange={e=>setForm({...form,regime_tributario:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{REGIMES.map(r=><option key={r} value={r}>{r}</option>)}
              </select></div>
            <div style={{gridColumn:"span 3"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tags</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {TAGS_DISPONIVEIS.map(tag=>{
                  const on=(form.tags||[]).includes(tag);
                  return(<button key={tag} onClick={()=>{const cur=form.tags||[];setForm({...form,tags:on?cur.filter(t=>t!==tag):[...cur,tag]});}} style={{padding:"4px 10px",borderRadius:12,fontSize:10,border:`1px solid ${on?GO:BD}`,background:on?GO+"15":"transparent",color:on?GO:TXM,cursor:"pointer",fontWeight:on?600:400}}>{on?"✓ ":""}{tag}</button>);
                })}
              </div></div>
          </div>

          {/* Observações */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,color:TXD,marginBottom:3}}>Observações</div>
            <textarea value={form.observacoes} onChange={e=>setForm({...form,observacoes:e.target.value})} rows={2} style={{...inp,resize:"vertical"}} placeholder="Observações gerais sobre o cliente..."/>
          </div>

          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            <button onClick={salvar} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>{editing?"Salvar":"Cadastrar"}</button>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando clientes...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>👥</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum cliente cadastrado</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Comece cadastrando manualmente ou importando de outro sistema.</div>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button onClick={abrirNovo} style={{padding:"10px 20px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Cadastrar Cliente</button>
                <button onClick={()=>setShowImport(true)} style={{padding:"10px 20px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📥 Importar do Omie/Nibo/CSV</button>
              </div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Razão / Fantasia</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>CNPJ</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cidade/UF</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Risco</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Limite</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Tags</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtrados.map(c=>(
                  <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}`,opacity:c.ativo?1:0.5,background:c.bloqueado?R+"08":"transparent"}}>
                    <td style={{padding:"8px"}}>
                      <div style={{fontWeight:500,color:TX}}>{c.nome_fantasia||c.razao_social}</div>
                      {c.nome_fantasia&&c.razao_social!==c.nome_fantasia&&<div style={{fontSize:9,color:TXD}}>{c.razao_social}</div>}
                    </td>
                    <td style={{padding:"8px",color:TXM,fontFamily:"monospace",fontSize:10}}>{fmtCNPJ(c.cpf_cnpj||'')||"—"}</td>
                    <td style={{padding:"8px",color:TXM,fontSize:10}}>{c.cidade?`${c.cidade}/${c.uf}`:"—"}</td>
                    <td style={{padding:"8px",textAlign:"center"}}>
                      <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:corRisco(c.classificacao_risco||'NOVO')+"15",color:corRisco(c.classificacao_risco||'NOVO'),fontWeight:600}}>
                        {iconRisco(c.classificacao_risco||'NOVO')} {c.classificacao_risco||'NOVO'}
                      </span>
                    </td>
                    <td style={{padding:"8px",textAlign:"right",color:c.limite_credito>0?G:TXD,fontWeight:c.limite_credito>0?600:400}}>{c.limite_credito>0?fmtR(c.limite_credito):"—"}</td>
                    <td style={{padding:"8px"}}>
                      <div style={{display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center"}}>
                        {(c.tags||[]).slice(0,2).map(t=><span key={t} style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:GO+"15",color:GO}}>{t}</span>)}
                        {(c.tags||[]).length>2&&<span style={{fontSize:8,color:TXD}}>+{(c.tags||[]).length-2}</span>}
                      </div>
                    </td>
                    <td style={{padding:"8px"}}>
                      <div style={{display:"flex",gap:3,justifyContent:"flex-end"}}>
                        {c.whatsapp&&<a href={`https://wa.me/55${c.whatsapp.replace(/\D/g,'')}`} target="_blank" style={{fontSize:12,textDecoration:"none",padding:"2px 6px"}} title="WhatsApp">💬</a>}
                        {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:12,textDecoration:"none",padding:"2px 6px"}} title="Email">📧</a>}
                        <button onClick={()=>abrirEdicao(c)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:B+"12",color:B,border:`1px solid ${B}25`,cursor:"pointer"}}>Editar</button>
                        <button onClick={()=>toggleBloqueado(c)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:c.bloqueado?G+"12":R+"12",color:c.bloqueado?G:R,border:`1px solid ${c.bloqueado?G:R}25`,cursor:"pointer"}}>{c.bloqueado?"✓ Desbloq":"🚫 Bloq"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Clientes v1.0 · Lookup CNPJ via BrasilAPI · CEP via ViaCEP</div>
    </div>
  );
}
