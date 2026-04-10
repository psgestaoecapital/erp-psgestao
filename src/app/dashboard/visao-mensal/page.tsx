"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>v===0?"—":`R$ ${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fmtRFull=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

type Lancamento={dia:number;valor:number;doc:string;obs:string;cliente:string;categoria:string;status:string;vencimento:string;emissao:string;};
type GrupoRow={id:string;nome:string;tipo:"receita"|"despesa"|"custo";totalMes:number;dias:Record<number,number>;lancamentos:Record<number,Lancamento[]>;filhos?:GrupoRow[];};

export default function VisaoMensalPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [groups,setGroups]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState("");
  const [mesAno,setMesAno]=useState(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [loading,setLoading]=useState(true);
  const [rows,setRows]=useState<GrupoRow[]>([]);
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [tooltip,setTooltip]=useState<{x:number;y:number;items:Lancamento[]}|null>(null);
  const [totalRecMes,setTotalRecMes]=useState(0);
  const [totalDespMes,setTotalDespMes]=useState(0);

  const [ano,mes]=mesAno.split("-").map(Number);
  const diasNoMes=new Date(ano,mes,0).getDate();
  const diasArray=Array.from({length:diasNoMes},(_,i)=>i+1);
  const hoje=new Date();
  const diaHoje=hoje.getFullYear()===ano&&hoje.getMonth()+1===mes?hoje.getDate():0;

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selectedComp)loadData();},[selectedComp,mesAno]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    const{data:grps}=await supabase.from("company_groups").select("*").order("nome");
    if(grps)setGroups(grps);
    let data:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const r=await supabase.from("companies").select("*").order("nome_fantasia");data=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);data=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(data.length>0){setCompanies(data);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";const match=saved?data.find((c:any)=>c.id===saved):null;setSelectedComp(match?match.id:data[0].id);}
    setLoading(false);
  };

  const parseDia=(dt:string):number|null=>{
    if(!dt)return null;
    const p1=dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(p1){const d=parseInt(p1[1]),m=parseInt(p1[2]);let a=parseInt(p1[3]);if(p1[3].length===2)a=2000+a;if(a===ano&&m===mes)return d;}
    const p2=dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if(p2){const a2=parseInt(p2[1]),m2=parseInt(p2[2]),d2=parseInt(p2[3]);if(a2===ano&&m2===mes)return d2;}
    return null;
  };

  const loadData=async()=>{
    setLoading(true);
    let compIds:string[]=[];
    if(selectedComp.startsWith("group_")){
      const gid=selectedComp.replace("group_","");
      compIds=companies.filter(c=>c.group_id===gid).map(c=>c.id);
    }else{compIds=[selectedComp];}

    const{data:imports}=await supabase.from("omie_imports").select("import_type,import_data").in("company_id",compIds);
    if(!imports){setLoading(false);return;}

    // Build client name map
    const clienteNomes:Record<string,string>={};
    for(const imp of imports){
      if(imp.import_type==="clientes"){
        const cls=imp.import_data?.clientes_cadastro||[];
        if(Array.isArray(cls))for(const c of cls){
          const cod=c.codigo_cliente_omie||c.codigo_cliente||c.codigo;
          clienteNomes[String(cod)]=c.nome_fantasia||c.razao_social||c.nome||"";
        }
      }
    }

    // Category map
    const catMap:Record<string,string>={};
    for(const imp of imports){
      if(imp.import_type==="categorias"){
        const cats=imp.import_data?.categoria_cadastro||[];
        if(Array.isArray(cats))for(const c of cats){
          const cod=c.codigo||c.cCodigo||"";
          const desc=c.descricao||c.cDescricao||"";
          if(cod)catMap[cod]=desc;
        }
      }
    }

    const STATUS_EXCL=new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

    // Process receitas by client
    const recClientes:Record<string,GrupoRow>={};
    let tRec=0;
    for(const imp of imports){
      if(imp.import_type!=="contas_receber")continue;
      const regs=imp.import_data?.conta_receber_cadastro||[];
      if(!Array.isArray(regs))continue;
      for(const r of regs){
        const st=(r.status_titulo||"").toUpperCase();
        if(STATUS_EXCL.has(st))continue;
        const v=Number(r.valor_documento)||0;
        if(v<=0)continue;
        const dt=r.data_emissao||r.data_vencimento||"";
        const dia=parseDia(dt);
        if(dia===null)continue;
        const codCF=String(r.codigo_cliente_fornecedor||"");
        const nome=clienteNomes[codCF]||`Cliente ${codCF}`;
        const cat=r.codigo_categoria||"";
        const catNome=catMap[cat]||r.descricao_categoria||cat;
        if(!recClientes[nome])recClientes[nome]={id:`rec_${nome}`,nome,tipo:"receita",totalMes:0,dias:{},lancamentos:{}};
        recClientes[nome].totalMes+=v;
        recClientes[nome].dias[dia]=(recClientes[nome].dias[dia]||0)+v;
        if(!recClientes[nome].lancamentos[dia])recClientes[nome].lancamentos[dia]=[];
        recClientes[nome].lancamentos[dia].push({dia,valor:v,doc:r.numero_documento||r.numero_documento_fiscal||"",obs:r.observacao||"",cliente:nome,categoria:catNome,status:r.status_titulo||"",vencimento:r.data_vencimento||"",emissao:r.data_emissao||""});
        tRec+=v;
      }
    }

    // Process despesas by category
    const despCats:Record<string,GrupoRow>={};
    let tDesp=0;
    for(const imp of imports){
      if(imp.import_type!=="contas_pagar")continue;
      const regs=imp.import_data?.conta_pagar_cadastro||[];
      if(!Array.isArray(regs))continue;
      for(const r of regs){
        const st=(r.status_titulo||"").toUpperCase();
        if(STATUS_EXCL.has(st))continue;
        const v=Number(r.valor_documento)||0;
        if(v<=0)continue;
        const dt=r.data_emissao||r.data_vencimento||"";
        const dia=parseDia(dt);
        if(dia===null)continue;
        const cat=r.codigo_categoria||"sem_cat";
        const catNome=catMap[cat]||r.descricao_categoria||cat;
        const codCF=String(r.codigo_cliente_fornecedor||"");
        const fornecedor=r.observacao||clienteNomes[codCF]||`Fornecedor ${codCF}`;
        const isCusto=cat.startsWith("2.01")||cat.startsWith("2.02")||cat.startsWith("2.03");
        const tipo=isCusto?"custo":"despesa";
        const groupKey=catNome||cat;
        if(!despCats[groupKey])despCats[groupKey]={id:`desp_${groupKey}`,nome:groupKey,tipo,totalMes:0,dias:{},lancamentos:{}};
        despCats[groupKey].totalMes+=v;
        despCats[groupKey].dias[dia]=(despCats[groupKey].dias[dia]||0)+v;
        if(!despCats[groupKey].lancamentos[dia])despCats[groupKey].lancamentos[dia]=[];
        despCats[groupKey].lancamentos[dia].push({dia,valor:v,doc:r.numero_documento||"",obs:r.observacao||"",cliente:fornecedor,categoria:catNome,status:r.status_titulo||"",vencimento:r.data_vencimento||"",emissao:r.data_emissao||""});
        tDesp+=v;
      }
    }

    // Build tree
    const recFilhos=Object.values(recClientes).sort((a,b)=>b.totalMes-a.totalMes);
    const recTotal:GrupoRow={id:"RECEITAS",nome:"RECEITAS",tipo:"receita",totalMes:tRec,dias:{},lancamentos:{},filhos:recFilhos};
    for(const f of recFilhos)for(const[d,v]of Object.entries(f.dias))recTotal.dias[Number(d)]=(recTotal.dias[Number(d)]||0)+v;

    const custoFilhos=Object.values(despCats).filter(d=>d.tipo==="custo").sort((a,b)=>b.totalMes-a.totalMes);
    const custoTotal:GrupoRow={id:"CUSTOS",nome:"(-) CUSTOS DIRETOS",tipo:"custo",totalMes:custoFilhos.reduce((s,c)=>s+c.totalMes,0),dias:{},lancamentos:{},filhos:custoFilhos};
    for(const f of custoFilhos)for(const[d,v]of Object.entries(f.dias))custoTotal.dias[Number(d)]=(custoTotal.dias[Number(d)]||0)+v;

    const despFilhos=Object.values(despCats).filter(d=>d.tipo==="despesa").sort((a,b)=>b.totalMes-a.totalMes);
    const despTotal:GrupoRow={id:"DESPESAS",nome:"(-) DESPESAS",tipo:"despesa",totalMes:despFilhos.reduce((s,c)=>s+c.totalMes,0),dias:{},lancamentos:{},filhos:despFilhos};
    for(const f of despFilhos)for(const[d,v]of Object.entries(f.dias))despTotal.dias[Number(d)]=(despTotal.dias[Number(d)]||0)+v;

    // Resultado
    const resDias:Record<number,number>={};
    for(const d of diasArray)resDias[d]=(recTotal.dias[d]||0)-(custoTotal.dias[d]||0)-(despTotal.dias[d]||0);
    const resTotal:GrupoRow={id:"RESULTADO",nome:"= RESULTADO",tipo:"receita",totalMes:tRec-tDesp,dias:resDias,lancamentos:{}};

    setRows([recTotal,custoTotal,despTotal,resTotal]);
    setTotalRecMes(tRec);
    setTotalDespMes(tDesp);
    setLoading(false);
  };

  const toggle=(id:string)=>{const s=new Set(expanded);if(s.has(id))s.delete(id);else s.add(id);setExpanded(s);};

  const showTooltip=(e:React.MouseEvent,items:Lancamento[])=>{
    if(!items||items.length===0)return;
    setTooltip({x:Math.min(e.clientX,window.innerWidth-320),y:Math.min(e.clientY+10,window.innerHeight-200),items});
  };

  const mesesOpcoes:string[]=[];
  for(let a=2025;a<=2027;a++)for(let m=1;m<=12;m++)mesesOpcoes.push(`${a}-${String(m).padStart(2,"0")}`);
  const nomeMes=(ma:string)=>{const[a,m]=ma.split("-");const n=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];return`${n[parseInt(m)-1]} ${a}`;};

  const renderRow=(row:GrupoRow,depth:number,isParent:boolean)=>{
    const hasFilhos=row.filhos&&row.filhos.length>0;
    const isOpen=expanded.has(row.id);
    const isRes=row.id==="RESULTADO";
    const bgColor=isRes?GO+"18":isParent?BG2:"transparent";
    const nameColor=isParent?GOL:TX;
    const valColor=(v:number,tipo:string)=>v===0?TXD:tipo==="receita"||isRes?(v>0?G:R):Y;

    return(
      <tr key={row.id} style={{background:bgColor,borderBottom:`0.5px solid ${BD}30`}}>
        <td onClick={hasFilhos?()=>toggle(row.id):undefined} style={{padding:"4px 6px",paddingLeft:8+depth*16,fontSize:isParent?11:10,fontWeight:isParent?700:400,color:nameColor,whiteSpace:"nowrap",cursor:hasFilhos?"pointer":"default",position:"sticky",left:0,background:bgColor||BG,zIndex:2,minWidth:180,borderRight:`1px solid ${BD}`}}>
          {hasFilhos&&<span style={{fontSize:8,color:GO,marginRight:4}}>{isOpen?"▼":"▶"}</span>}
          {row.nome}
        </td>
        <td style={{padding:"4px 6px",textAlign:"right",fontWeight:700,color:valColor(row.totalMes,row.tipo),fontSize:isParent?11:10,whiteSpace:"nowrap",borderRight:`1px solid ${BD}`,position:"sticky",left:180,background:bgColor||BG,zIndex:2}}>
          {row.totalMes===0?"—":fmtR(row.totalMes)}
        </td>
        {diasArray.map(d=>{
          const v=row.dias[d]||0;
          const items=row.lancamentos?.[d]||[];
          const isToday=d===diaHoje;
          return(
            <td key={d}
              onMouseEnter={items.length>0?(e)=>showTooltip(e,items):undefined}
              onMouseLeave={()=>setTooltip(null)}
              style={{padding:"3px 4px",textAlign:"right",fontSize:9,color:v===0?"transparent":valColor(v,row.tipo),fontWeight:v>0&&isParent?600:400,whiteSpace:"nowrap",cursor:items.length>0?"help":"default",background:isToday?GO+"08":"transparent",borderRight:d%7===0?`1px solid ${BD}30`:"none",minWidth:52}}>
              {v===0?"·":fmtR(v)}
            </td>
          );
        })}
      </tr>
    );
  };

  const renderTree=(rows:GrupoRow[])=>{
    const result:React.ReactElement[]=[];
    for(const row of rows){
      result.push(renderRow(row,0,true));
      if(expanded.has(row.id)&&row.filhos){
        for(const filho of row.filhos){
          result.push(renderRow(filho,1,false));
        }
      }
    }
    return result;
  };

  const sel:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:16}} onClick={()=>setTooltip(null)}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:GOL}}>📅 Visão Diária — {nomeMes(mesAno)}</div>
          <div style={{fontSize:10,color:TXD}}>Lançamentos por dia • Clique para expandir • Passe o mouse para detalhes</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={selectedComp} onChange={e=>{setSelectedComp(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={sel}>
            {groups.map(g=>{
              const gc=companies.filter(c=>c.group_id===g.id);
              if(gc.length===0)return null;
              return[<option key={`g_${g.id}`} value={`group_${g.id}`}>📁 {g.nome} (todas)</option>,...gc.map(c=><option key={c.id} value={c.id}>&nbsp;&nbsp;{c.nome_fantasia||c.razao_social}</option>)];
            })}
            {companies.filter(c=>!c.group_id||!groups.find((g:any)=>g.id===c.group_id)).map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <select value={mesAno} onChange={e=>setMesAno(e.target.value)} style={sel}>
            {mesesOpcoes.map(m=><option key={m} value={m}>{nomeMes(m)}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"6px 14px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
        {[
          {l:"Receitas",v:fmtRFull(totalRecMes),c:G},
          {l:"Despesas",v:fmtRFull(totalDespMes),c:Y},
          {l:"Resultado",v:fmtRFull(totalRecMes-totalDespMes),c:totalRecMes-totalDespMes>=0?G:R},
          {l:"Margem",v:totalRecMes>0?`${((totalRecMes-totalDespMes)/totalRecMes*100).toFixed(1)}%`:"0%",c:totalRecMes-totalDespMes>=0?G:R},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",borderLeft:`3px solid ${k.c}`}}>
            <div style={{fontSize:9,color:TXD,textTransform:"uppercase"}}>{k.l}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Loading */}
      {loading&&<div style={{textAlign:"center",padding:40,color:GOL}}>⏳ Carregando lançamentos...</div>}

      {/* Table */}
      {!loading&&rows.length>0&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto",maxHeight:"calc(100vh - 200px)"}}>
          <table style={{borderCollapse:"collapse",fontSize:10,width:"max-content",minWidth:"100%"}}>
            <thead>
              <tr style={{borderBottom:`2px solid ${GO}40`}}>
                <th style={{padding:"8px 6px",textAlign:"left",color:GOL,fontSize:10,position:"sticky",left:0,background:BG2,zIndex:3,minWidth:180,borderRight:`1px solid ${BD}`}}>Categoria / Cliente</th>
                <th style={{padding:"8px 6px",textAlign:"right",color:GOL,fontSize:10,position:"sticky",left:180,background:BG2,zIndex:3,borderRight:`1px solid ${BD}`,minWidth:80}}>Total</th>
                {diasArray.map(d=>{
                  const dow=new Date(ano,mes-1,d).getDay();
                  const isWknd=dow===0||dow===6;
                  const isToday=d===diaHoje;
                  const nomesDia=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
                  return(
                    <th key={d} style={{padding:"4px 4px",textAlign:"center",fontSize:9,color:isToday?GOL:isWknd?TXD+"80":TXD,background:isToday?GO+"12":"transparent",minWidth:52,borderRight:d%7===0?`1px solid ${BD}30`:"none"}}>
                      <div style={{fontWeight:isToday?700:400}}>{d}</div>
                      <div style={{fontSize:7,color:isWknd?TXD+"60":TXD+"40"}}>{nomesDia[dow]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>{renderTree(rows)}</tbody>
          </table>
        </div>
      )}

      {!loading&&rows.length===0&&(
        <div style={{textAlign:"center",padding:40,background:BG2,borderRadius:12,border:`1px solid ${BD}`}}>
          <div style={{fontSize:14,color:TXM}}>Nenhum lançamento neste mês</div>
          <div style={{fontSize:11,color:TXD,marginTop:4}}>Sincronize dados do ERP ou selecione outro período</div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip&&(
        <div style={{position:"fixed",left:tooltip.x,top:tooltip.y,background:"#1E1E1B",border:`1px solid ${GO}60`,borderRadius:10,padding:12,zIndex:9999,maxWidth:300,boxShadow:"0 8px 24px rgba(0,0,0,0.6)"}}>
          <div style={{fontSize:10,fontWeight:700,color:GOL,marginBottom:6}}>{tooltip.items.length} lançamento(s)</div>
          {tooltip.items.slice(0,5).map((item,i)=>(
            <div key={i} style={{padding:"4px 0",borderBottom:i<tooltip.items.length-1?`0.5px solid ${BD}`:"none",fontSize:10}}>
              <div style={{color:TX,fontWeight:600}}>{fmtRFull(item.valor)}</div>
              <div style={{color:TXM}}>{item.cliente}</div>
              <div style={{color:TXD,fontSize:9}}>
                {item.categoria&&`Cat: ${item.categoria}`}
                {item.doc&&` • Doc: ${item.doc}`}
                {item.status&&` • ${item.status}`}
              </div>
              {item.obs&&<div style={{color:TXD,fontSize:9,fontStyle:"italic"}}>Obs: {item.obs}</div>}
              <div style={{color:TXD,fontSize:8}}>Emissão: {item.emissao} | Venc: {item.vencimento}</div>
            </div>
          ))}
          {tooltip.items.length>5&&<div style={{fontSize:9,color:TXD,marginTop:4}}>+{tooltip.items.length-5} lançamento(s)</div>}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:12}}>
        PS Gestão e Capital — Visão Diária v8.0 | Dados: Omie API | {nomeMes(mesAno)}
      </div>
    </div>
  );
}
