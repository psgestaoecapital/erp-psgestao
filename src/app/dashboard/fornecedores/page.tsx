"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Fornecedor = {
  id:string; company_id:string; codigo:string; razao_social:string; nome_fantasia:string;
  tipo_pessoa:string; cpf_cnpj:string; ie:string;
  telefone:string; celular:string; whatsapp:string; email:string; site:string;
  cep:string; logradouro:string; numero:string; complemento:string; bairro:string; cidade:string; uf:string;
  atividade_principal:string; situacao_cadastral:string; regime_tributario:string;
  condicao_pagamento_padrao:string; prazo_entrega_dias:number; valor_minimo_pedido:number; frete_padrao:string;
  banco:string; agencia:string; conta:string; pix:string;
  avaliacao_qualidade:number; avaliacao_prazo:number; avaliacao_preco:number; avaliacao_geral:number;
  total_compras:number; qtd_compras:number; ultima_compra:string;
  categoria:string; tags:string[]; fornecedor_principal:boolean;
  observacoes:string; ref_externa_sistema:string; ref_externa_id:string;
  ativo:boolean; bloqueado:boolean;
  created_at:string; updated_at:string;
};

const CONDS_PGTO = ['À vista','7 dias','14 dias','21 dias','28 dias','30 dias','30/60 dias','30/60/90 dias','45 dias','60 dias','90 dias','Boleto 30d','PIX'];
const REGIMES = ['Simples Nacional','Lucro Presumido','Lucro Real','MEI','Produtor Rural','Isento'];
const CATEGORIAS_FORN = ['Matéria-prima','Embalagem','Serviço','Equipamento','Manutenção','Tecnologia','Consultoria','Transporte','Utilitários','Marketing','Outros'];
const TAGS_DISPONIVEIS = ['Preferencial','Homologado','Crítico','Backup','Nacional','Importado','Parceiro','Atenção'];
const FRETES = ['CIF (por conta do fornecedor)','FOB (por conta nossa)','Retira','Incluso','Combinar'];

const EMPTY:Partial<Fornecedor> = {
  codigo:'',razao_social:'',nome_fantasia:'',tipo_pessoa:'PJ',cpf_cnpj:'',ie:'',
  telefone:'',celular:'',whatsapp:'',email:'',site:'',
  cep:'',logradouro:'',numero:'',complemento:'',bairro:'',cidade:'',uf:'',
  condicao_pagamento_padrao:'30 dias',prazo_entrega_dias:0,valor_minimo_pedido:0,frete_padrao:'',
  banco:'',agencia:'',conta:'',pix:'',
  avaliacao_qualidade:0,avaliacao_prazo:0,avaliacao_preco:0,
  categoria:'',tags:[],fornecedor_principal:false,
  observacoes:'',ativo:true,bloqueado:false,
};

