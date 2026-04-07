"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

type ItemBP = { id:string; grupo:string; subgrupo:string; nome:string; valor:number; obs?:string; };
type Financiamento = {
  id:string; banco:string; tipo:string; valorOriginal:number; saldoDevedor:number;
  taxaMensal:number; parcelas:number; parcelasRestantes:number;
  vencimento:string; garantia:string; status:string;
};

const estruturaAtivo = [
  { grupo:"Ativo Circulante", icon:"💰", cor:G, itens:["Caixa e Equivalentes","Bancos Conta Corrente","Aplicações Financeiras CP","Contas a Receber","(-) Provisão p/ Devedores Duvidosos","Estoques","Impostos a Recuperar","Adiantamentos","Outros Ativos Circulantes"] },
  { grupo:"Ativo Não Circulante", icon:"🏢", cor:B, itens:["Realizável a Longo Prazo","Investimentos","Imobilizado (Imóveis)","Imobilizado (Veículos)","Imobilizado (Máquinas/Equip.)","Imobilizado (Móveis/Utensílios)","(-) Depreciação Acumulada","Intangível (Software/Marcas)","(-) Amortização Acumulada"] },
];

const estruturaPassivo = [
  { grupo:"Passivo Circulante", icon:"📋", cor:R, itens:["Fornecedores","Empréstimos e Financiamentos CP","Salários e Encargos a Pagar","Impostos a Recolher","Obrigações Fiscais","Adiantamento de Clientes","Provisões","Outros Passivos Circulantes"] },
  { grupo:"Passivo Não Circulante", icon:"🏦", cor:Y, itens:["Financiamentos LP","Empréstimos LP","Debêntures","Contingências Trabalhistas","Contingências Tributárias","Outros Passivos Não Circulantes"] },
  { grupo:"Patrimônio Líquido", icon:"👑", cor:GOL, itens:["Capital Social","Capital a Integralizar","Reservas de Capital","Reservas de Lucros","Lucros Acumulados","(-) Prejuízos Acumulados","Ajustes de Avaliação Patrimonial"] },
];

