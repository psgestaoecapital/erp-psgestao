"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import ClienteForm from "@/components/clientes/ClienteForm";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { erroAmigavel } from "@/lib/erroAmigavel";

const ROTA = "/dashboard/clientes";

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
  excluido_em:string|null;
  created_at:string; updated_at:string;
};

const fmtCNPJ=(v:string)=>{const c=(v||'').replace(/\D/g,'');if(c.length===14)return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(c.length===11)return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return v;};
const fmtTel=(v:string)=>{const c=(v||'').replace(/\D/g,'');if(c.length===11)return c.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');if(c.length===10)return c.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');return v;};
const fmtR=(v:number)=>`R$ ${(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

export default function ClientesPage(){
  const { companyIds, selInfo, companies, sel } = useCompanyIds();
  const [clientes,setClientes]=useState<Cliente[]>([]);
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroRisco,setFiltroRisco]=useState<string>("todos");
  const [filtroAtivo,setFiltroAtivo]=useState<string>("ativos");
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState<Cliente|null>(null);
  const [msg,setMsg]=useState("");
  const [showImport,setShowImport]=useState(false);
  const [sortBy,setSortBy]=useState("razao_social");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("asc");

  // Empresa individual para novos cadastros (primeiro da lista quando consolidado/grupo)
  const companyIdParaCadastro = useMemo(()=>{
    if(sel && !sel.startsWith("group_") && sel!=="consolidado") return sel;
    return companyIds[0] || "";
  },[sel, companyIds]);

  // "🗑 Excluídos" troca o conjunto carregado (arquivados) — RD-98 p4: a lista normal nunca mostra excluídos.
  const verExcluidos = filtroAtivo==="excluidos";

  useEffect(()=>{
    if(companyIds.length>0)loadClientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[companyIds.join(","),verExcluidos]);

  const loadClientes=async()=>{
    if(companyIds.length===0){setLoading(false);return;}
    setLoading(true);
    let q=supabase.from("erp_clientes").select("*").in("company_id",companyIds).order("razao_social");
    q = verExcluidos ? q.not("excluido_em","is",null) : q.is("excluido_em",null);
    const{data,error}=await q;
    if(data)setClientes(data);
    if(error&&!error.message.includes('does not exist'))setMsg("❌ "+erroAmigavel(error,"Não foi possível carregar os clientes. Tente de novo."));
    setLoading(false);
  };

  const abrirEdicao=(c:Cliente)=>{setEditing(c);setShowForm(true);};
  const abrirNovo=()=>{setEditing(null);setShowForm(true);};
  const toggleBloqueado=async(c:Cliente)=>{await supabase.from("erp_clientes").update({bloqueado:!c.bloqueado}).eq("id",c.id);setClientes(clientes.map(x=>x.id===c.id?{...x,bloqueado:!x.bloqueado}:x));};
  // RD-98 p2/p4 · Excluir (arquivar, soft-delete rastreável) e Restaurar — via RPC guardada, nunca DELETE físico.
  const excluir=async(c:Cliente)=>{
    if(typeof window!=="undefined"&&!window.confirm(`Excluir o cliente "${c.nome_fantasia||c.razao_social}"? Ele sai da lista ativa, mas o histórico é preservado e você pode restaurá-lo depois.`))return;
    const{data,error}=await supabase.rpc("fn_cliente_arquivar",{p_id:c.id});
    const r=data as {ok?:boolean;erro?:string}|null;
    if(error||!r?.ok){setMsg("❌ "+(r?.erro||"Não foi possível excluir o cliente agora."));setTimeout(()=>setMsg(""),4000);return;}
    setClientes(clientes.filter(x=>x.id!==c.id));
    setMsg('✅ Cliente excluído. Ele fica em "🗑 Excluídos" e pode ser restaurado.');setTimeout(()=>setMsg(""),4000);
  };
  const restaurar=async(c:Cliente)=>{
    const{data,error}=await supabase.rpc("fn_cliente_restaurar",{p_id:c.id});
    const r=data as {ok?:boolean;erro?:string}|null;
    if(error||!r?.ok){setMsg("❌ "+(r?.erro||"Não foi possível restaurar o cliente agora."));setTimeout(()=>setMsg(""),4000);return;}
    setClientes(clientes.filter(x=>x.id!==c.id));
    setMsg("✅ Cliente restaurado para a lista ativa.");setTimeout(()=>setMsg(""),3000);
  };

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


  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};
  const corRisco=(r:string)=>r==='BAIXO'?G:r==='MEDIO'?Y:r==='ALTO'?R:TXD;
  const iconRisco=(r:string)=>r==='BAIXO'?'🟢':r==='MEDIO'?'🟡':r==='ALTO'?'🔴':'⚪';

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>👥 Clientes</div>
          <div style={{fontSize:11,color:TXD,display:"flex",alignItems:"center",gap:6}}>
            <span>Cadastro profissional com CNPJ automático, score de risco e limite de crédito</span>
            <span>·</span>
            <span style={{fontWeight:600,color:selInfo.isGroup?GO:TXM}}>
              {selInfo.tipo==='consolidado'?'📊 Todas':selInfo.tipo==='grupo'?'📁 Grupo':'🏢'} {selInfo.nome}
              {selInfo.isGroup&&` (${selInfo.count})`}
            </span>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setShowImport(true)} style={{padding:"8px 14px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📥 Importar</button>
          <AjudaCampo chave="ge.clientes.acao_importar" rota={ROTA} />
          <button onClick={abrirNovo} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo</button>
          <AjudaCampo chave="ge.clientes.acao_novo" rota={ROTA} />
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Clientes Ativos",v:String(kpiTotal),c:B,icon:"👥",ch:"ge.clientes.kpi_ativos"},
          {l:"Clientes VIP",v:String(kpiVIP),c:GO,icon:"⭐",ch:"ge.clientes.kpi_vip"},
          {l:"Risco Alto",v:String(kpiRiscoAlto),c:kpiRiscoAlto>0?R:G,icon:kpiRiscoAlto>0?"🔴":"✅",ch:"ge.clientes.kpi_risco_alto"},
          {l:"Limite Total",v:fmtR(kpiLimite),c:G,icon:"💳",ch:"ge.clientes.kpi_limite"},
          {l:"Utilizado",v:fmtR(kpiUtilizado),c:kpiUtilizado>kpiLimite*0.8?R:Y,icon:"📊",ch:"ge.clientes.kpi_utilizado"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5,display:"flex",alignItems:"center",gap:4}}>{k.icon} {k.l} <AjudaCampo chave={k.ch} rota={ROTA} /></div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative",display:"flex",alignItems:"center",gap:4}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por nome, CNPJ, email ou cidade..." style={{...inp,flex:1,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
          <AjudaCampo chave="ge.clientes.filtro_busca" rota={ROTA} />
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          <AjudaCampo chave="ge.clientes.filtro_risco" rota={ROTA} />
          {[{v:"todos",l:"Todos"},{v:"BAIXO",l:"🟢 Baixo"},{v:"MEDIO",l:"🟡 Médio"},{v:"ALTO",l:"🔴 Alto"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroRisco(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroRisco===f.v?GO:BD}`,background:filtroRisco===f.v?GO+"12":"transparent",color:filtroRisco===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroRisco===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          <AjudaCampo chave="ge.clientes.filtro_status" rota={ROTA} />
          {[{v:"ativos",l:"Ativos"},{v:"inativos",l:"Inativos"},{v:"bloqueados",l:"🚫 Bloqueados"},{v:"todos",l:"Todos"},{v:"excluidos",l:"🗑 Excluídos"}].map(f=>(
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
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
              {[
                // RD-100: nenhum nome de sistema de terceiro em tela geral. O provedor específico (API) é escolhido
                // na tela de Conectores (tela de integração); aqui ficam só as CATEGORIAS genéricas de origem.
                {k:'conectores',nome:'Conector automático',icon:'🔌',desc:'API direta — sincroniza sozinho',cor:G,href:'/dashboard/conectores'},
                {k:'planilha',nome:'Planilha Excel / CSV',icon:'📊',desc:'Qualquer sistema — mapeamento inteligente',cor:T,href:'/dashboard/importar'},
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
              <div style={{fontSize:10,color:TXM,lineHeight:1.5}}>Para qualquer sistema não listado ou planilhas antigas, use o <b>Excel/CSV</b>. O Importador Universal mapeia as colunas automaticamente — basta arrastar o arquivo.</div>
            </div>
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${GO}40`}}>
          <ClienteForm
            companyId={editing?editing.company_id:companyIdParaCadastro}
            initial={editing ?? {codigo:String(clientes.length+1).padStart(4,'0')}}
            onSaved={()=>{setShowForm(false);setEditing(null);setMsg("✅ Cliente salvo!");loadClientes();setTimeout(()=>setMsg(""),3000);}}
            onCancel={()=>{setShowForm(false);setEditing(null);}}
          />
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando clientes...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>{verExcluidos?"🗑":"👥"}</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>{verExcluidos?"Nenhum cliente excluído":(busca.trim()||filtroRisco!=="todos"||filtroAtivo!=="ativos")?"Nenhum cliente neste filtro":"Nenhum cliente cadastrado"}</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>{verExcluidos?"Clientes que você excluir aparecem aqui e podem ser restaurados.":(busca.trim()||filtroRisco!=="todos"||filtroAtivo!=="ativos")?"Ajuste a busca ou os filtros para ver mais clientes.":"Comece cadastrando manualmente ou importando de outro sistema."}</div>
              {!verExcluidos&&!busca.trim()&&filtroRisco==="todos"&&filtroAtivo==="ativos"&&(
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button onClick={abrirNovo} style={{padding:"10px 20px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Cadastrar Cliente</button>
                <button onClick={()=>setShowImport(true)} style={{padding:"10px 20px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📥 Importar de outro sistema</button>
              </div>
              )}
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>Razão / Fantasia <AjudaCampo chave="ge.clientes.col_razao" rota={ROTA} /></span></th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>CNPJ <AjudaCampo chave="ge.clientes.col_cnpj" rota={ROTA} /></span></th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>Cidade/UF <AjudaCampo chave="ge.clientes.col_cidade" rota={ROTA} /></span></th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>Risco <AjudaCampo chave="ge.clientes.col_risco" rota={ROTA} /></span></th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>Limite <AjudaCampo chave="ge.clientes.col_limite" rota={ROTA} /></span></th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>Tags <AjudaCampo chave="ge.clientes.col_tags" rota={ROTA} /></span></th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}><span style={{display:"inline-flex",alignItems:"center",gap:3}}>Ações <AjudaCampo chave="ge.clientes.col_acoes" rota={ROTA} /></span></th>
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
                        {verExcluidos?(
                          <button onClick={()=>restaurar(c)} title="Restaurar cliente" style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:G+"12",color:G,border:`1px solid ${G}25`,cursor:"pointer"}}>↩ Restaurar</button>
                        ):(<>
                          {c.whatsapp&&<a href={`https://wa.me/55${c.whatsapp.replace(/\D/g,'')}`} target="_blank" style={{fontSize:12,textDecoration:"none",padding:"2px 6px"}} title="WhatsApp">💬</a>}
                          {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:12,textDecoration:"none",padding:"2px 6px"}} title="Email">📧</a>}
                          <button onClick={()=>abrirEdicao(c)} title="Editar cliente" style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:B+"12",color:B,border:`1px solid ${B}25`,cursor:"pointer"}}>Editar</button>
                          <button onClick={()=>toggleBloqueado(c)} title={c.bloqueado?"Desbloquear":"Bloquear"} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:c.bloqueado?G+"12":R+"12",color:c.bloqueado?G:R,border:`1px solid ${c.bloqueado?G:R}25`,cursor:"pointer"}}>{c.bloqueado?"✓ Desbloq":"🚫 Bloq"}</button>
                          <button onClick={()=>excluir(c)} title="Excluir cliente" style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:R+"12",color:R,border:`1px solid ${R}25`,cursor:"pointer"}}>🗑 Excluir</button>
                        </>)}
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
