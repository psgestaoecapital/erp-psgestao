"use client";
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>`R$ ${(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fDt=(d:string|null)=>{if(!d)return"—";try{return new Date(d+"T12:00:00").toLocaleDateString("pt-BR");}catch{return d;}};

const FORMAS_PGTO=["PIX","Boleto","Cartão Crédito","Cartão Débito","Transferência","Dinheiro","Cheque","Débito Automático"];
const STATUS_CORES:any={aberto:C.b,pago:C.g,parcial:C.y,vencido:C.r,cancelado:C.txd};

export default function OperacionalPage(){
  const[tab,setTab]=useState("receber");
  const[companyId,setCompanyId]=useState("");
  const[companies,setCompanies]=useState<any[]>([]);
  const[items,setItems]=useState<any[]>([]);
  const[loading,setLoading]=useState(false);
  const[showForm,setShowForm]=useState(false);
  const[editItem,setEditItem]=useState<any>(null);
  const[resumo,setResumo]=useState<any>(null);
  const[busca,setBusca]=useState("");
  const[filtroStatus,setFiltroStatus]=useState("todos");
  const[toast,setToast]=useState("");

  const tabs=[
    {id:"receber",l:"💰 A Receber",c:C.g,tipo:"erp_receber"},
    {id:"pagar",l:"💸 A Pagar",c:C.r,tipo:"erp_pagar"},
    {id:"clientes",l:"👤 Clientes",c:C.b,tipo:"erp_clientes"},
    {id:"fornecedores",l:"🏭 Fornecedores",c:C.or,tipo:"erp_fornecedores"},
    {id:"produtos",l:"📦 Produtos",c:C.p,tipo:"erp_produtos"},
    {id:"contas",l:"🏦 Contas Bancárias",c:C.cy,tipo:"erp_contas_bancarias"},
  ];
  const tabAtual=tabs.find(t=>t.id===tab)||tabs[0];

  // Load companies
  useEffect(()=>{
    (async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user)return;
      const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
      let comps:any[]=[];
      if(up?.role==="adm"||up?.role==="acesso_total"){
        const{data}=await supabase.from("companies").select("*").order("nome");
        comps=data||[];
      } else {
        const{data:uc}=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);
        comps=(uc||[]).map((u:any)=>u.companies).filter(Boolean);
      }
      setCompanies(comps);
      if(comps.length>0)setCompanyId(comps[0].id);
    })();
  },[]);

  // Load data
  const loadData=useCallback(async()=>{
    if(!companyId)return;
    setLoading(true);
    try{
      const params=new URLSearchParams({company_id:companyId,tipo:tabAtual.tipo});
      if(filtroStatus!=="todos"&&(tab==="receber"||tab==="pagar"))params.set("status",filtroStatus);
      const res=await fetch(`/api/financeiro?${params}`);
      const json=await res.json();
      if(json.success){setItems(json.data);setResumo(json.resumo);}
    }catch{}
    setLoading(false);
  },[companyId,tab,filtroStatus]);

  useEffect(()=>{loadData();},[loadData]);

  const showToast=(msg:string)=>{setToast(msg);setTimeout(()=>setToast(""),3000);};

  // SAVE (create or update)
  const handleSave=async(dados:any)=>{
    const isEdit=!!editItem?.id;
    const method=isEdit?"PUT":"POST";
    const body=isEdit?{...dados,tipo:tabAtual.tipo,id:editItem.id}:{...dados,tipo:tabAtual.tipo,company_id:companyId};
    const res=await fetch("/api/financeiro",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const json=await res.json();
    if(json.success){showToast(isEdit?"✅ Atualizado!":"✅ Criado!");setShowForm(false);setEditItem(null);loadData();}
    else showToast("❌ Erro: "+json.error);
  };

  // DELETE
  const handleDelete=async(id:string)=>{
    if(!confirm("Excluir este registro?"))return;
    const res=await fetch(`/api/financeiro?tipo=${tabAtual.tipo}&id=${id}`,{method:"DELETE"});
    const json=await res.json();
    if(json.success){showToast("🗑️ Excluído!");loadData();}
    else showToast("❌ Erro: "+json.error);
  };

  // BAIXAR (pagar/receber)
  const handleBaixar=async(item:any)=>{
    const body={tipo:tabAtual.tipo,id:item.id,status:"pago",valor_pago:item.valor,data_pagamento:new Date().toISOString().split("T")[0]};
    const res=await fetch("/api/financeiro",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const json=await res.json();
    if(json.success){showToast("✅ Baixa realizada!");loadData();}
  };

  // Filter by search
  const filtered=items.filter(i=>{
    if(!busca)return true;
    const b=busca.toLowerCase();
    return Object.values(i).some(v=>String(v).toLowerCase().includes(b));
  });

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {/* HEADER */}
      <div style={{background:C.esp,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.gol}}>PS Gestão — Operacional</div>
          <div style={{fontSize:9,color:C.txm}}>Contas a Pagar/Receber · Clientes · Fornecedores · Produtos · Contas Bancárias</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <select value={companyId} onChange={e=>setCompanyId(e.target.value)} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,borderRadius:6,padding:"4px 8px",fontSize:10}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"4px 10px",border:`1px solid ${C.bd}`,borderRadius:6,color:C.txm,fontSize:10,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:2,padding:"6px 12px",background:C.bg2,overflowX:"auto",borderBottom:`1px solid ${C.bd}`}}>
        {tabs.map(t=><button key={t.id} onClick={()=>{setTab(t.id);setShowForm(false);setEditItem(null);setBusca("");setFiltroStatus("todos");}} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:tab===t.id?700:500,background:tab===t.id?t.c+"20":"transparent",color:tab===t.id?t.c:C.txm,whiteSpace:"nowrap"}}>{t.l}</button>)}
      </div>

      <div style={{padding:"10px 12px",maxWidth:1400,margin:"0 auto"}}>

      {/* RESUMO (contas pagar/receber) */}
      {resumo&&(tab==="receber"||tab==="pagar")&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:10}}>
          {[
            {l:"Em Aberto",v:fR(resumo.aberto),s:`${resumo.qtdAberto} títulos`,c:C.b},
            {l:"Vencidos",v:fR(resumo.vencido),s:`${resumo.qtdVencido} títulos`,c:C.r},
            {l:tab==="receber"?"Recebido":"Pago",v:fR(resumo.pago),s:`${resumo.qtdPago} títulos`,c:C.g},
            {l:"Total Geral",v:fR(resumo.aberto+resumo.pago+resumo.vencido),s:`${resumo.total} títulos`,c:C.gol},
            {l:"Fontes",v:`${resumo.total}`,s:`PS:${resumo.qtdPSGestao||0} Omie:${resumo.qtdOmie||0} Nibo:${resumo.qtdNibo||0}`,c:C.p},
          ].map((k,i)=>(
            <div key={i} style={{background:C.bg2,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${k.c}`}}>
              <div style={{fontSize:7,color:C.txd,textTransform:"uppercase"}}>{k.l}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.c}}>{k.v}</div>
              <div style={{fontSize:7,color:C.txm}}>{k.s}</div>
            </div>
          ))}
        </div>
      )}

      {/* TOOLBAR */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Buscar..." style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.tx,borderRadius:6,padding:"6px 10px",fontSize:10,width:200}}/>
          {(tab==="receber"||tab==="pagar")&&(
            <div style={{display:"flex",gap:2}}>
              {["todos","aberto","vencido","pago","cancelado"].map(s=>(
                <button key={s} onClick={()=>setFiltroStatus(s)} style={{padding:"4px 8px",borderRadius:4,border:"none",cursor:"pointer",fontSize:8,
                  background:filtroStatus===s?(STATUS_CORES[s]||C.go)+"20":"transparent",
                  color:filtroStatus===s?(STATUS_CORES[s]||C.gol):C.txm}}>{s==="todos"?"Todos":s.charAt(0).toUpperCase()+s.slice(1)}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={()=>{setShowForm(true);setEditItem(null);}} style={{padding:"6px 14px",borderRadius:6,border:"none",background:tabAtual.c,color:C.bg,fontSize:10,fontWeight:700,cursor:"pointer"}}>+ Novo {tabAtual.l.split(" ").pop()}</button>
      </div>

      {/* FORM MODAL */}
      {showForm&&(
        <div style={{background:C.bg2,borderRadius:10,padding:16,border:`1px solid ${tabAtual.c}40`,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:tabAtual.c,marginBottom:10}}>{editItem?"✏️ Editar":"+ Novo"} {tabAtual.l}</div>
          <FormComponent tipo={tab} item={editItem} onSave={handleSave} onCancel={()=>{setShowForm(false);setEditItem(null);}} cor={tabAtual.c}/>
        </div>
      )}

      {/* TABELA */}
      {loading?<div style={{textAlign:"center",padding:40,color:C.txm}}>Carregando...</div>:(
        <div style={{background:C.bg2,borderRadius:10,padding:8,border:`1px solid ${C.bd}`}}>
          {filtered.length===0?(
            <div style={{textAlign:"center",padding:30,color:C.txd}}>
              {items.length===0?"Nenhum registro ainda. Clique em '+ Novo' para começar.":"Nenhum resultado para a busca."}
            </div>
          ):(
            <div style={{overflowX:"auto"}}>
              {(tab==="receber"||tab==="pagar")&&<TabelaContas items={filtered} tipo={tab} onEdit={(i:any)=>{setEditItem(i);setShowForm(true);}} onDelete={handleDelete} onBaixar={handleBaixar}/>}
              {tab==="clientes"&&<TabelaCadastro items={filtered} campos={["nome","cpf_cnpj","email","telefone","cidade","uf"]} onEdit={(i:any)=>{setEditItem(i);setShowForm(true);}} onDelete={handleDelete}/>}
              {tab==="fornecedores"&&<TabelaCadastro items={filtered} campos={["nome","cpf_cnpj","email","telefone","cidade","uf"]} onEdit={(i:any)=>{setEditItem(i);setShowForm(true);}} onDelete={handleDelete}/>}
              {tab==="produtos"&&<TabelaCadastro items={filtered} campos={["codigo","nome","unidade","preco_venda","preco_custo","estoque_atual","categoria"]} onEdit={(i:any)=>{setEditItem(i);setShowForm(true);}} onDelete={handleDelete}/>}
              {tab==="contas"&&<TabelaCadastro items={filtered} campos={["nome","banco","agencia","conta","tipo","saldo_atual"]} onEdit={(i:any)=>{setEditItem(i);setShowForm(true);}} onDelete={handleDelete}/>}
            </div>
          )}
        </div>
      )}

      </div>
      {toast&&<div style={{position:"fixed",bottom:20,right:20,padding:"10px 20px",borderRadius:8,background:C.bg2,border:`1px solid ${C.go}`,color:C.gol,fontSize:12,fontWeight:600,boxShadow:"0 4px 12px rgba(0,0,0,0.5)"}}>{toast}</div>}
    </div>
  );
}

// ═══ TABELA CONTAS PAGAR/RECEBER ═══
function TabelaContas({items,tipo,onEdit,onDelete,onBaixar}:any){
  return(
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
      <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
        {["Origem","Descrição",tipo==="receber"?"Cliente":"Fornecedor","Valor","Vencimento","Pagamento","Status","Ações"].map(h=>
          <th key={h} style={{padding:"6px 4px",textAlign:h==="Valor"||h==="Ações"?"center":"left",color:C.gol,fontSize:9}}>{h}</th>)}
      </tr></thead>
      <tbody>
        {items.map((i:any,idx:number)=>{
          const vencido=i.status==="aberto"&&i.data_vencimento&&new Date(i.data_vencimento)<new Date();
          const st=vencido?"vencido":i.status;
          const origemCor=i._origem==="Omie"?C.b:i._origem==="Nibo"?C.p:C.g;
          return(
            <tr key={i.id||idx} style={{borderBottom:`0.5px solid ${C.bd}20`,background:vencido?C.r+"05":"transparent"}}>
              <td style={{padding:"5px 4px"}}><span style={{padding:"1px 5px",borderRadius:3,fontSize:7,fontWeight:600,background:origemCor+"20",color:origemCor}}>{i._origem||"PS Gestão"}</span></td>
              <td style={{padding:"5px 4px",color:C.tx,maxWidth:200}}><div style={{fontWeight:600}}>{i.descricao}</div><div style={{fontSize:8,color:C.txd}}>{i.categoria} {i.numero_nf?`· NF ${i.numero_nf}`:""}</div></td>
              <td style={{padding:"5px 4px",color:C.txm,fontSize:9}}>{i.cliente_nome||i.fornecedor_nome||"—"}</td>
              <td style={{padding:"5px 4px",textAlign:"center",fontWeight:600,color:tipo==="receber"?C.g:C.r}}>{fR(i.valor)}</td>
              <td style={{padding:"5px 4px",color:vencido?C.r:C.txm}}>{fDt(i.data_vencimento)}</td>
              <td style={{padding:"5px 4px",color:C.txm}}>{fDt(i.data_pagamento)}</td>
              <td style={{padding:"5px 4px"}}><span style={{padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:600,background:(STATUS_CORES[st]||C.txd)+"20",color:STATUS_CORES[st]||C.txd}}>{st}</span></td>
              <td style={{padding:"5px 4px",textAlign:"center"}}>
                {i._editavel!==false?(
                  <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                    {st!=="pago"&&st!=="cancelado"&&<button onClick={()=>onBaixar(i)} style={{padding:"2px 6px",borderRadius:4,border:"none",background:C.g+"20",color:C.g,fontSize:8,cursor:"pointer"}}>✅ Baixar</button>}
                    <button onClick={()=>onEdit(i)} style={{padding:"2px 6px",borderRadius:4,border:"none",background:C.b+"20",color:C.b,fontSize:8,cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>onDelete(i.id)} style={{padding:"2px 6px",borderRadius:4,border:"none",background:C.r+"20",color:C.r,fontSize:8,cursor:"pointer"}}>🗑️</button>
                  </div>
                ):(
                  <span style={{fontSize:7,color:C.txd}}>via {i._origem}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ═══ TABELA CADASTRO GENÉRICA ═══
function TabelaCadastro({items,campos,onEdit,onDelete}:any){
  return(
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
      <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
        <th style={{padding:"6px 4px",textAlign:"left",color:C.gol,fontSize:9}}>Origem</th>
        {campos.map((c:string)=><th key={c} style={{padding:"6px 4px",textAlign:"left",color:C.gol,fontSize:9}}>{c.replace(/_/g," ").replace(/\b\w/g,(l:string)=>l.toUpperCase())}</th>)}
        <th style={{padding:"6px 4px",textAlign:"center",color:C.gol,fontSize:9}}>Ações</th>
      </tr></thead>
      <tbody>
        {items.map((i:any,idx:number)=>{
          const origemCor=i._origem==="Omie"?C.b:i._origem==="Nibo"?C.p:C.g;
          return(
            <tr key={i.id||idx} style={{borderBottom:`0.5px solid ${C.bd}20`}}>
              <td style={{padding:"5px 4px"}}><span style={{padding:"1px 5px",borderRadius:3,fontSize:7,fontWeight:600,background:origemCor+"20",color:origemCor}}>{i._origem||"PS Gestão"}</span></td>
              {campos.map((c:string)=>{
                const v=i[c];
                const isNum=typeof v==="number";
                return<td key={c} style={{padding:"5px 4px",color:isNum?C.g:C.tx,fontWeight:c==="nome"?600:400}}>{isNum&&(c.includes("preco")||c.includes("saldo"))?fR(v):v||"—"}</td>;
              })}
              <td style={{padding:"5px 4px",textAlign:"center"}}>
                {i._editavel!==false?(
                  <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                    <button onClick={()=>onEdit(i)} style={{padding:"2px 6px",borderRadius:4,border:"none",background:C.b+"20",color:C.b,fontSize:8,cursor:"pointer"}}>✏️</button>
                    <button onClick={()=>onDelete(i.id)} style={{padding:"2px 6px",borderRadius:4,border:"none",background:C.r+"20",color:C.r,fontSize:8,cursor:"pointer"}}>🗑️</button>
                  </div>
                ):(
                  <span style={{fontSize:7,color:C.txd}}>via {i._origem}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ═══ FORM DINÂMICO ═══
function FormComponent({tipo,item,onSave,onCancel,cor}:any){
  const[form,setForm]=useState<any>(item||{});
  const set=(k:string,v:any)=>setForm({...form,[k]:v});
  const Input=({label,field,type="text",w="100%"}:{label:string;field:string;type?:string;w?:string})=>(
    <div style={{width:w}}>
      <label style={{fontSize:8,color:C.txd,display:"block",marginBottom:2}}>{label}</label>
      <input value={form[field]||""} onChange={e=>set(field,type==="number"?parseFloat(e.target.value)||0:e.target.value)} type={type}
        style={{width:"100%",padding:"6px 8px",borderRadius:6,border:`1px solid ${C.bd}`,background:C.bg3,color:C.tx,fontSize:10,boxSizing:"border-box"}}/>
    </div>
  );
  const Select=({label,field,options}:{label:string;field:string;options:string[]})=>(
    <div>
      <label style={{fontSize:8,color:C.txd,display:"block",marginBottom:2}}>{label}</label>
      <select value={form[field]||""} onChange={e=>set(field,e.target.value)} style={{width:"100%",padding:"6px 8px",borderRadius:6,border:`1px solid ${C.bd}`,background:C.bg3,color:C.tx,fontSize:10}}>
        <option value="">Selecione...</option>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return(
    <div>
      {(tipo==="receber"||tipo==="pagar")&&(
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
          <Input label="Descrição *" field="descricao"/>
          <Input label="Valor *" field="valor" type="number"/>
          <Input label="Vencimento *" field="data_vencimento" type="date"/>
          <Input label={tipo==="receber"?"Cliente":"Fornecedor"} field={tipo==="receber"?"cliente_nome":"fornecedor_nome"}/>
          <Input label="Categoria" field="categoria"/>
        </div>
      )}
      {(tipo==="receber"||tipo==="pagar")&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
          <Select label="Forma Pagamento" field="forma_pagamento" options={FORMAS_PGTO}/>
          <Input label="Nº Documento" field="numero_documento"/>
          <Input label="Nº NF" field="numero_nf"/>
          <Input label="Centro Custo" field="centro_custo"/>
          <Input label="Linha Negócio" field="linha_negocio"/>
        </div>
      )}
      {(tipo==="clientes"||tipo==="fornecedores")&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Input label="Nome / Razão Social *" field="nome"/>
            <Input label="Nome Fantasia" field="nome_fantasia"/>
            <Input label="CPF/CNPJ" field="cpf_cnpj"/>
            <Select label="Tipo" field="tipo" options={["PF","PJ"]}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Input label="Email" field="email"/>
            <Input label="Telefone" field="telefone"/>
            <Input label="Celular" field="celular"/>
            <Input label="Cidade" field="cidade"/>
            <Input label="UF" field="uf"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Input label="CEP" field="cep"/>
            <Input label="Endereço" field="endereco"/>
            <Input label="Número" field="numero"/>
            <Input label="Bairro" field="bairro"/>
          </div>
        </>
      )}
      {tipo==="produtos"&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Input label="Código" field="codigo"/>
            <Input label="Nome *" field="nome"/>
            <Input label="Unidade" field="unidade"/>
            <Input label="Preço Venda" field="preco_venda" type="number"/>
            <Input label="Preço Custo" field="preco_custo" type="number"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Input label="Estoque Atual" field="estoque_atual" type="number"/>
            <Input label="Estoque Mínimo" field="estoque_minimo" type="number"/>
            <Input label="NCM" field="ncm"/>
            <Input label="Categoria" field="categoria"/>
            <Input label="Marca" field="marca"/>
          </div>
        </>
      )}
      {tipo==="contas"&&(
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
          <Input label="Nome da Conta *" field="nome"/>
          <Input label="Banco" field="banco"/>
          <Input label="Agência" field="agencia"/>
          <Input label="Conta" field="conta"/>
          <Input label="Saldo Inicial" field="saldo_inicial" type="number"/>
        </div>
      )}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={()=>onSave(form)} style={{padding:"8px 20px",borderRadius:6,border:"none",background:cor,color:C.bg,fontSize:11,fontWeight:700,cursor:"pointer"}}>💾 Salvar</button>
        <button onClick={onCancel} style={{padding:"8px 20px",borderRadius:6,border:`1px solid ${C.bd}`,background:"transparent",color:C.txm,fontSize:11,cursor:"pointer"}}>Cancelar</button>
      </div>
    </div>
  );
}