export default function BalancoPatrimonial({ empresaId, periodoFim }: { empresaId: string; periodoFim: string }) {
  const [ativos, setAtivos] = useState<ItemBP[]>([]);
  const [passivos, setPassivos] = useState<ItemBP[]>([]);
  const [financiamentos, setFinanciamentos] = useState<Financiamento[]>([]);
  const [editando, setEditando] = useState<string|null>(null);
  const [editValor, setEditValor] = useState("");
  const [editObs, setEditObs] = useState("");
  const [showAddFin, setShowAddFin] = useState(false);
  const [newFin, setNewFin] = useState<Partial<Financiamento>>({});
  const [expandido, setExpandido] = useState<Record<string,boolean>>({"Ativo Circulante":true,"Passivo Circulante":true,"Patrimônio Líquido":true});
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"balanco"|"financiamentos">("balanco");

  // Load data
  useEffect(()=>{
    loadData();
  },[empresaId]);

  const loadData = async () => {
    const{data:bp}=await supabase.from("balanco_patrimonial").select("*").eq("company_id",empresaId).order("grupo");
    if(bp){
      setAtivos(bp.filter((i:any)=>i.lado==="ativo").map((i:any)=>({id:i.id,grupo:i.grupo,subgrupo:i.subgrupo,nome:i.nome,valor:Number(i.valor)||0,obs:i.obs})));
      setPassivos(bp.filter((i:any)=>i.lado==="passivo").map((i:any)=>({id:i.id,grupo:i.grupo,subgrupo:i.subgrupo,nome:i.nome,valor:Number(i.valor)||0,obs:i.obs})));
    }
    const{data:fin}=await supabase.from("financiamentos").select("*").eq("company_id",empresaId).order("vencimento");
    if(fin)setFinanciamentos(fin.map((f:any)=>({id:f.id,banco:f.banco,tipo:f.tipo,valorOriginal:Number(f.valor_original)||0,saldoDevedor:Number(f.saldo_devedor)||0,taxaMensal:Number(f.taxa_mensal)||0,parcelas:f.parcelas||0,parcelasRestantes:f.parcelas_restantes||0,vencimento:f.vencimento||"",garantia:f.garantia||"",status:f.status||"ativo"})));
  };

  const salvarItem = async (lado:"ativo"|"passivo", grupo:string, nome:string) => {
    const valor = parseFloat(editValor.replace(/\./g,"").replace(",",".")) || 0;
    const existing = (lado==="ativo"?ativos:passivos).find(i=>i.grupo===grupo&&i.nome===nome);
    if(existing){
      await supabase.from("balanco_patrimonial").update({valor,obs:editObs}).eq("id",existing.id);
    }else{
      await supabase.from("balanco_patrimonial").insert({company_id:empresaId,lado,grupo,subgrupo:"",nome,valor,obs:editObs,periodo:periodoFim});
    }
    setEditando(null);setEditValor("");setEditObs("");setMsg("Salvo!");loadData();
    setTimeout(()=>setMsg(""),2000);
  };

  const salvarFinanciamento = async () => {
    const f = newFin;
    if(!f.banco||!f.saldoDevedor)return;
    await supabase.from("financiamentos").insert({
      company_id:empresaId, banco:f.banco, tipo:f.tipo||"Empréstimo",
      valor_original:f.valorOriginal||0, saldo_devedor:f.saldoDevedor||0,
      taxa_mensal:f.taxaMensal||0, parcelas:f.parcelas||0,
      parcelas_restantes:f.parcelasRestantes||0, vencimento:f.vencimento||"",
      garantia:f.garantia||"", status:"ativo"
    });
    setShowAddFin(false);setNewFin({});setMsg("Financiamento cadastrado!");loadData();
    setTimeout(()=>setMsg(""),2000);
  };

  const excluirFinanciamento = async (id:string) => {
    await supabase.from("financiamentos").delete().eq("id",id);
    setMsg("Excluído.");loadData();setTimeout(()=>setMsg(""),2000);
  };

  // Totals
  const totalAtivos = ativos.reduce((s,i)=>s+i.valor,0);
  const totalPassivos = passivos.filter(i=>!["Capital Social","Reservas de Capital","Reservas de Lucros","Lucros Acumulados","(-) Prejuízos Acumulados","Capital a Integralizar","Ajustes de Avaliação Patrimonial"].includes(i.nome)).reduce((s,i)=>s+i.valor,0);
  const totalPL = passivos.filter(i=>["Capital Social","Reservas de Capital","Reservas de Lucros","Lucros Acumulados","(-) Prejuízos Acumulados","Capital a Integralizar","Ajustes de Avaliação Patrimonial"].includes(i.nome)).reduce((s,i)=>s+i.valor,0);
  const totalPassivoPL = totalPassivos + totalPL;
  const totalFinSaldo = financiamentos.reduce((s,f)=>s+f.saldoDevedor,0);
  const totalFinParcMensal = financiamentos.reduce((s,f)=>f.parcelasRestantes>0?s+(f.saldoDevedor/f.parcelasRestantes):s,0);

  const getValor = (lista:ItemBP[], grupo:string, nome:string) => lista.find(i=>i.grupo===grupo&&i.nome===nome)?.valor || 0;

  const inp:React.CSSProperties = {background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:12,outline:"none",width:"100%",fontFamily:"inherit"};

  const renderGrupo = (estrutura: typeof estruturaAtivo, items: ItemBP[], lado: "ativo"|"passivo") => {
    return estrutura.map((g,gi) => {
      const totalGrupo = g.itens.reduce((s,nome)=>s+getValor(items,g.grupo,nome),0);
      const isOpen = !!expandido[g.grupo];
      return (
        <div key={gi} style={{marginBottom:8}}>
          <div onClick={()=>setExpandido({...expandido,[g.grupo]:!isOpen})} style={{
            display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"10px 14px",background:BG2,borderRadius:10,border:`1px solid ${BD}`,
            cursor:"pointer",borderLeft:`3px solid ${g.cor}`,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14,color:g.cor,transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0)"}}> ▶</span>
              <span style={{fontSize:20}}>{g.icon}</span>
              <span style={{fontSize:13,fontWeight:600,color:TX}}>{g.grupo}</span>
            </div>
            <span style={{fontSize:15,fontWeight:700,color:totalGrupo!==0?g.cor:TXD}}>{fmtR(totalGrupo)}</span>
          </div>
          {isOpen&&(
            <div style={{marginTop:4,paddingLeft:16}}>
              {g.itens.map((nome,ni)=>{
                const valor = getValor(items,g.grupo,nome);
                const itemKey = `${lado}-${g.grupo}-${nome}`;
                const isEditing = editando===itemKey;
                const isNeg = nome.startsWith("(-)");
                return(
                  <div key={ni} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 12px",borderBottom:`1px solid ${BD}15`,fontSize:12}}>
                    <span style={{color:isNeg?R:TXM,flex:1}}>{nome}</span>
                    {isEditing?(
                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                        <input value={editValor} onChange={e=>setEditValor(e.target.value)} placeholder="0,00" style={{...inp,width:120,textAlign:"right"}} autoFocus onKeyDown={e=>e.key==="Enter"&&salvarItem(lado,g.grupo,nome)}/>
                        <input value={editObs} onChange={e=>setEditObs(e.target.value)} placeholder="Obs" style={{...inp,width:100}}/>
                        <button onClick={()=>salvarItem(lado,g.grupo,nome)} style={{padding:"4px 10px",borderRadius:6,background:G,color:BG,fontSize:10,fontWeight:600,border:"none",cursor:"pointer"}}>✓</button>
                        <button onClick={()=>setEditando(null)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXD,fontSize:10,cursor:"pointer"}}>✕</button>
                      </div>
                    ):(
                      <span onClick={()=>{setEditando(itemKey);setEditValor(valor?valor.toString():"");setEditObs(items.find(i=>i.grupo===g.grupo&&i.nome===nome)?.obs||"");}}
                        style={{color:valor!==0?(isNeg?R:TX):TXD,fontWeight:valor!==0?600:400,cursor:"pointer",minWidth:100,textAlign:"right",padding:"2px 8px",borderRadius:6,border:`1px solid transparent`,transition:"all 0.2s"}}
                        onMouseEnter={e=>{(e.target as HTMLElement).style.borderColor=GO;(e.target as HTMLElement).style.background=BG3;}}
                        onMouseLeave={e=>{(e.target as HTMLElement).style.borderColor="transparent";(e.target as HTMLElement).style.background="transparent";}}>
                        {valor!==0?fmtR(valor):"— clique para editar"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  };

  return(
    <div>
      {msg&&<div style={{background:G+"15",border:`1px solid ${G}30`,borderRadius:8,padding:"6px 14px",marginBottom:10,fontSize:11,color:G}}>{msg}</div>}

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {([["balanco","📊 Balanço Patrimonial"],["financiamentos","🏦 Financiamentos Detalhados"]] as const).map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 16px",borderRadius:10,fontSize:11,border:tab===id?`1px solid ${GO}50`:"1px solid transparent",background:tab===id?`${GO}10`:"transparent",color:tab===id?GOL:TXM,fontWeight:tab===id?600:400}}>{label}</button>
        ))}
      </div>

      {/* BALANÇO */}
      {tab==="balanco"&&(<>
        {/* Summary KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
          {[
            {label:"Total Ativos",value:fmtR(totalAtivos),cor:G},
            {label:"Total Passivos",value:fmtR(totalPassivos),cor:R},
            {label:"Patrimônio Líquido",value:fmtR(totalPL),cor:GOL},
            {label:"Ativo - Passivo - PL",value:fmtR(totalAtivos-totalPassivoPL),cor:Math.abs(totalAtivos-totalPassivoPL)<100?G:Y},
          ].map((k,i)=>(
            <div key={i} style={{background:BG2,borderRadius:12,padding:"12px 14px",border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.cor}}>{k.value}</div>
            </div>
          ))}
        </div>

        <div style={{fontSize:10,color:TXD,marginBottom:10,textAlign:"right"}}>Clique no valor de qualquer conta para editar · Período: {periodoFim}</div>

        {/* Two columns: Ativo | Passivo */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <div style={{width:3,height:16,background:G,borderRadius:2}}/>
              <span style={{fontSize:14,fontWeight:700,color:TX}}>ATIVO</span>
              <span style={{fontSize:11,color:G,fontWeight:600,marginLeft:"auto"}}>{fmtR(totalAtivos)}</span>
            </div>
            {renderGrupo(estruturaAtivo, ativos, "ativo")}
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <div style={{width:3,height:16,background:R,borderRadius:2}}/>
              <span style={{fontSize:14,fontWeight:700,color:TX}}>PASSIVO + PL</span>
              <span style={{fontSize:11,color:R,fontWeight:600,marginLeft:"auto"}}>{fmtR(totalPassivoPL)}</span>
            </div>
            {renderGrupo(estruturaPassivo, passivos, "passivo")}
          </div>
        </div>
      </>)}

      {/* FINANCIAMENTOS */}
      {tab==="financiamentos"&&(<>
        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
          {[
            {label:"Qtd Financiamentos",value:financiamentos.length.toString(),cor:TX},
            {label:"Saldo Devedor Total",value:fmtR(totalFinSaldo),cor:R},
            {label:"Parcela Mensal Estimada",value:fmtR(totalFinParcMensal),cor:Y},
            {label:"Ativos",value:financiamentos.filter(f=>f.status==="ativo").length.toString(),cor:G},
          ].map((k,i)=>(
            <div key={i} style={{background:BG2,borderRadius:12,padding:"12px 14px",border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.cor}}>{k.value}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:600,color:TX}}>Financiamentos e Empréstimos</span>
          <button onClick={()=>setShowAddFin(true)} style={{padding:"6px 14px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo Financiamento</button>
        </div>

        {/* Add form */}
        {showAddFin&&(
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${GO}30`,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:12}}>Cadastrar Financiamento</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[
                {l:"Banco/Instituição *",k:"banco",p:"Ex: Bradesco, BNDES, Sicoob"},
                {l:"Tipo",k:"tipo",p:"Empréstimo, Financiamento, Leasing"},
                {l:"Valor Original (R$)",k:"valorOriginal",p:"0,00",type:"number"},
                {l:"Saldo Devedor (R$) *",k:"saldoDevedor",p:"0,00",type:"number"},
                {l:"Taxa Mensal (%)",k:"taxaMensal",p:"1,5",type:"number"},
                {l:"Total de Parcelas",k:"parcelas",p:"60",type:"number"},
                {l:"Parcelas Restantes",k:"parcelasRestantes",p:"36",type:"number"},
                {l:"Vencimento Final",k:"vencimento",p:"2028-12",type:"month"},
                {l:"Garantia",k:"garantia",p:"Imóvel, Veículo, Aval"},
              ].map(f=>(
                <div key={f.k}><div style={{fontSize:10,color:TXD,marginBottom:3}}>{f.l}</div>
                <input value={(newFin as any)[f.k]||""} onChange={e=>setNewFin({...newFin,[f.k]:f.type==="number"?parseFloat(e.target.value)||0:e.target.value})} placeholder={f.p} type={f.type||"text"} style={inp}/></div>
              ))}
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button onClick={salvarFinanciamento} style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
              <button onClick={()=>setShowAddFin(false)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Financiamentos list */}
        {financiamentos.length===0?(
          <div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center",color:TXD,fontSize:12}}>
            Nenhum financiamento cadastrado. Clique em "+ Novo Financiamento" para registrar.
          </div>
        ):(
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",fontSize:11,minWidth:800}}>
                <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                  {["Banco","Tipo","Valor Original","Saldo Devedor","Taxa","Parcelas","Vencimento","Garantia","Ações"].map(h=>(
                    <th key={h} style={{padding:"10px 8px",textAlign:h.includes("Valor")||h.includes("Saldo")||h==="Taxa"?"right":"left",color:GO,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {financiamentos.map((f,i)=>(
                    <tr key={f.id} style={{borderBottom:`1px solid ${BD}20`}}>
                      <td style={{padding:"8px",fontWeight:500,color:TX}}>{f.banco}</td>
                      <td style={{padding:"8px",color:TXM}}>{f.tipo}</td>
                      <td style={{padding:"8px",textAlign:"right",color:TXM}}>{fmtR(f.valorOriginal)}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:600,color:R}}>{fmtR(f.saldoDevedor)}</td>
                      <td style={{padding:"8px",textAlign:"right",color:Y}}>{f.taxaMensal}% a.m.</td>
                      <td style={{padding:"8px",color:TXM}}>{f.parcelasRestantes}/{f.parcelas}</td>
                      <td style={{padding:"8px",color:TXD}}>{f.vencimento}</td>
                      <td style={{padding:"8px",color:TXD}}>{f.garantia||"—"}</td>
                      <td style={{padding:"8px"}}>
                        <button onClick={()=>excluirFinanciamento(f.id)} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${R}30`,background:"transparent",color:R,fontSize:10,cursor:"pointer"}}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AI Analysis */}
        {financiamentos.length>0&&(
          <div style={{marginTop:12,background:BG2,borderRadius:12,padding:16,border:`1px solid ${GO}30`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <div style={{width:24,height:24,borderRadius:6,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:BG}}>PS</div>
              <span style={{fontSize:12,fontWeight:600,color:GOL}}>Análise IA — Endividamento</span>
            </div>
            {totalFinSaldo>0&&totalFinParcMensal>0&&(
              <div style={{padding:"8px 12px",borderRadius:8,background:totalFinParcMensal>totalAtivos*0.05?R+"10":Y+"10",border:`1px solid ${totalFinParcMensal>totalAtivos*0.05?R:Y}30`,marginBottom:6,fontSize:11,color:TXM,display:"flex",gap:8}}>
                <span>{totalFinParcMensal>totalAtivos*0.05?"🔴":"🟡"}</span>
                <span>Comprometimento mensal com financiamentos: {fmtR(totalFinParcMensal)}. {financiamentos.filter(f=>f.taxaMensal>2).length>0?`${financiamentos.filter(f=>f.taxaMensal>2).length} financiamento(s) com taxa acima de 2% a.m. — avaliar renegociação ou portabilidade.`:"Taxas dentro do aceitável."}</span>
              </div>
            )}
            {financiamentos.filter(f=>{const d=new Date(f.vencimento+"-01");const now=new Date();const diff=(d.getTime()-now.getTime())/(1000*60*60*24*30);return diff<6&&diff>0;}).length>0&&(
              <div style={{padding:"8px 12px",borderRadius:8,background:Y+"10",border:`1px solid ${Y}30`,marginBottom:6,fontSize:11,color:TXM,display:"flex",gap:8}}>
                <span>🟡</span>
                <span>{financiamentos.filter(f=>{const d=new Date(f.vencimento+"-01");const now=new Date();const diff=(d.getTime()-now.getTime())/(1000*60*60*24*30);return diff<6&&diff>0;}).length} financiamento(s) vencem nos próximos 6 meses. Planejar quitação ou renovação com antecedência.</span>
              </div>
            )}
          </div>
        )}
      </>)}
    </div>
  );
}
