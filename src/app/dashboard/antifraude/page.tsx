"use client";
import React, { useState } from "react";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",pk:"#EC4899",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

// ═══ FORNECEDORES CADASTRADOS (simulado) ═══
const FORNECEDORES_ATIVOS=[
  {cnpj:"12.345.678/0001-90",nome:"Frigorífico Santa Maria Ltda",desde:"2019",ticketMedio:42000,ultimoPgto:"2026-03-28"},
  {cnpj:"23.456.789/0001-01",nome:"Embalagens Sul S.A.",desde:"2020",ticketMedio:8500,ultimoPgto:"2026-04-02"},
  {cnpj:"34.567.890/0001-12",nome:"Transportadora Rápida Ltda",desde:"2021",ticketMedio:15200,ultimoPgto:"2026-04-05"},
  {cnpj:"45.678.901/0001-23",nome:"Condimentos Brasileiros Ind.",desde:"2018",ticketMedio:6800,ultimoPgto:"2026-03-15"},
  {cnpj:"56.789.012/0001-34",nome:"Energia Elétrica CELESC",desde:"2015",ticketMedio:28500,ultimoPgto:"2026-04-08"},
  {cnpj:"67.890.123/0001-45",nome:"Água e Saneamento CASAN",desde:"2015",ticketMedio:4200,ultimoPgto:"2026-04-01"},
  {cnpj:"78.901.234/0001-56",nome:"Manutenção Industrial SM Ltda",desde:"2022",ticketMedio:12400,ultimoPgto:"2026-03-20"},
  {cnpj:"89.012.345/0001-67",nome:"Veterinária Oeste Ltda",desde:"2020",ticketMedio:3800,ultimoPgto:"2026-03-25"},
];

// ═══ BOLETOS DDA + IMPORTADOS (simulado — inclui fraudulentos) ═══
const BOLETOS:any[]=[
  {id:"B001",cedente:"Frigorífico Santa Maria Ltda",cnpjCedente:"12.345.678/0001-90",banco:"Banco do Brasil",agencia:"3421",conta:"28456-7",valor:38500,vencimento:"2026-04-15",nossoNumero:"00041892",codigoBarras:"23793.38128 60000.000004 18920.342100 1 92850000038500",linha:"DDA",nfReferencia:"NF-e 4521",pedidoCompra:"PC-2026-0142",obs:"Compra de carne suína — lote 442"},
  {id:"B002",cedente:"Embalagens Sul S.A.",cnpjCedente:"23.456.789/0001-01",banco:"Itaú",agencia:"0845",conta:"31245-8",valor:9200,vencimento:"2026-04-18",nossoNumero:"00089231",codigoBarras:"34191.75009 00892.310008 45123.100001 8 92880000009200",linha:"DDA",nfReferencia:"NF-e 1823",pedidoCompra:"PC-2026-0138",obs:"Embalagens vácuo e rótulos"},
  // ═══ GOLPE 1 — CNPJ não cadastrado, empresa recém-aberta ═══
  {id:"B003",cedente:"DISTRIBUIDORA NACIONAL DE INSUMOS LTDA",cnpjCedente:"99.888.777/0001-66",banco:"Banco Inter",agencia:"0001",conta:"9182736-4",valor:74000,vencimento:"2026-04-12",nossoNumero:"",codigoBarras:"07799.00019 18273.640009 00000.000001 5 92820000074000",linha:"DDA",nfReferencia:"",pedidoCompra:"",obs:""},
  // ═══ GOLPE 2 — mesmo padrão ═══
  {id:"B004",cedente:"COMERCIAL DE PRODUTOS INDUSTRIAIS EIRELI",cnpjCedente:"88.777.666/0001-55",banco:"Banco Inter",agencia:"0001",conta:"7263541-2",valor:74000,vencimento:"2026-04-12",nossoNumero:"",codigoBarras:"07788.00017 26354.120009 00000.000001 3 92820000074000",linha:"DDA",nfReferencia:"",pedidoCompra:"",obs:""},
  {id:"B005",cedente:"Transportadora Rápida Ltda",cnpjCedente:"34.567.890/0001-12",banco:"Bradesco",agencia:"2341",conta:"45123-0",valor:14800,vencimento:"2026-04-20",nossoNumero:"00123456",codigoBarras:"23793.23411 00123.456001 00451.230001 7 92900000014800",linha:"DDA",nfReferencia:"CT-e 892",pedidoCompra:"PC-2026-0145",obs:"Frete Chapecó-Florianópolis"},
  {id:"B006",cedente:"Condimentos Brasileiros Ind.",cnpjCedente:"45.678.901/0001-23",banco:"Sicoob",agencia:"3012",conta:"18234-5",valor:7200,vencimento:"2026-04-22",nossoNumero:"00045678",codigoBarras:"75693.30121 00045.678001 18234.500001 2 92920000007200",linha:"DDA",nfReferencia:"NF-e 3421",pedidoCompra:"PC-2026-0139",obs:"Condimentos e temperos — pedido mensal"},
  // ═══ GOLPE 3 — valor muito acima do ticket médio ═══
  {id:"B007",cedente:"Veterinária Oeste Ltda",cnpjCedente:"89.012.345/0001-67",banco:"Caixa",agencia:"0812",conta:"90012-3",valor:68500,vencimento:"2026-04-14",nossoNumero:"00091234",codigoBarras:"10498.08121 00091.234001 90012.300001 4 92840000068500",linha:"Manual",nfReferencia:"",pedidoCompra:"",obs:"Compra especial de medicamentos"},
  {id:"B008",cedente:"CELESC — Centrais Elétricas SC",cnpjCedente:"56.789.012/0001-34",banco:"Banco do Brasil",agencia:"3421",conta:"99812-1",valor:31200,vencimento:"2026-04-25",nossoNumero:"04521892",codigoBarras:"23793.34211 04521.892001 99812.100001 6 92950000031200",linha:"DDA",nfReferencia:"Fatura 04/2026",pedidoCompra:"",obs:"Energia elétrica — unidade industrial"},
];