const fmtCNPJ=(v:string)=>{const c=(v||'').replace(/\D/g,'');if(c.length===14)return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(c.length===11)return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return v;};
const fmtR=(v:number)=>`R$ ${(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

// Star rating input
const StarInput=({value,onChange}:{value:number;onChange:(v:number)=>void})=>(
  <div style={{display:"flex",gap:2}}>
    {[1,2,3,4,5].map(n=>(
      <span key={n} onClick={()=>onChange(n===value?0:n)} style={{cursor:"pointer",fontSize:16,color:n<=value?"#F59E0B":"#D0C8B8"}}>★</span>
    ))}
    <span style={{fontSize:10,color:"#9C8E80",marginLeft:4,alignSelf:"center"}}>{value>0?`${value}/5`:'—'}</span>
  </div>
);

// Star rating display
const Stars=({value}:{value:number})=>(
  <span style={{letterSpacing:1}}>
    {[1,2,3,4,5].map(n=>(<span key={n} style={{color:n<=value?"#F59E0B":"#D0C8B8",fontSize:12}}>★</span>))}
  </span>
);

export default function FornecedoresPage(){
  const { companyIds, selInfo, companies, sel } = useCompanyIds();
  const [fornecedores,setFornecedores]=useState<Fornecedor[]>([]);
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroCategoria,setFiltroCategoria]=useState<string>("todas");
  const [filtroAtivo,setFiltroAtivo]=useState<string>("ativos");
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState<Fornecedor|null>(null);
  const [form,setForm]=useState<Partial<Fornecedor>>(EMPTY);
  const [msg,setMsg]=useState("");
  const [cnpjLoading,setCnpjLoading]=useState(false);
  const [cepLoading,setCepLoading]=useState(false);
  const [showImport,setShowImport]=useState(false);

  // Empresa individual para novos cadastros
  const companyIdParaCadastro = useMemo(()=>{
    if(sel && !sel.startsWith("group_") && sel!=="consolidado") return sel;
    return companyIds[0] || "";
  },[sel, companyIds]);

  useEffect(()=>{
    if(companyIds.length>0)loadFornecedores();
  },[companyIds.join(",")]);

  const loadFornecedores=async()=>{
    if(companyIds.length===0){setLoading(false);return;}
    setLoading(true);
    const{data,error}=await supabase.from("erp_fornecedores").select("*").in("company_id",companyIds).order("razao_social");
    if(data)setFornecedores(data);
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
      setForm({...form,logradouro:d.logradouro||form.logradouro,bairro:d.bairro||form.bairro,cidade:d.cidade||form.cidade,uf:d.uf||form.uf,complemento:d.complemento||form.complemento||''});
      setMsg("✅ Endereço preenchido automaticamente");
    }catch(e){setMsg("❌ Erro ao consultar CEP.");}
    setCepLoading(false);
    setTimeout(()=>setMsg(""),4000);
  };

  const salvar=async()=>{
    if(!form.razao_social?.trim()){setMsg("❌ Razão Social é obrigatória.");return;}
    if(!companyIdParaCadastro){setMsg("❌ Selecione uma empresa para cadastrar.");return;}
    
    if(!editing && (sel==="consolidado" || sel.startsWith("group_"))){
      const empresaNome = companies.find(c=>c.id===companyIdParaCadastro)?.nome_fantasia || "primeira empresa";
      if(!confirm(`Você está em modo consolidado. O novo fornecedor será cadastrado em "${empresaNome}". Continuar?`))return;
    }
    
    const aval=((form.avaliacao_qualidade||0)+(form.avaliacao_prazo||0)+(form.avaliacao_preco||0))/3;
    const dados={...form,company_id:editing?editing.company_id:companyIdParaCadastro,
      prazo_entrega_dias:Number(form.prazo_entrega_dias)||0,
      valor_minimo_pedido:Number(form.valor_minimo_pedido)||0,
      avaliacao_geral:Math.round(aval*10)/10,
      cpf_cnpj:(form.cpf_cnpj||'').replace(/\D/g,''),
    };
    delete(dados as any).id;delete(dados as any).created_at;delete(dados as any).updated_at;
    delete(dados as any).total_compras;delete(dados as any).qtd_compras;delete(dados as any).ultima_compra;

    if(editing){
      const{error}=await supabase.from("erp_fornecedores").update(dados).eq("id",editing.id);
      if(error){setMsg("Erro: "+error.message);return;}
      setMsg("✅ Fornecedor atualizado!");
    }else{
      const{error}=await supabase.from("erp_fornecedores").insert(dados);
      if(error){
        if(error.message.includes("unique"))setMsg("❌ CNPJ já cadastrado.");
        else setMsg("Erro: "+error.message);return;
      }
      setMsg("✅ Fornecedor cadastrado!");
    }
    setShowForm(false);setEditing(null);setForm(EMPTY);loadFornecedores();
    setTimeout(()=>setMsg(""),3000);
  };

  const abrirEdicao=(f:Fornecedor)=>{setEditing(f);setForm({...f,cpf_cnpj:fmtCNPJ(f.cpf_cnpj)});setShowForm(true);};
  const abrirNovo=()=>{setEditing(null);setForm({...EMPTY,codigo:String(fornecedores.length+1).padStart(4,'0')});setShowForm(true);};
  const toggleAtivo=async(f:Fornecedor)=>{await supabase.from("erp_fornecedores").update({ativo:!f.ativo}).eq("id",f.id);setFornecedores(fornecedores.map(x=>x.id===f.id?{...x,ativo:!x.ativo}:x));};
  const togglePrincipal=async(f:Fornecedor)=>{await supabase.from("erp_fornecedores").update({fornecedor_principal:!f.fornecedor_principal}).eq("id",f.id);setFornecedores(fornecedores.map(x=>x.id===f.id?{...x,fornecedor_principal:!x.fornecedor_principal}:x));};

  const filtrados=useMemo(()=>{
    let r=fornecedores;
    if(filtroCategoria!=="todas")r=r.filter(f=>f.categoria===filtroCategoria);
    if(filtroAtivo==="ativos")r=r.filter(f=>f.ativo&&!f.bloqueado);
    else if(filtroAtivo==="inativos")r=r.filter(f=>!f.ativo);
    else if(filtroAtivo==="principais")r=r.filter(f=>f.fornecedor_principal);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(f=>(f.razao_social||"").toLowerCase().includes(b)||(f.nome_fantasia||"").toLowerCase().includes(b)||(f.cpf_cnpj||"").includes(b.replace(/\D/g,''))||(f.cidade||"").toLowerCase().includes(b));
    }
    return r;
  },[fornecedores,filtroCategoria,filtroAtivo,busca]);

  const kpiTotal=fornecedores.filter(f=>f.ativo).length;
  const kpiPrincipais=fornecedores.filter(f=>f.fornecedor_principal&&f.ativo).length;
  const kpiMelhorNota=fornecedores.filter(f=>f.avaliacao_geral>=4).length;
  const kpiTotalCompras=fornecedores.reduce((s,f)=>s+(Number(f.total_compras)||0),0);
  const kpiMediaNota=fornecedores.filter(f=>f.avaliacao_geral>0).reduce((s,f)=>s+Number(f.avaliacao_geral),0)/(fornecedores.filter(f=>f.avaliacao_geral>0).length||1);

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🚚 Fornecedores</div>
          <div style={{fontSize:11,color:TXD,display:"flex",alignItems:"center",gap:6}}>
            <span>Cadastro com avaliação 360° — qualidade, prazo, preço</span>
            <span>·</span>
            <span style={{fontWeight:600,color:selInfo.isGroup?GO:TXM}}>
              {selInfo.tipo==='consolidado'?'📊 Todas':selInfo.tipo==='grupo'?'📁 Grupo':'🏢'} {selInfo.nome}
              {selInfo.isGroup&&` (${selInfo.count})`}
            </span>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setShowImport(true)} style={{padding:"8px 14px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📥 Importar</button>
          <button onClick={abrirNovo} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Fornecedores Ativos",v:String(kpiTotal),c:B,icon:"🚚"},
          {l:"Principais",v:String(kpiPrincipais),c:GO,icon:"⭐"},
          {l:"Bem Avaliados (4+)",v:String(kpiMelhorNota),c:G,icon:"🏆"},
          {l:"Nota Média",v:kpiMediaNota>0?`${kpiMediaNota.toFixed(1)}★`:"—",c:kpiMediaNota>=4?G:kpiMediaNota>=3?Y:R,icon:"📊"},
          {l:"Total em Compras",v:fmtR(kpiTotalCompras),c:P,icon:"💰"},
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
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por nome, CNPJ, cidade..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <select value={filtroCategoria} onChange={e=>setFiltroCategoria(e.target.value)} style={{...inp,width:"auto",cursor:"pointer"}}>
          <option value="todas">Todas categorias</option>{CATEGORIAS_FORN.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{display:"flex",gap:4}}>
          {[{v:"ativos",l:"Ativos"},{v:"principais",l:"⭐ Principais"},{v:"inativos",l:"Inativos"},{v:"todos",l:"Todos"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroAtivo(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroAtivo===f.v?GO:BD}`,background:filtroAtivo===f.v?GO+"12":"transparent",color:filtroAtivo===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroAtivo===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <span style={{fontSize:10,color:TXD}}>{filtrados.length} resultado{filtrados.length!==1?"s":""}</span>
      </div>

      {/* Modal Import */}
      {showImport&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowImport(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:720,width:"100%",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>📥 Importar Fornecedores</div>
                <div style={{fontSize:11,color:TXD}}>Escolha a origem dos dados</div>
              </div>
              <button onClick={()=>setShowImport(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[
                {k:'omie',nome:'Omie',icon:'🟢',desc:'API direta',cor:G,href:'/dashboard/conectores'},
                {k:'nibo',nome:'Nibo',icon:'🔵',desc:'API direta',cor:B,href:'/dashboard/conectores'},
                {k:'contaazul',nome:'ContaAzul',icon:'🔷',desc:'OAuth',cor:'#00A3E0',href:'/dashboard/conectores'},
                {k:'bling',nome:'Bling',icon:'🟡',desc:'Via CSV',cor:Y,href:'/dashboard/importar'},
                {k:'tiny',nome:'Tiny',icon:'🟠',desc:'Via CSV',cor:'#FF6B35',href:'/dashboard/importar'},
                {k:'csv',nome:'Excel / CSV',icon:'📊',desc:'Qualquer sistema',cor:T,href:'/dashboard/importar'},
              ].map(o=>(
                <a key={o.k} href={o.href} style={{textDecoration:"none"}}>
                  <div style={{background:BG3,borderRadius:10,padding:14,border:`1px solid ${o.cor}30`,cursor:"pointer"}}>
                    <div style={{fontSize:24,marginBottom:4}}>{o.icon}</div>
                    <div style={{fontSize:13,fontWeight:700,color:o.cor}}>{o.nome}</div>
                    <div style={{fontSize:9,color:TXD,marginTop:3}}>{o.desc}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${GO}40`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:16,fontWeight:700,color:TX}}>{editing?"Editar":"Novo"} Fornecedor</div>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{background:"none",border:"none",color:TXD,fontSize:18,cursor:"pointer"}}>✕</button>
          </div>

          {/* Identificação */}
          <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:8}}>📋 Identificação</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo</div>
              <select value={form.tipo_pessoa} onChange={e=>setForm({...form,tipo_pessoa:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="PJ">🏢 PJ</option><option value="PF">👤 PF</option>
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>{form.tipo_pessoa==='PJ'?'CNPJ':'CPF'}</div>
              <div style={{display:"flex",gap:4}}>
                <input value={form.cpf_cnpj} onChange={e=>setForm({...form,cpf_cnpj:e.target.value})} style={{...inp,fontFamily:"monospace"}}/>
                {form.tipo_pessoa==='PJ'&&<button onClick={buscarCNPJ} disabled={cnpjLoading} style={{padding:"0 12px",borderRadius:6,background:B+"15",color:B,border:`1px solid ${B}40`,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{cnpjLoading?"...":"🔍"}</button>}
              </div></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Código</div>
              <input value={form.codigo} onChange={e=>setForm({...form,codigo:e.target.value})} style={{...inp,fontFamily:"monospace"}}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>IE</div>
              <input value={form.ie} onChange={e=>setForm({...form,ie:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Razão Social *</div>
              <input value={form.razao_social} onChange={e=>setForm({...form,razao_social:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome Fantasia</div>
              <input value={form.nome_fantasia} onChange={e=>setForm({...form,nome_fantasia:e.target.value})} style={inp}/></div>
          </div>

          {/* Contato */}
          <div style={{fontSize:11,fontWeight:600,color:B,marginBottom:8}}>📱 Contato</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Telefone</div>
              <input value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>WhatsApp</div>
              <input value={form.whatsapp} onChange={e=>setForm({...form,whatsapp:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Email</div>
              <input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} style={inp}/></div>
          </div>

          {/* Endereço */}
          <div style={{fontSize:11,fontWeight:600,color:P,marginBottom:8}}>📍 Endereço</div>
          <div style={{display:"grid",gridTemplateColumns:"120px 1fr 80px 1fr",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>CEP</div>
              <div style={{display:"flex",gap:4}}>
                <input value={form.cep} onChange={e=>setForm({...form,cep:e.target.value})} style={{...inp,fontFamily:"monospace"}}/>
                <button onClick={buscarCEP} disabled={cepLoading} style={{padding:"0 8px",borderRadius:6,background:B+"15",color:B,border:`1px solid ${B}40`,fontSize:10,cursor:"pointer"}}>{cepLoading?"...":"🔍"}</button>
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
              <input value={form.uf} onChange={e=>setForm({...form,uf:e.target.value.toUpperCase().slice(0,2)})} style={{...inp,textAlign:"center"}}/></div>
          </div>

          {/* Comercial */}
          <div style={{fontSize:11,fontWeight:600,color:G,marginBottom:8}}>💰 Comercial</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Categoria</div>
              <select value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{CATEGORIAS_FORN.map(c=><option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cond. Pagamento</div>
              <select value={form.condicao_pagamento_padrao} onChange={e=>setForm({...form,condicao_pagamento_padrao:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{CONDS_PGTO.map(c=><option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Prazo Entrega (dias)</div>
              <input type="number" value={form.prazo_entrega_dias||''} onChange={e=>setForm({...form,prazo_entrega_dias:parseInt(e.target.value)||0})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Pedido Mínimo (R$)</div>
              <input type="number" step="0.01" value={form.valor_minimo_pedido||''} onChange={e=>setForm({...form,valor_minimo_pedido:parseFloat(e.target.value)||0})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Frete Padrão</div>
              <select value={form.frete_padrao} onChange={e=>setForm({...form,frete_padrao:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{FRETES.map(f=><option key={f} value={f}>{f}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Regime Tributário</div>
              <select value={form.regime_tributario} onChange={e=>setForm({...form,regime_tributario:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{REGIMES.map(r=><option key={r} value={r}>{r}</option>)}
              </select></div>
            <div style={{gridColumn:"span 2",display:"flex",alignItems:"end",gap:8}}>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:TX,cursor:"pointer"}}>
                <input type="checkbox" checked={form.fornecedor_principal||false} onChange={e=>setForm({...form,fornecedor_principal:e.target.checked})} style={{width:16,height:16,cursor:"pointer"}}/>
                ⭐ Fornecedor Principal (estratégico)
              </label>
            </div>
          </div>

          {/* Dados Bancários */}
          <div style={{fontSize:11,fontWeight:600,color:T,marginBottom:8}}>🏦 Dados Bancários</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Banco</div>
              <input value={form.banco} onChange={e=>setForm({...form,banco:e.target.value})} placeholder="Ex: Itaú 341" style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Agência</div>
              <input value={form.agencia} onChange={e=>setForm({...form,agencia:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Conta</div>
              <input value={form.conta} onChange={e=>setForm({...form,conta:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Chave PIX</div>
              <input value={form.pix} onChange={e=>setForm({...form,pix:e.target.value})} placeholder="CNPJ / email / telefone" style={inp}/></div>
          </div>

          {/* Avaliação */}
          <div style={{fontSize:11,fontWeight:600,color:Y,marginBottom:8}}>⭐ Avaliação do Fornecedor</div>
          <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:12,display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            <div>
              <div style={{fontSize:10,color:TXD,marginBottom:4}}>Qualidade</div>
              <StarInput value={form.avaliacao_qualidade||0} onChange={v=>setForm({...form,avaliacao_qualidade:v})}/>
            </div>
            <div>
              <div style={{fontSize:10,color:TXD,marginBottom:4}}>Prazo de Entrega</div>
              <StarInput value={form.avaliacao_prazo||0} onChange={v=>setForm({...form,avaliacao_prazo:v})}/>
            </div>
            <div>
              <div style={{fontSize:10,color:TXD,marginBottom:4}}>Preço</div>
              <StarInput value={form.avaliacao_preco||0} onChange={v=>setForm({...form,avaliacao_preco:v})}/>
            </div>
            {(form.avaliacao_qualidade||0)+(form.avaliacao_prazo||0)+(form.avaliacao_preco||0)>0&&(
              <div style={{gridColumn:"span 3",paddingTop:8,borderTop:`1px solid ${BD}`,fontSize:11,color:TXM}}>
                📊 Avaliação geral: <span style={{fontWeight:700,color:Y}}>{(((form.avaliacao_qualidade||0)+(form.avaliacao_prazo||0)+(form.avaliacao_preco||0))/3).toFixed(1)} / 5.0 ★</span>
              </div>
            )}
          </div>

          {/* Tags */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:10,color:TXD,marginBottom:3}}>Tags</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {TAGS_DISPONIVEIS.map(tag=>{
                const on=(form.tags||[]).includes(tag);
                return(<button key={tag} onClick={()=>{const cur=form.tags||[];setForm({...form,tags:on?cur.filter(t=>t!==tag):[...cur,tag]});}} style={{padding:"4px 10px",borderRadius:12,fontSize:10,border:`1px solid ${on?GO:BD}`,background:on?GO+"15":"transparent",color:on?GO:TXM,cursor:"pointer",fontWeight:on?600:400}}>{on?"✓ ":""}{tag}</button>);
              })}
            </div>
          </div>

          {/* Observações */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,color:TXD,marginBottom:3}}>Observações</div>
            <textarea value={form.observacoes} onChange={e=>setForm({...form,observacoes:e.target.value})} rows={2} style={{...inp,resize:"vertical"}} placeholder="Observações gerais, histórico, notas importantes..."/>
          </div>

          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            <button onClick={salvar} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>{editing?"Salvar":"Cadastrar"}</button>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>🚚</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum fornecedor cadastrado</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Cadastre manualmente ou importe de outro sistema.</div>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button onClick={abrirNovo} style={{padding:"10px 20px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Cadastrar Fornecedor</button>
                <button onClick={()=>setShowImport(true)} style={{padding:"10px 20px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📥 Importar</button>
              </div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Razão / Fantasia</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>CNPJ</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Categoria</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Avaliação</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Prazo</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Tags</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtrados.map(f=>(
                  <tr key={f.id} style={{borderBottom:`0.5px solid ${BD}`,opacity:f.ativo?1:0.5,background:f.fornecedor_principal?GO+"06":"transparent"}}>
                    <td style={{padding:"8px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        {f.fornecedor_principal&&<span title="Fornecedor Principal" style={{fontSize:12}}>⭐</span>}
                        <span style={{fontWeight:500,color:TX}}>{f.nome_fantasia||f.razao_social}</span>
                      </div>
                      {f.cidade&&<div style={{fontSize:9,color:TXD}}>{f.cidade}/{f.uf}</div>}
                    </td>
                    <td style={{padding:"8px",color:TXM,fontFamily:"monospace",fontSize:10}}>{fmtCNPJ(f.cpf_cnpj||'')||"—"}</td>
                    <td style={{padding:"8px",color:TXM,fontSize:10}}>{f.categoria||"—"}</td>
                    <td style={{padding:"8px",textAlign:"center"}}>
                      {f.avaliacao_geral>0?(
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                          <Stars value={Math.round(f.avaliacao_geral)}/>
                          <span style={{fontSize:9,color:TXD}}>{f.avaliacao_geral.toFixed(1)}</span>
                        </div>
                      ):<span style={{fontSize:10,color:TXD}}>—</span>}
                    </td>
                    <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{f.prazo_entrega_dias>0?`${f.prazo_entrega_dias}d`:"—"}</td>
                    <td style={{padding:"8px"}}>
                      <div style={{display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center"}}>
                        {(f.tags||[]).slice(0,2).map(t=><span key={t} style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:GO+"15",color:GO}}>{t}</span>)}
                        {(f.tags||[]).length>2&&<span style={{fontSize:8,color:TXD}}>+{(f.tags||[]).length-2}</span>}
                      </div>
                    </td>
                    <td style={{padding:"8px"}}>
                      <div style={{display:"flex",gap:3,justifyContent:"flex-end"}}>
                        {f.whatsapp&&<a href={`https://wa.me/55${f.whatsapp.replace(/\D/g,'')}`} target="_blank" style={{fontSize:12,textDecoration:"none",padding:"2px 6px"}} title="WhatsApp">💬</a>}
                        {f.email&&<a href={`mailto:${f.email}`} style={{fontSize:12,textDecoration:"none",padding:"2px 6px"}} title="Email">📧</a>}
                        <button onClick={()=>togglePrincipal(f)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:f.fornecedor_principal?GO+"15":"transparent",color:f.fornecedor_principal?GO:TXM,border:`1px solid ${f.fornecedor_principal?GO:BD}`,cursor:"pointer"}} title="Marcar como principal">⭐</button>
                        <button onClick={()=>abrirEdicao(f)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:B+"12",color:B,border:`1px solid ${B}25`,cursor:"pointer"}}>Editar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Fornecedores v1.0 · Avaliação 360° · CNPJ via BrasilAPI</div>
    </div>
  );
}
