"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

type Lancamento = { data:string; valor:number; tipo:"entrada"|"saida"; nome:string; doc:string; status:string; vencimento:string; };
type DiaCaixa = { data:string; dia:string; diaSemana:string; entradas:number; saidas:number; saldo:number; acumulado:number; lancamentos:Lancamento[]; isHoje:boolean; isWeekend:boolean; };

const DIAS_SEMANA=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function parseDataBR(d:string):Date|null {
  if(!d) return null;
  const parts=d.split("/");
  if(parts.length!==3) return null;
  let ano=parseInt(parts[2]);
  if(parts[2].length===2) ano=2000+ano;
  return new Date(ano, parseInt(parts[1])-1, parseInt(parts[0]));
}

function fmtDataCurta(d:Date):string {
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function fmtDataCompleta(d:Date):string {
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

export default function FluxoCaixa({companyIds}:{companyIds:string[]}){
  const [lancamentos,setLancamentos]=useState<Lancamento[]>([]);
  const [loading,setLoading]=useState(true);
  const [periodo,setPeriodo]=useState(30);
  const [expandedDia,setExpandedDia]=useState<string|null>(null);
  const [saldoInicial,setSaldoInicial]=useState(0);
  const [showConfig,setShowConfig]=useState(false);

  useEffect(()=>{
    if(!companyIds||companyIds.length===0)return;
    loadData();
  },[companyIds]);

  const loadData=async()=>{
    setLoading(true);
    const lancs:Lancamento[]=[];

    // Load clientes for name lookup
    const clienteNomes:Record<string,string>={};
    const{data:cliImports}=await supabase.from("omie_imports").select("import_data").in("company_id",companyIds).eq("import_type","clientes");
    if(cliImports){
      for(const ci of cliImports){
        const clientes=ci.import_data?.clientes_cadastro||ci.import_data?.clientes||[];
        if(Array.isArray(clientes)){
          for(const c of clientes){
            const cod=c.codigo_cliente_omie||c.codigo_cliente||c.codigo;
            const nome=c.nome_fantasia||c.razao_social||c.nome||"";
            if(cod&&nome) clienteNomes[String(cod)]=nome;
          }
        }
      }
    }

    // Load contas a receber (entradas)
    const{data:recImports}=await supabase.from("omie_imports").select("import_data").in("company_id",companyIds).eq("import_type","contas_receber");
    if(recImports){
      for(const imp of recImports){
        const regs=imp.import_data?.conta_receber_cadastro||[];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          const status=r.status_titulo||"";
          if(status==="CANCELADO"||status==="PAGO"||status==="RECEBIDO") continue;
          const venc=r.data_vencimento||r.data_previsao||"";
          const codCF=String(r.codigo_cliente_fornecedor||r.codigo_cliente||"");
          lancs.push({
            data:venc,valor:Number(r.valor_documento)||0,tipo:"entrada",
            nome:clienteNomes[codCF]||"Cliente "+codCF,
            doc:r.numero_documento||r.numero_documento_fiscal||"",
            status,vencimento:venc,
          });
        }
      }
    }

    // Load contas a pagar (saídas)
    const{data:pagImports}=await supabase.from("omie_imports").select("import_data").in("company_id",companyIds).eq("import_type","contas_pagar");
    if(pagImports){
      for(const imp of pagImports){
        const regs=imp.import_data?.conta_pagar_cadastro||[];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          const status=r.status_titulo||"";
          if(status==="CANCELADO"||status==="PAGO"||status==="LIQUIDADO") continue;
          const venc=r.data_vencimento||r.data_previsao||"";
          const codCF=String(r.codigo_cliente_fornecedor||r.codigo_fornecedor||"");
          lancs.push({
            data:venc,valor:Number(r.valor_documento)||0,tipo:"saida",
            nome:clienteNomes[codCF]||r.observacao||"Fornecedor "+codCF,
            doc:r.numero_documento||r.numero_documento_fiscal||"",
            status,vencimento:venc,
          });
        }
      }
    }

    setLancamentos(lancs);
    setLoading(false);
  };

  // Build daily cash flow
  const diasCaixa:DiaCaixa[]=useMemo(()=>{
    const hoje=new Date();
    hoje.setHours(0,0,0,0);
    const dias:DiaCaixa[]=[];
    let acumulado=saldoInicial;

    for(let i=0;i<periodo;i++){
      const d=new Date(hoje);
      d.setDate(hoje.getDate()+i);
      const dStr=fmtDataCompleta(d);

      // Find lancamentos for this day
      const diaLancs=lancamentos.filter(l=>{
        const ld=parseDataBR(l.data);
        if(!ld) return false;
        return ld.getFullYear()===d.getFullYear()&&ld.getMonth()===d.getMonth()&&ld.getDate()===d.getDate();
      });

      const entradas=diaLancs.filter(l=>l.tipo==="entrada").reduce((s,l)=>s+l.valor,0);
      const saidas=diaLancs.filter(l=>l.tipo==="saida").reduce((s,l)=>s+l.valor,0);
      const saldo=entradas-saidas;
      acumulado+=saldo;

      dias.push({
        data:dStr,
        dia:fmtDataCurta(d),
        diaSemana:DIAS_SEMANA[d.getDay()],
        entradas,saidas,saldo,acumulado,
        lancamentos:diaLancs.sort((a,b)=>b.valor-a.valor),
        isHoje:i===0,
        isWeekend:d.getDay()===0||d.getDay()===6,
      });
    }
    return dias;
  },[lancamentos,periodo,saldoInicial]);

  // Summary
  const totalEntradas=diasCaixa.reduce((s,d)=>s+d.entradas,0);
  const totalSaidas=diasCaixa.reduce((s,d)=>s+d.saidas,0);
  const saldoPeriodo=totalEntradas-totalSaidas;
  const saldoFinal=saldoInicial+saldoPeriodo;
  const diasNegativo=diasCaixa.filter(d=>d.acumulado<0).length;
  const menorSaldo=Math.min(...diasCaixa.map(d=>d.acumulado));

  if(loading) return <div style={{padding:20,textAlign:"center",color:TXM}}>Carregando fluxo de caixa...</div>;

  return(
    <div>
      {/* Period selector */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:4}}>
          {[{d:7,l:"7 dias"},{d:15,l:"15 dias"},{d:30,l:"30 dias"},{d:60,l:"60 dias"},{d:90,l:"90 dias"}].map(p=>(
            <button key={p.d} onClick={()=>setPeriodo(p.d)} style={{
              padding:"6px 14px",borderRadius:8,fontSize:11,fontWeight:periodo===p.d?600:400,cursor:"pointer",
              border:periodo===p.d?`1px solid ${GO}50`:`1px solid ${BD}`,
              background:periodo===p.d?`${GO}10`:"transparent",color:periodo===p.d?GOL:TXM,
            }}>{p.l}</button>
          ))}
        </div>
        <button onClick={()=>setShowConfig(!showConfig)} style={{padding:"6px 12px",borderRadius:8,fontSize:11,border:`1px solid ${BD}`,background:"transparent",color:TXM,cursor:"pointer"}}>
          ⚙️ Saldo Inicial
        </button>
      </div>

      {showConfig&&(
        <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`,marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:12,color:TXM}}>Saldo em caixa hoje:</span>
          <span style={{fontSize:12,color:TXM}}>R$</span>
          <input type="number" value={saldoInicial||""} onChange={e=>setSaldoInicial(parseFloat(e.target.value)||0)} placeholder="0,00" style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:13,outline:"none",width:180,fontFamily:"inherit"}}/>
          <button onClick={()=>setShowConfig(false)} style={{padding:"6px 12px",borderRadius:6,background:GO,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>OK</button>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:8,marginBottom:14}}>
        {[
          {label:"Entradas Previstas",value:fmtR(totalEntradas),cor:G,icon:"📥"},
          {label:"Saídas Previstas",value:fmtR(totalSaidas),cor:R,icon:"📤"},
          {label:"Saldo do Período",value:fmtR(saldoPeriodo),cor:saldoPeriodo>=0?G:R,icon:"📊"},
          {label:"Saldo Final Projetado",value:fmtR(saldoFinal),cor:saldoFinal>=0?G:R,icon:"🎯"},
          {label:"Menor Saldo",value:fmtR(menorSaldo),cor:menorSaldo>=0?G:R,icon:"⚠️"},
          {label:"Dias Negativo",value:`${diasNegativo} de ${periodo}`,cor:diasNegativo===0?G:diasNegativo>periodo*0.3?R:Y,icon:"📅"},
        ].map((k,i)=>(
          <div key={i} style={{background:"linear-gradient(135deg, #161614, #1E1E1B)",borderRadius:14,padding:"14px 12px",border:`1px solid ${BD}`,textAlign:"center"}}>
            <div style={{fontSize:18,marginBottom:4}}>{k.icon}</div>
            <div style={{fontSize:15,fontWeight:700,color:k.cor}}>{k.value}</div>
            <div style={{fontSize:9,color:TXM,marginTop:2}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Mini chart - visual bar per day */}
      <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:600,color:TX,marginBottom:8}}>Projeção Visual — Saldo Acumulado</div>
        <div style={{display:"flex",gap:1,alignItems:"flex-end",height:60,overflow:"hidden"}}>
          {diasCaixa.map((d,i)=>{
            const maxAbs=Math.max(Math.abs(menorSaldo),Math.abs(saldoFinal),1);
            const h=Math.max(4,Math.abs(d.acumulado)/maxAbs*50);
            return(
              <div key={i} title={`${d.dia} ${d.diaSemana}: ${fmtR(d.acumulado)}`} style={{
                flex:1,minWidth:2,height:h,borderRadius:1,
                background:d.acumulado>=0?G:R,opacity:d.isWeekend?0.4:0.8,
                transition:"height 0.3s",cursor:"pointer",
              }} onClick={()=>setExpandedDia(expandedDia===d.data?null:d.data)}/>
            );
          })}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontSize:9,color:TXM}}>Hoje</span>
          <span style={{fontSize:9,color:TXM}}>+{periodo} dias</span>
        </div>
      </div>

      {/* Daily table */}
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
        <div style={{overflowX:"auto",maxHeight:500,overflowY:"auto"}}>
          <table style={{width:"100%",fontSize:11,minWidth:600}}>
            <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}>
              <tr style={{borderBottom:`1px solid ${BD}`}}>
                {["DIA","","ENTRADAS","SAÍDAS","SALDO DIA","SALDO ACUMULADO"].map(h=>(
                  <th key={h} style={{padding:"10px 8px",textAlign:h===""||h==="DIA"?"left":"right",color:GO,fontSize:10,fontWeight:600,letterSpacing:0.5}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diasCaixa.map((d,i)=>{
                const isOpen=expandedDia===d.data;
                const hasLancs=d.lancamentos.length>0;
                return(
                  <React.Fragment key={d.data}>
                    <tr onClick={()=>hasLancs&&setExpandedDia(isOpen?null:d.data)} style={{
                      borderBottom:`0.5px solid ${BD}30`,cursor:hasLancs?"pointer":"default",
                      background:d.isHoje?`${GO}08`:d.isWeekend?"rgba(255,255,255,0.01)":"transparent",
                    }}>
                      <td style={{padding:"8px",fontWeight:d.isHoje?700:400,color:d.isHoje?GOL:TX,whiteSpace:"nowrap",fontSize:12}}>
                        {d.dia} <span style={{color:d.isWeekend?P:TXM,fontWeight:400,fontSize:10}}>{d.diaSemana}</span>
                        {d.isHoje&&<span style={{marginLeft:4,fontSize:8,padding:"1px 6px",borderRadius:4,background:GO+"20",color:GOL,fontWeight:600}}>HOJE</span>}
                      </td>
                      <td style={{padding:"8px",fontSize:10,color:TXD}}>{hasLancs?`${d.lancamentos.length} lançamentos`:""}</td>
                      <td style={{padding:"8px",textAlign:"right",color:d.entradas>0?G:TXD,fontWeight:d.entradas>0?600:400}}>{d.entradas>0?fmtR(d.entradas):"—"}</td>
                      <td style={{padding:"8px",textAlign:"right",color:d.saidas>0?R:TXD,fontWeight:d.saidas>0?600:400}}>{d.saidas>0?fmtR(d.saidas):"—"}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:600,color:d.saldo>0?G:d.saldo<0?R:TXD}}>{d.saldo!==0?fmtR(d.saldo):"—"}</td>
                      <td style={{padding:"8px",textAlign:"right",fontWeight:700,fontSize:12}}>
                        <span style={{color:d.acumulado>=0?G:R,padding:"2px 8px",borderRadius:6,background:d.acumulado>=0?G+"10":R+"10"}}>{fmtR(d.acumulado)}</span>
                      </td>
                    </tr>
                    {isOpen&&d.lancamentos.length>0&&(
                      <tr><td colSpan={6} style={{padding:"0 8px 8px",background:"#141412"}}>
                        <div style={{borderRadius:8,overflow:"hidden"}}>
                          {d.lancamentos.map((l,li)=>(
                            <div key={li} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 12px",borderBottom:li<d.lancamentos.length-1?`1px solid ${BD}20`:"none"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:14}}>{l.tipo==="entrada"?"📥":"📤"}</span>
                                <div>
                                  <div style={{fontSize:12,color:TX,fontWeight:500}}>{l.nome}</div>
                                  <div style={{fontSize:10,color:TXM}}>{l.doc?`Doc: ${l.doc}`:""}{l.status?` · ${l.status}`:""}</div>
                                </div>
                              </div>
                              <div style={{fontSize:13,fontWeight:600,color:l.tipo==="entrada"?G:R}}>{l.tipo==="entrada"?"+":"-"}{fmtR(l.valor)}</div>
                            </div>
                          ))}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Analysis */}
      {diasCaixa.length>0&&(
        <div style={{marginTop:12,background:"linear-gradient(135deg, #161614, #1E1E1B)",borderRadius:14,padding:16,border:`1px solid ${GO}30`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{width:28,height:28,borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:BG,boxShadow:"0 4px 12px rgba(198,151,63,0.3)"}}>PS</div>
            <span style={{fontSize:13,fontWeight:600,color:GOL}}>Análise do Fluxo de Caixa</span>
          </div>
          {diasNegativo>0&&(
            <div style={{padding:"10px 14px",borderRadius:10,background:R+"10",border:`1px solid ${R}25`,marginBottom:6,fontSize:12,color:TX,display:"flex",gap:10}}>
              <span style={{fontSize:14}}>🔴</span>
              <span><strong style={{color:R}}>Caixa negativo em {diasNegativo} dias</strong> nos próximos {periodo} dias. Menor saldo projetado: {fmtR(menorSaldo)}. {menorSaldo<-50000?"Risco crítico de liquidez — antecipe recebíveis ou renegocie prazos.":"Renegociar prazos de pagamento ou antecipar recebíveis pode resolver."}</span>
            </div>
          )}
          {totalSaidas>totalEntradas*1.2&&(
            <div style={{padding:"10px 14px",borderRadius:10,background:Y+"10",border:`1px solid ${Y}25`,marginBottom:6,fontSize:12,color:TX,display:"flex",gap:10}}>
              <span style={{fontSize:14}}>⚠️</span>
              <span>Saídas previstas ({fmtR(totalSaidas)}) são <strong style={{color:Y}}>{((totalSaidas/totalEntradas-1)*100).toFixed(0)}% maiores</strong> que as entradas ({fmtR(totalEntradas)}). Avaliar postergação de pagamentos não essenciais.</span>
            </div>
          )}
          {diasNegativo===0&&saldoFinal>0&&(
            <div style={{padding:"10px 14px",borderRadius:10,background:G+"10",border:`1px solid ${G}25`,fontSize:12,color:TX,display:"flex",gap:10}}>
              <span style={{fontSize:14}}>✅</span>
              <span>Fluxo de caixa <strong style={{color:G}}>positivo</strong> nos próximos {periodo} dias. Saldo final projetado: {fmtR(saldoFinal)}.{saldoFinal>totalSaidas?" Reserva confortável — considerar aplicações de curto prazo para o excedente.":""}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
