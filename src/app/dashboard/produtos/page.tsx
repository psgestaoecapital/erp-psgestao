"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Produto = {
  id:string; company_id:string; codigo:string; nome:string; descricao:string; tipo:string;
  categoria:string; subcategoria:string; marca:string; grupo:string; unidade:string;
  preco_venda:number; preco_custo:number; preco_custo_medio:number; margem_percentual:number;
  ncm:string; cfop_venda:string; cfop_compra:string; origem:string;
  estoque_atual:number; estoque_minimo:number; localizacao:string;
  fornecedor_padrao_nome:string; comissao_percentual:number;
  codigo_barras:string; ativo:boolean; destaque:boolean;
  created_at:string; updated_at:string;
};

const UNIDADES = ['UN','KG','G','M','M2','M3','LT','ML','CX','PCT','PR','JG','HR','SV','MÊS','DIA'];
const EMPTY:Partial<Produto> = {codigo:'',nome:'',descricao:'',tipo:'produto',categoria:'',subcategoria:'',marca:'',grupo:'',unidade:'UN',preco_venda:0,preco_custo:0,ncm:'',cfop_venda:'5102',cfop_compra:'1102',origem:'0',estoque_atual:0,estoque_minimo:0,localizacao:'',fornecedor_padrao_nome:'',comissao_percentual:0,codigo_barras:'',ativo:true,destaque:false};