// ═══ MOTOR DE VALIDAÇÃO ANTI-FRAUDE ═══
function validarBoleto(b:any):{score:number;alertas:any[];nivel:string;cor:string}{
  const alertas:any[]=[];
  let score=0;

  // 1. FORNECEDOR CADASTRADO?
  const fornecedor=FORNECEDORES_ATIVOS.find(f=>f.cnpj===b.cnpjCedente);
  if(fornecedor){
    score+=25;
    // 2. VALOR DENTRO DA FAIXA?
    const ratio=b.valor/fornecedor.ticketMedio;
    if(ratio<=2){score+=20;}
    else if(ratio<=5){score+=10;alertas.push({tipo:"⚠️",msg:`Valor ${ratio.toFixed(1)}x acima do ticket médio (${fR(fornecedor.ticketMedio)})`,gravidade:"media"});}
    else{alertas.push({tipo:"🔴",msg:`Valor ${ratio.toFixed(1)}x acima do ticket médio (${fR(fornecedor.ticketMedio)}). Extremamente atípico.`,gravidade:"alta"});}
    // 3. TEMPO DE RELACIONAMENTO
    const anos=2026-parseInt(fornecedor.desde);
    if(anos>=3){score+=10;}else if(anos>=1){score+=5;}
  }else{
    alertas.push({tipo:"🔴",msg:"CNPJ NÃO CADASTRADO como fornecedor ativo. Possível fraude.",gravidade:"critica"});
  }

  // 4. TEM NOTA FISCAL VINCULADA?
  if(b.nfReferencia&&b.nfReferencia.length>0){score+=15;}
  else{alertas.push({tipo:"🔴",msg:"Sem nota fiscal vinculada (NF-e / CT-e / NFS-e).",gravidade:"alta"});}

  // 5. TEM PEDIDO DE COMPRA?
  if(b.pedidoCompra&&b.pedidoCompra.length>0){score+=10;}
  else{alertas.push({tipo:"⚠️",msg:"Sem pedido de compra vinculado.",gravidade:"media"});}

  // 6. NOSSO NÚMERO PREENCHIDO?
  if(b.nossoNumero&&b.nossoNumero.length>0){score+=5;}
  else{alertas.push({tipo:"🔴",msg:"Campo 'Nosso Número' vazio — boleto pode ser ilegítimo.",gravidade:"alta"});}

  // 7. DADOS DO CÓDIGO DE BARRAS
  if(b.codigoBarras&&b.codigoBarras.length>=44){score+=5;}
  else{alertas.push({tipo:"⚠️",msg:"Código de barras incompleto ou inválido.",gravidade:"media"});}

  // 8. BANCO EMISSOR CONSISTENTE
  const bancosComuns=["Banco do Brasil","Itaú","Bradesco","Santander","Caixa","Sicoob","Sicredi","Banrisul"];
  const bancoSuspeito=!bancosComuns.some(bc=>b.banco?.includes(bc));
  if(!bancoSuspeito){score+=5;}
  else if(b.banco?.includes("Inter")){alertas.push({tipo:"⚠️",msg:`Banco ${b.banco} — comum em boletos fraudulentos via DDA.`,gravidade:"media"});}

  // 9. VALOR REDONDO SUSPEITO
  if(b.valor>=50000&&b.valor%1000===0){alertas.push({tipo:"⚠️",msg:`Valor redondo de ${fR(b.valor)} — padrão comum em fraudes.`,gravidade:"media"});}

  // 10. BOLETOS DUPLICADOS (mesmo valor, mesma data)
  const duplicados=BOLETOS.filter(x=>x.id!==b.id&&x.valor===b.valor&&x.vencimento===b.vencimento);
  if(duplicados.length>0){alertas.push({tipo:"🔴",msg:`${duplicados.length} boleto(s) com MESMO VALOR e MESMO VENCIMENTO. Padrão de fraude em lote.`,gravidade:"critica"});}

  // 11. CNPJ COM PADRÃO SUSPEITO
  const cnpjNum=b.cnpjCedente?.replace(/\D/g,"")||"";
  if(cnpjNum.length===14){
    const digitos=[...new Set(cnpjNum.split(""))];
    if(digitos.length<=4){alertas.push({tipo:"🔴",msg:"CNPJ com padrão numérico suspeito.",gravidade:"alta"});}
  }

  // CLASSIFICAÇÃO
  score=Math.min(score,100);
  let nivel="",cor="";
  if(score>=80){nivel="✅ SEGURO";cor=C.g;}
  else if(score>=60){nivel="⚠️ ATENÇÃO";cor=C.y;}
  else if(score>=30){nivel="🔴 SUSPEITO";cor=C.or;}
  else{nivel="🚨 PROVÁVEL FRAUDE";cor=C.r;}

  if(alertas.filter(a=>a.gravidade==="critica").length>=2){score=Math.min(score,10);nivel="🚨 PROVÁVEL FRAUDE";cor=C.r;}

  return{score,alertas,nivel,cor};
}