const fmtR=(v:number)=>v===0?"—":`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtQ=(v:number)=>v===0?"0":v.toLocaleString("pt-BR",{maximumFractionDigits:1});

export default function ProdutosPage(){
  const [produtos,setProdutos]=useState<Produto[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroTipo,setFiltroTipo]=useState<string>("todos");
  const [filtroAtivo,setFiltroAtivo]=useState<string>("ativos");
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState<Produto|null>(null);
  const [form,setForm]=useState<Partial<Produto>>(EMPTY);
  const [msg,setMsg]=useState("");
  const [sortBy,setSortBy]=useState<string>("nome");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");
  const [tab,setTab]=useState<string>("lista");

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel)loadProdutos();},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadProdutos=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_produtos").select("*").eq("company_id",sel).order("nome");
    if(data)setProdutos(data);
    if(error)setMsg("Erro ao carregar: "+error.message);
    setLoading(false);
  };

  const salvar=async()=>{
    if(!form.nome?.trim()){setMsg("Nome é obrigatório.");return;}
    if(!form.codigo?.trim()){setMsg("Código é obrigatório.");return;}
    
    const dados={...form,company_id:sel,preco_venda:Number(form.preco_venda)||0,preco_custo:Number(form.preco_custo)||0,estoque_atual:Number(form.estoque_atual)||0,estoque_minimo:Number(form.estoque_minimo)||0,comissao_percentual:Number(form.comissao_percentual)||0};
    delete (dados as any).margem_percentual; // campo calculado, não enviar
    delete (dados as any).preco_custo_medio;
    delete (dados as any).id;
    delete (dados as any).created_at;
    delete (dados as any).updated_at;

    if(editing){
      const{error}=await supabase.from("erp_produtos").update(dados).eq("id",editing.id);
      if(error){setMsg("Erro: "+error.message);return;}
      setMsg("✅ Produto atualizado!");
    }else{
      const{error}=await supabase.from("erp_produtos").insert(dados);
      if(error){
        if(error.message.includes("unique"))setMsg("❌ Código já existe para esta empresa.");
        else setMsg("Erro: "+error.message);
        return;
      }
      setMsg("✅ Produto cadastrado!");
    }
    setShowForm(false);setEditing(null);setForm(EMPTY);loadProdutos();
    setTimeout(()=>setMsg(""),3000);
  };

  const excluir=async(id:string,nome:string)=>{
    if(!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`))return;
    await supabase.from("erp_produtos").delete().eq("id",id);
    setMsg("Produto excluído.");loadProdutos();setTimeout(()=>setMsg(""),3000);
  };

  const toggleAtivo=async(p:Produto)=>{
    await supabase.from("erp_produtos").update({ativo:!p.ativo}).eq("id",p.id);
    setProdutos(produtos.map(x=>x.id===p.id?{...x,ativo:!x.ativo}:x));
  };

  const abrirEdicao=(p:Produto)=>{setEditing(p);setForm({...p});setShowForm(true);setTab("lista");};
  const abrirNovo=()=>{setEditing(null);setForm({...EMPTY,codigo:String(produtos.length+1).padStart(4,'0')});setShowForm(true);};

  // Filtros e busca
  const filtrados=useMemo(()=>{
    let r=produtos;
    if(filtroTipo!=="todos")r=r.filter(p=>p.tipo===filtroTipo);
    if(filtroAtivo==="ativos")r=r.filter(p=>p.ativo);
    else if(filtroAtivo==="inativos")r=r.filter(p=>!p.ativo);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(p=>(p.nome||"").toLowerCase().includes(b)||(p.codigo||"").toLowerCase().includes(b)||(p.categoria||"").toLowerCase().includes(b)||(p.marca||"").toLowerCase().includes(b)||(p.codigo_barras||"").includes(b));
    }
    r.sort((a,b)=>{
      let va:any=(a as any)[sortBy]||"";let vb:any=(b as any)[sortBy]||"";
      if(typeof va==="number"&&typeof vb==="number")return sortDir==="asc"?va-vb:vb-va;
      return sortDir==="asc"?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));
    });
    return r;
  },[produtos,filtroTipo,filtroAtivo,busca,sortBy,sortDir]);

  // KPIs
  const totalProdutos=produtos.filter(p=>p.tipo==="produto"&&p.ativo).length;
  const totalServicos=produtos.filter(p=>p.tipo==="servico"&&p.ativo).length;
  const margemMedia=produtos.filter(p=>p.ativo&&p.preco_venda>0).reduce((s,p)=>{const m=p.preco_custo>0?((p.preco_venda-p.preco_custo)/p.preco_venda)*100:0;return s+m;},0)/(produtos.filter(p=>p.ativo&&p.preco_venda>0).length||1);
  const estoqueBaixo=produtos.filter(p=>p.ativo&&p.estoque_minimo>0&&p.estoque_atual<=p.estoque_minimo).length;
  const semPreco=produtos.filter(p=>p.ativo&&p.preco_venda===0).length;

  const doSort=(col:string)=>{if(sortBy===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortBy(col);setSortDir("asc");}};
  const sortIcon=(col:string)=>sortBy===col?(sortDir==="asc"?"↑":"↓"):"";

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>📦 Produtos & Serviços</div>
          <div style={{fontSize:11,color:TXD}}>Cadastro completo — preços, fiscal, estoque, fornecedores</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <button onClick={abrirNovo} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Produtos",v:String(totalProdutos),c:B,icon:"📦"},
          {l:"Serviços",v:String(totalServicos),c:P,icon:"🔧"},
          {l:"Margem Média",v:`${margemMedia.toFixed(1)}%`,c:margemMedia>20?G:margemMedia>10?Y:R,icon:"📊"},
          {l:"Estoque Baixo",v:String(estoqueBaixo),c:estoqueBaixo>0?R:G,icon:estoqueBaixo>0?"⚠️":"✅"},
          {l:"Sem Preço",v:String(semPreco),c:semPreco>0?Y:G,icon:semPreco>0?"💰":"✅"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Busca e filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por nome, código, categoria, marca ou código de barras..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          {[{v:"todos",l:"Todos"},{v:"produto",l:"📦 Produtos"},{v:"servico",l:"🔧 Serviços"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroTipo(f.v)} style={{padding:"6px 12px",borderRadius:6,fontSize:10,border:`1px solid ${filtroTipo===f.v?GO:BD}`,background:filtroTipo===f.v?GO+"12":"transparent",color:filtroTipo===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroTipo===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4}}>
          {[{v:"ativos",l:"Ativos"},{v:"inativos",l:"Inativos"},{v:"todos",l:"Todos"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroAtivo(f.v)} style={{padding:"6px 12px",borderRadius:6,fontSize:10,border:`1px solid ${filtroAtivo===f.v?GO:BD}`,background:filtroAtivo===f.v?GO+"12":"transparent",color:filtroAtivo===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroAtivo===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <span style={{fontSize:10,color:TXD}}>{filtrados.length} resultado{filtrados.length!==1?"s":""}</span>
      </div>

      {/* Formulário */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${GO}40`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:16,fontWeight:700,color:TX}}>{editing?"Editar":"Novo"} {form.tipo==="servico"?"Serviço":"Produto"}</div>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{background:"none",border:"none",color:TXD,fontSize:18,cursor:"pointer"}}>✕</button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo *</div>
              <select value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="produto">📦 Produto</option><option value="servico">🔧 Serviço</option><option value="kit">📋 Kit</option>
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Código *</div>
              <input value={form.codigo} onChange={e=>setForm({...form,codigo:e.target.value})} style={inp}/></div>
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome *</div>
              <input value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} placeholder="Nome do produto ou serviço" style={inp}/></div>

            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Categoria</div>
              <input value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})} placeholder="Ex: Gesso, Piso, Pintura" style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Marca</div>
              <input value={form.marca} onChange={e=>setForm({...form,marca:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Unidade</div>
              <select value={form.unidade} onChange={e=>setForm({...form,unidade:e.target.value})} style={{...inp,cursor:"pointer"}}>
                {UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cód. Barras (EAN)</div>
              <input value={form.codigo_barras} onChange={e=>setForm({...form,codigo_barras:e.target.value})} style={inp}/></div>

            {/* Preços */}
            <div style={{gridColumn:"span 4",borderTop:`1px solid ${BD}`,paddingTop:12,marginTop:4}}>
              <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:8}}>💰 Preços e Margem</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Preço de Venda (R$)</div>
                  <input type="number" step="0.01" value={form.preco_venda||""} onChange={e=>setForm({...form,preco_venda:parseFloat(e.target.value)||0})} style={{...inp,color:G}}/></div>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Preço de Custo (R$)</div>
                  <input type="number" step="0.01" value={form.preco_custo||""} onChange={e=>setForm({...form,preco_custo:parseFloat(e.target.value)||0})} style={{...inp,color:R}}/></div>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Margem (%)</div>
                  <div style={{...inp,background:BG3,fontWeight:700,color:(form.preco_venda||0)>0&&(form.preco_custo||0)>0?(((form.preco_venda||0)-(form.preco_custo||0))/(form.preco_venda||1)*100)>20?G:Y:TXD}}>
                    {(form.preco_venda||0)>0&&(form.preco_custo||0)>0?`${(((form.preco_venda||0)-(form.preco_custo||0))/(form.preco_venda||1)*100).toFixed(1)}%`:"—"}
                  </div></div>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Comissão (%)</div>
                  <input type="number" step="0.1" value={form.comissao_percentual||""} onChange={e=>setForm({...form,comissao_percentual:parseFloat(e.target.value)||0})} style={inp}/></div>
              </div>
            </div>

            {/* Estoque (só pra produtos) */}
            {form.tipo!=="servico"&&(
              <div style={{gridColumn:"span 4",borderTop:`1px solid ${BD}`,paddingTop:12,marginTop:4}}>
                <div style={{fontSize:11,fontWeight:600,color:B,marginBottom:8}}>📦 Estoque</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                  <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Estoque Atual</div>
                    <input type="number" step="0.1" value={form.estoque_atual||""} onChange={e=>setForm({...form,estoque_atual:parseFloat(e.target.value)||0})} style={inp}/></div>
                  <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Estoque Mínimo</div>
                    <input type="number" step="0.1" value={form.estoque_minimo||""} onChange={e=>setForm({...form,estoque_minimo:parseFloat(e.target.value)||0})} style={inp}/></div>
                  <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Localização</div>
                    <input value={form.localizacao} onChange={e=>setForm({...form,localizacao:e.target.value})} placeholder="Galpão A, Prat. 3" style={inp}/></div>
                  <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Fornecedor Padrão</div>
                    <input value={form.fornecedor_padrao_nome} onChange={e=>setForm({...form,fornecedor_padrao_nome:e.target.value})} style={inp}/></div>
                </div>
              </div>
            )}

            {/* Fiscal */}
            <div style={{gridColumn:"span 4",borderTop:`1px solid ${BD}`,paddingTop:12,marginTop:4}}>
              <div style={{fontSize:11,fontWeight:600,color:P,marginBottom:8}}>📄 Dados Fiscais</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>NCM</div>
                  <input value={form.ncm} onChange={e=>setForm({...form,ncm:e.target.value})} placeholder="0000.00.00" style={inp}/></div>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>CFOP Venda</div>
                  <input value={form.cfop_venda} onChange={e=>setForm({...form,cfop_venda:e.target.value})} placeholder="5102" style={inp}/></div>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>CFOP Compra</div>
                  <input value={form.cfop_compra} onChange={e=>setForm({...form,cfop_compra:e.target.value})} placeholder="1102" style={inp}/></div>
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Origem</div>
                  <select value={form.origem} onChange={e=>setForm({...form,origem:e.target.value})} style={{...inp,cursor:"pointer"}}>
                    <option value="0">0 — Nacional</option><option value="1">1 — Importado</option><option value="2">2 — Importado (adq. interna)</option>
                  </select></div>
              </div>
            </div>

            {/* Descrição */}
            <div style={{gridColumn:"span 4",borderTop:`1px solid ${BD}`,paddingTop:12,marginTop:4}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Descrição / Observações</div>
              <textarea value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})} rows={3} style={{...inp,resize:"vertical"}} placeholder="Descrição detalhada, especificações técnicas..."/>
            </div>
          </div>

          <div style={{marginTop:16,display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            <button onClick={salvar} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>{editing?"Salvar Alterações":"Cadastrar"}</button>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando produtos...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>📦</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum produto cadastrado</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Comece cadastrando seus produtos e serviços.</div>
              <button onClick={abrirNovo} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Cadastrar Primeiro Produto</button>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}>
                <tr style={{borderBottom:`2px solid ${BD}`}}>
                  {[
                    {k:"codigo",l:"Código",w:70},{k:"nome",l:"Nome",w:0},{k:"tipo",l:"Tipo",w:70},{k:"categoria",l:"Categoria",w:100},
                    {k:"preco_venda",l:"Preço Venda",w:100},{k:"preco_custo",l:"Preço Custo",w:100},{k:"margem_percentual",l:"Margem",w:70},
                    {k:"estoque_atual",l:"Estoque",w:70},{k:"",l:"Ações",w:80},
                  ].map(col=>(
                    <th key={col.k||col.l} onClick={()=>col.k&&doSort(col.k)} style={{padding:"8px 8px",textAlign:col.k==="preco_venda"||col.k==="preco_custo"||col.k==="margem_percentual"||col.k==="estoque_atual"?"right":"left",color:TXD,fontSize:10,fontWeight:600,cursor:col.k?"pointer":"default",width:col.w||"auto",whiteSpace:"nowrap",userSelect:"none"}}>
                      {col.l} {sortIcon(col.k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map(p=>{
                  const estoqueOk=p.estoque_minimo<=0||p.estoque_atual>p.estoque_minimo;
                  const margem=p.preco_venda>0&&p.preco_custo>0?((p.preco_venda-p.preco_custo)/p.preco_venda)*100:0;
                  return(
                    <tr key={p.id} style={{borderBottom:`0.5px solid ${BD}`,opacity:p.ativo?1:0.5,background:!estoqueOk?R+"06":"transparent"}}>
                      <td style={{padding:"6px 8px",color:P,fontFamily:"monospace",fontSize:11}}>{p.codigo}</td>
                      <td style={{padding:"6px 8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{p.nome}</div>
                        {p.marca&&<div style={{fontSize:9,color:TXD}}>{p.marca}</div>}
                      </td>
                      <td style={{padding:"6px 8px"}}><span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:p.tipo==="servico"?P+"15":p.tipo==="kit"?T+"15":B+"15",color:p.tipo==="servico"?P:p.tipo==="kit"?T:B,fontWeight:600}}>{p.tipo==="servico"?"Serviço":p.tipo==="kit"?"Kit":"Produto"}</span></td>
                      <td style={{padding:"6px 8px",color:TXM,fontSize:10}}>{p.categoria||"—"}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:G,fontWeight:600}}>{fmtR(p.preco_venda)}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:R}}>{fmtR(p.preco_custo)}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:margem>20?G:margem>10?Y:margem>0?R:TXD}}>{margem>0?`${margem.toFixed(1)}%`:"—"}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:!estoqueOk?R:TX,fontWeight:!estoqueOk?700:400}}>{p.tipo!=="servico"?fmtQ(p.estoque_atual):"—"}{!estoqueOk&&" ⚠️"}</td>
                      <td style={{padding:"6px 8px"}}>
                        <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
                          <button onClick={()=>abrirEdicao(p)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:B+"12",color:B,border:`1px solid ${B}25`,cursor:"pointer"}}>Editar</button>
                          <button onClick={()=>toggleAtivo(p)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:p.ativo?Y+"12":G+"12",color:p.ativo?Y:G,border:`1px solid ${p.ativo?Y:G}25`,cursor:"pointer"}}>{p.ativo?"Inativar":"Ativar"}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Produtos & Serviços v1.0</div>
    </div>
  );
}