// ═══ COMPONENTES ═══
export default function AntiFraudePage(){
  const[selected,setSelected]=useState<string|null>(null);
  const[filtro,setFiltro]=useState("todos");

  const analisados=BOLETOS.map(b=>({...b,...validarBoleto(b)}));
  const filtrados=filtro==="todos"?analisados:filtro==="fraude"?analisados.filter(a=>a.score<30):filtro==="suspeito"?analisados.filter(a=>a.score>=30&&a.score<60):analisados.filter(a=>a.score>=60);
  const selBoleto=selected?analisados.find(a=>a.id===selected):null;

  const totalBoletos=analisados.length;
  const totalValor=analisados.reduce((s,a)=>s+a.valor,0);
  const fraudes=analisados.filter(a=>a.score<30);
  const valorFraude=fraudes.reduce((s,a)=>s+a.valor,0);
  const seguros=analisados.filter(a=>a.score>=60);
  const valorSeguro=seguros.reduce((s,a)=>s+a.valor,0);

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {/* HEADER */}
      <div style={{background:C.esp,padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.r}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.r}}>🛡️ PS Gestão — Anti-Fraude de Boletos</div>
          <div style={{fontSize:10,color:C.txm}}>Validação automática com IA | Cruzamento com fornecedores | Score de risco | Dados Simulados</div>
        </div>
        <a href="/dashboard" style={{padding:"6px 12px",border:`1px solid ${C.bd}`,borderRadius:8,color:C.txm,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,padding:"12px 16px"}}>
        {[
          {l:"Boletos Analisados",v:`${totalBoletos}`,c:C.b},
          {l:"Valor Total",v:fR(totalValor),c:C.txm},
          {l:"🚨 Prováveis Fraudes",v:`${fraudes.length}`,c:C.r},
          {l:"💰 Valor em Risco",v:fR(valorFraude),c:C.r},
          {l:"✅ Seguros",v:`${seguros.length}`,c:C.g},
          {l:"💰 Valor Seguro",v:fR(valorSeguro),c:C.g},
        ].map((k,i)=>(
          <div key={i} style={{background:C.bg2,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${k.c}`}}>
            <div style={{fontSize:7,color:C.txd,textTransform:"uppercase"}}>{k.l}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* ALERTA PRINCIPAL */}
      {fraudes.length>0&&(
        <div style={{margin:"0 16px 12px",padding:14,background:C.r+"15",borderRadius:10,border:`1px solid ${C.r}40`,borderLeft:`4px solid ${C.r}`}}>
          <div style={{fontSize:14,fontWeight:700,color:C.r,marginBottom:4}}>🚨 ALERTA: {fraudes.length} boleto(s) com alta probabilidade de fraude detectado(s)</div>
          <div style={{fontSize:11,color:C.tx}}>
            Valor total em risco: <b style={{color:C.r}}>{fR(valorFraude)}</b> — Recomendação: <b>NÃO PAGAR</b> sem verificação manual com o fornecedor por telefone (número já cadastrado, não o do boleto).
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,padding:"0 16px 16px"}}>
        {/* LISTA DE BOLETOS */}
        <div style={{background:C.bg2,borderRadius:10,padding:12,border:`1px solid ${C.bd}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:C.gol}}>Boletos para Validação</div>
            <div style={{display:"flex",gap:4}}>
              {[{id:"todos",l:"Todos"},{id:"fraude",l:"🚨 Fraude"},{id:"suspeito",l:"⚠️ Suspeito"},{id:"seguro",l:"✅ Seguro"}].map(f=>(
                <button key={f.id} onClick={()=>setFiltro(f.id)} style={{padding:"3px 8px",borderRadius:4,border:"none",cursor:"pointer",fontSize:8,background:filtro===f.id?C.go+"30":"transparent",color:filtro===f.id?C.gol:C.txm}}>{f.l}</button>
              ))}
            </div>
          </div>
          {filtrados.map(b=>(
            <div key={b.id} onClick={()=>setSelected(b.id)} style={{padding:10,marginBottom:6,borderRadius:8,border:`1px solid ${selected===b.id?b.cor:C.bd}`,background:selected===b.id?b.cor+"08":C.bg3,cursor:"pointer",transition:"all 0.15s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:11,fontWeight:600,color:C.tx,maxWidth:"60%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.cedente}</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:700,color:b.cor}}>{fR(b.valor)}</span>
                  <span style={{padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:700,background:b.cor+"20",color:b.cor}}>{b.score}</span>
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.txd}}>
                <span>{b.cnpjCedente}</span>
                <span>Venc: {b.vencimento}</span>
              </div>
              <div style={{fontSize:9,fontWeight:600,color:b.cor,marginTop:2}}>{b.nivel}</div>
            </div>
          ))}
        </div>

        {/* DETALHE DO BOLETO */}
        <div style={{background:C.bg2,borderRadius:10,padding:12,border:`1px solid ${C.bd}`}}>
          {selBoleto?(
            <>
              <div style={{fontSize:13,fontWeight:700,color:selBoleto.cor,marginBottom:8,paddingBottom:8,borderBottom:`1px solid ${C.bd}`}}>
                {selBoleto.nivel} — Score: {selBoleto.score}/100
              </div>

              {/* SCORE BAR */}
              <div style={{marginBottom:12}}>
                <div style={{height:8,background:C.bg3,borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${selBoleto.score}%`,background:selBoleto.cor,borderRadius:4,transition:"width 0.3s"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.txd,marginTop:2}}>
                  <span>0 — FRAUDE</span><span>30</span><span>60</span><span>100 — SEGURO</span>
                </div>
              </div>

              {/* DADOS DO BOLETO */}
              <div style={{fontSize:10,marginBottom:12}}>
                {[
                  ["Cedente",selBoleto.cedente],["CNPJ Cedente",selBoleto.cnpjCedente],
                  ["Banco",selBoleto.banco],["Agência/Conta",`${selBoleto.agencia} / ${selBoleto.conta}`],
                  ["Valor",fR(selBoleto.valor)],["Vencimento",selBoleto.vencimento],
                  ["Nosso Número",selBoleto.nossoNumero||"❌ VAZIO"],
                  ["NF Referência",selBoleto.nfReferencia||"❌ SEM NF"],
                  ["Pedido Compra",selBoleto.pedidoCompra||"❌ SEM PEDIDO"],
                  ["Origem",selBoleto.linha],
                ].map(([k,v],i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
                    <span style={{color:C.txm}}>{k}</span>
                    <span style={{color:(v as string).includes("❌")?C.r:C.tx,fontWeight:(v as string).includes("❌")?600:400}}>{v}</span>
                  </div>
                ))}
              </div>

              {/* FORNECEDOR */}
              {(()=>{
                const forn=FORNECEDORES_ATIVOS.find(f=>f.cnpj===selBoleto.cnpjCedente);
                return forn?(
                  <div style={{padding:8,background:C.g+"10",borderRadius:6,borderLeft:`3px solid ${C.g}`,marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:600,color:C.g}}>✅ Fornecedor cadastrado desde {forn.desde}</div>
                    <div style={{fontSize:9,color:C.txm}}>Ticket médio: {fR(forn.ticketMedio)} | Último pagamento: {forn.ultimoPgto}</div>
                  </div>
                ):(
                  <div style={{padding:8,background:C.r+"10",borderRadius:6,borderLeft:`3px solid ${C.r}`,marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:600,color:C.r}}>🚨 CNPJ NÃO ENCONTRADO na base de fornecedores</div>
                    <div style={{fontSize:9,color:C.txm}}>Este CNPJ nunca foi pago pela empresa. Alta probabilidade de fraude.</div>
                  </div>
                );
              })()}

              {/* ALERTAS */}
              <div style={{fontSize:11,fontWeight:600,color:C.gol,marginBottom:6}}>Alertas ({selBoleto.alertas.length}):</div>
              {selBoleto.alertas.map((a:any,i:number)=>(
                <div key={i} style={{padding:6,marginBottom:4,borderRadius:6,background:a.gravidade==="critica"?C.r+"10":a.gravidade==="alta"?C.or+"10":C.y+"10",borderLeft:`3px solid ${a.gravidade==="critica"?C.r:a.gravidade==="alta"?C.or:C.y}`}}>
                  <div style={{fontSize:10,color:a.gravidade==="critica"?C.r:a.gravidade==="alta"?C.or:C.y}}>{a.tipo} {a.msg}</div>
                </div>
              ))}
              {selBoleto.alertas.length===0&&(
                <div style={{padding:8,background:C.g+"10",borderRadius:6,fontSize:10,color:C.g}}>✅ Nenhum alerta. Boleto passou em todas as verificações.</div>
              )}

              {/* RECOMENDAÇÃO */}
              <div style={{marginTop:10,padding:10,borderRadius:8,background:selBoleto.score>=60?C.g+"10":C.r+"10",border:`1px solid ${selBoleto.score>=60?C.g:C.r}40`}}>
                <div style={{fontSize:11,fontWeight:700,color:selBoleto.score>=60?C.g:C.r}}>
                  {selBoleto.score>=80?"✅ RECOMENDAÇÃO: Pode pagar normalmente":
                   selBoleto.score>=60?"⚠️ RECOMENDAÇÃO: Pagar após conferência manual":
                   selBoleto.score>=30?"🔴 RECOMENDAÇÃO: NÃO PAGAR sem verificação com fornecedor":
                   "🚨 RECOMENDAÇÃO: NÃO PAGAR — Alta probabilidade de fraude. Ligar para fornecedor no telefone JÁ CADASTRADO (não usar o telefone do boleto)."}
                </div>
              </div>

              {/* AÇÕES */}
              <div style={{display:"flex",gap:6,marginTop:10}}>
                <button style={{flex:1,padding:"8px",borderRadius:6,border:"none",background:C.g,color:C.bg,fontSize:10,fontWeight:700,cursor:"pointer"}}>✅ Aprovar Pagamento</button>
                <button style={{flex:1,padding:"8px",borderRadius:6,border:"none",background:C.r,color:C.ow,fontSize:10,fontWeight:700,cursor:"pointer"}}>🚫 Rejeitar / Fraude</button>
                <button style={{flex:1,padding:"8px",borderRadius:6,border:"none",background:C.y,color:C.bg,fontSize:10,fontWeight:700,cursor:"pointer"}}>📋 Enviar p/ Revisão</button>
              </div>
            </>
          ):(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.txd,fontSize:12}}>
              Selecione um boleto para ver a análise completa
            </div>
          )}
        </div>
      </div>

      {/* REGRAS DE VALIDAÇÃO */}
      <div style={{margin:"0 16px 16px",background:C.bg2,borderRadius:10,padding:12,border:`1px solid ${C.bd}`}}>
        <div style={{fontSize:13,fontWeight:700,color:C.gol,marginBottom:8}}>📋 11 Regras de Validação Anti-Fraude</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {[
            {n:1,r:"Fornecedor cadastrado na base",p:"+25 pts",c:C.g},
            {n:2,r:"Valor dentro da faixa do ticket médio",p:"+20 pts",c:C.g},
            {n:3,r:"Tempo de relacionamento com fornecedor",p:"+10 pts",c:C.g},
            {n:4,r:"Nota fiscal vinculada (NF-e/CT-e/NFS-e)",p:"+15 pts",c:C.g},
            {n:5,r:"Pedido de compra vinculado",p:"+10 pts",c:C.b},
            {n:6,r:"Campo 'Nosso Número' preenchido",p:"+5 pts",c:C.b},
            {n:7,r:"Código de barras válido e completo",p:"+5 pts",c:C.b},
            {n:8,r:"Banco emissor reconhecido",p:"+5 pts",c:C.b},
            {n:9,r:"Valor redondo acima de R$ 50K = alerta",p:"Flag",c:C.y},
            {n:10,r:"Boletos duplicados (mesmo valor + vencimento)",p:"Flag crítico",c:C.r},
            {n:11,r:"CNPJ com padrão numérico suspeito",p:"Flag",c:C.r},
          ].map(rule=>(
            <div key={rule.n} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",borderBottom:`0.5px solid ${C.bd}20`}}>
              <span style={{fontSize:9,color:C.txm}}>{rule.n}. {rule.r}</span>
              <span style={{fontSize:9,fontWeight:600,color:rule.c}}>{rule.p}</span>
            </div>
          ))}
        </div>
        <div style={{marginTop:8,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[{l:"80-100",n:"✅ SEGURO",c:C.g},{l:"60-79",n:"⚠️ ATENÇÃO",c:C.y},{l:"30-59",n:"🔴 SUSPEITO",c:C.or},{l:"0-29",n:"🚨 FRAUDE",c:C.r}].map((s,i)=>(
            <div key={i} style={{textAlign:"center",padding:6,borderRadius:6,background:s.c+"10"}}>
              <div style={{fontSize:14,fontWeight:700,color:s.c}}>{s.l}</div>
              <div style={{fontSize:8,color:s.c}}>{s.n}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{textAlign:"center",padding:12,fontSize:9,color:C.txd}}>PS Gestão e Capital — Módulo Anti-Fraude v1.0 — Patente INPI em registro — Dados Simulados</div>
    </div>
  );
}
