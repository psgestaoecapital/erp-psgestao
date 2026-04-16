'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const C={bg:'#0F0F0F',card:'#1A1410',card2:'#1E1E1B',border:'#2A2822',gold:'#C8941A',goldL:'#E8C872',text:'#FAF7F2',muted:'#B0AB9F',dim:'#918C82',green:'#22C55E',red:'#EF4444',blue:'#3B82F6',yellow:'#F59E0B',purple:'#8B5CF6'}
const STATUS_COLORS:Record<string,string>={PAGO:C.green,RECEBIDO:C.green,'A VENCER':C.yellow,VENCIDO:C.red,CANCELADO:C.dim}
const fmtVal=(v:number)=>`R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2})}`
const today=()=>{const d=new Date();return`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`}
const addDaysBR=(dateBR:string,days:number)=>{const[d,m,y]=dateBR.split('/');const dt=new Date(parseInt(y),parseInt(m)-1,parseInt(d));dt.setDate(dt.getDate()+days);return`${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`}

// Date mask: DD/MM/YYYY — auto-separator
const maskDate=(v:string)=>{
  const nums=v.replace(/\D/g,'').slice(0,8)
  if(nums.length<=2)return nums
  if(nums.length<=4)return`${nums.slice(0,2)}/${nums.slice(2)}`
  return`${nums.slice(0,2)}/${nums.slice(2,4)}/${nums.slice(4)}`
}

const FORMAS_PGTO=[
  {v:'boleto',l:'🏦 Boleto',c:C.blue},
  {v:'pix',l:'⚡ PIX',c:C.green},
  {v:'transferencia',l:'💸 Transferência',c:C.blue},
  {v:'cartao_credito',l:'💳 Cartão Crédito',c:C.purple},
  {v:'cartao_debito',l:'💳 Cartão Débito',c:C.purple},
  {v:'dinheiro',l:'💵 Dinheiro',c:C.yellow},
  {v:'cheque',l:'📝 Cheque',c:C.gold},
  {v:'debito_automatico',l:'🔄 Débito Auto',c:C.dim},
]

type Pessoa={id?:string;nome_fantasia:string;razao_social?:string;cnpj_cpf?:string;telefone?:string;email?:string;cidade_estado?:string;endereco?:string;observacao?:string;ativo?:boolean}
type ContaBancaria={id?:string;nome:string;banco?:string;agencia?:string;conta?:string;tipo?:string;saldo_inicial?:number;ativo?:boolean}
type Lanc={id?:string;tipo:string;nome_pessoa?:string;cliente_id?:string;fornecedor_id?:string;data_emissao?:string;data_vencimento:string;data_previsao?:string;data_pagamento?:string;valor_documento:number;status:string;categoria?:string;subcategoria?:string;numero_documento?:string;descricao?:string;parcela_atual?:number;total_parcelas?:number;forma_pagamento?:string;conta_bancaria_id?:string;juros?:number;multa?:number;desconto?:number;observacao_interna?:string;tags?:string[];intervalo_dias?:number;recorrente?:boolean;frequencia?:string}

// Date input component - with mask + native picker
function DateInput({value,onChange,label,required,color}:{value:string;onChange:(v:string)=>void;label?:string;required?:boolean;color?:string}){
  const dateToISO=(br:string)=>{const m=br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:''}
  const isoToBR=(iso:string)=>{const m=iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:''}
  return(
    <div style={{position:'relative'}}>
      {label&&<div style={{fontSize:10,color:color||C.muted,marginBottom:3,fontWeight:required?600:400}}>{label}{required&&' *'}</div>}
      <div style={{position:'relative'}}>
        <input value={value||''} onChange={e=>onChange(maskDate(e.target.value))} placeholder="DD/MM/AAAA" maxLength={10}
          style={{background:C.card2,border:`1px solid ${C.border}`,color:C.text,borderRadius:6,padding:'8px 34px 8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'Arial'}}/>
        <input type="date" value={dateToISO(value||'')} onChange={e=>onChange(isoToBR(e.target.value))}
          style={{position:'absolute',right:4,top:4,width:26,height:26,opacity:0.7,cursor:'pointer',background:'transparent',border:'none',colorScheme:'dark'}}/>
      </div>
    </div>
  )
}

export default function OperacionalPage(){
  const [empresas,setEmpresas]=useState<any[]>([])
  const [sel,setSel]=useState('')
  const [tab,setTab]=useState<'receber'|'pagar'|'clientes'|'fornecedores'|'bancarias'|'plano'>('receber')
  const [loading,setLoading]=useState(true)
  const [msg,setMsg]=useState('')

  const [lancs,setLancs]=useState<Lanc[]>([])
  const [clientes,setClientes]=useState<Pessoa[]>([])
  const [fornecedores,setFornecedores]=useState<Pessoa[]>([])
  const [contasBancarias,setContasBancarias]=useState<ContaBancaria[]>([])
  const [plano,setPlano]=useState<any[]>([])

  const [showForm,setShowForm]=useState(false)
  const [saving,setSaving]=useState(false)
  const [editId,setEditId]=useState<string|null>(null)
  const [filtro,setFiltro]=useState('')
  const [filtroStatus,setFiltroStatus]=useState('')

  const emptyLanc:Lanc={tipo:'receber',data_emissao:today(),data_vencimento:today(),data_previsao:today(),valor_documento:0,status:'A VENCER',nome_pessoa:'',categoria:'',descricao:'',numero_documento:'',parcela_atual:1,total_parcelas:1,intervalo_dias:30}
  const [formL,setFormL]=useState<Lanc>(emptyLanc)

  const emptyPessoa:Pessoa={nome_fantasia:'',razao_social:'',cnpj_cpf:'',telefone:'',email:'',cidade_estado:'',endereco:'',observacao:''}
  const [formP,setFormP]=useState<Pessoa>(emptyPessoa)

  const emptyCB:ContaBancaria={nome:'',banco:'',agencia:'',conta:'',tipo:'corrente',saldo_inicial:0}
  const [formCB,setFormCB]=useState<ContaBancaria>(emptyCB)

  const [suggestions,setSuggestions]=useState<Pessoa[]>([])
  const [showSugg,setShowSugg]=useState(false)
  const [catSearch,setCatSearch]=useState('')
  const [showCatDrop,setShowCatDrop]=useState(false)

  const [formPC,setFormPC]=useState({codigo:'',descricao:'',grupo:'despesa',tipo:'despesa' as string,pai_codigo:'',nivel:3})
  const [showFormPC,setShowFormPC]=useState(false)
  const [editPC,setEditPC]=useState<string|null>(null)

  const catDropRef=useRef<HTMLDivElement>(null)
  const suggDropRef=useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(()=>{
    const handler=(e:MouseEvent)=>{
      if(catDropRef.current&&!catDropRef.current.contains(e.target as Node))setShowCatDrop(false)
      if(suggDropRef.current&&!suggDropRef.current.contains(e.target as Node))setShowSugg(false)
    }
    document.addEventListener('mousedown',handler)
    return()=>document.removeEventListener('mousedown',handler)
  },[])

  useEffect(()=>{
    (async()=>{
      const{data:{user}}=await supabase.auth.getUser();if(!user)return
      const{data:up}=await supabase.from('users').select('role').eq('id',user.id).single()
      let comps:any[]=[]
      if(up?.role==='adm'||up?.role==='acesso_total'||up?.role==='adm_investimentos'){
        const{data}=await supabase.from('companies').select('id,nome_fantasia,razao_social').order('nome_fantasia');comps=data||[]
      }else{
        const{data:uc}=await supabase.from('user_companies').select('companies(id,nome_fantasia,razao_social)').eq('user_id',user.id)
        comps=(uc||[]).map((u:any)=>u.companies).filter(Boolean)
      }
      setEmpresas(comps);if(comps.length>0)setSel(comps[0].id);setLoading(false)
    })()
  },[])

  const loadAll=useCallback(async()=>{
    if(!sel)return;setLoading(true)
    const{data:ld}=await supabase.from('erp_lancamentos').select('*').eq('company_id',sel).order('data_vencimento',{ascending:false})
    setLancs((ld||[]).map((r:any)=>({...r,valor_documento:Number(r.valor_documento)})))
    const{data:cd}=await supabase.from('erp_clientes').select('*').eq('company_id',sel).eq('ativo',true).order('nome_fantasia')
    setClientes(cd||[])
    const{data:fd}=await supabase.from('erp_fornecedores').select('*').eq('company_id',sel).eq('ativo',true).order('nome_fantasia')
    setFornecedores(fd||[])
    const{data:pc}=await supabase.from('erp_plano_contas').select('*').or(`company_id.is.null,company_id.eq.${sel}`).eq('ativo',true).order('codigo')
    setPlano(pc||[])
    try{
      const{data:cb}=await supabase.from('erp_contas_bancarias').select('*').eq('company_id',sel).eq('ativo',true).order('nome')
      setContasBancarias(cb||[])
    }catch{}
    setLoading(false)
  },[sel])

  useEffect(()=>{loadAll()},[loadAll])

  // Save with parcel auto-generation
  const saveLanc=async()=>{
    if(formL.valor_documento<=0||!formL.data_vencimento){setMsg('❌ Preencha valor e vencimento');return}
    setSaving(true)
    const tipo=tab==='pagar'?'pagar':'receber'
    const catParts=(formL.categoria||'').split(' ')
    const codCat=catParts[0]||''
    const descCat=catParts.slice(1).join(' ')||formL.categoria||''

    const baseRecord:any={
      company_id:sel, tipo,
      nome_pessoa:formL.nome_pessoa||'',
      cliente_id:tipo==='receber'&&formL.cliente_id?formL.cliente_id:null,
      fornecedor_id:tipo==='pagar'&&formL.fornecedor_id?formL.fornecedor_id:null,
      data_emissao:formL.data_emissao||formL.data_vencimento,
      status:formL.status,
      categoria:codCat,
      subcategoria:descCat,
      numero_documento:formL.numero_documento||'',
      descricao:formL.descricao||'',
      forma_pagamento:formL.forma_pagamento||null,
      conta_bancaria_id:formL.conta_bancaria_id||null,
      juros:formL.juros||0,
      multa:formL.multa||0,
      desconto:formL.desconto||0,
      observacao_interna:formL.observacao_interna||'',
    }

    const totalParcelas=formL.total_parcelas||1
    const intervaloDias=formL.intervalo_dias||30
    let err:any=null

    if(editId){
      // Update existing
      const record={...baseRecord,data_vencimento:formL.data_vencimento,data_previsao:formL.data_previsao||formL.data_vencimento,data_pagamento:(formL.status==='PAGO'||formL.status==='RECEBIDO')?formL.data_pagamento||null:null,valor_documento:formL.valor_documento,parcela_atual:formL.parcela_atual||1,total_parcelas:totalParcelas,intervalo_dias:intervaloDias,updated_at:new Date().toISOString()}
      const r=await supabase.from('erp_lancamentos').update(record).eq('id',editId)
      err=r.error
    }else if(totalParcelas>1){
      // Generate parcels
      const valorParcela=Math.round((formL.valor_documento/totalParcelas)*100)/100
      const records=[]
      for(let i=0;i<totalParcelas;i++){
        const dtVenc=i===0?formL.data_vencimento:addDaysBR(formL.data_vencimento,intervaloDias*i)
        records.push({...baseRecord,data_vencimento:dtVenc,data_previsao:dtVenc,data_pagamento:null,valor_documento:valorParcela,parcela_atual:i+1,total_parcelas:totalParcelas,intervalo_dias:intervaloDias,descricao:`${formL.descricao||''} (${i+1}/${totalParcelas})`})
      }
      const r=await supabase.from('erp_lancamentos').insert(records)
      err=r.error
    }else{
      // Single record
      const record={...baseRecord,data_vencimento:formL.data_vencimento,data_previsao:formL.data_previsao||formL.data_vencimento,data_pagamento:(formL.status==='PAGO'||formL.status==='RECEBIDO')?formL.data_pagamento||null:null,valor_documento:formL.valor_documento,parcela_atual:1,total_parcelas:1,intervalo_dias:intervaloDias}
      const r=await supabase.from('erp_lancamentos').insert(record)
      err=r.error
    }

    if(err){setMsg('❌ '+err.message)}
    else{
      setMsg(editId?'✅ Atualizado!':totalParcelas>1?`✅ ${totalParcelas} parcelas cadastradas!`:'✅ Cadastrado!')
      // Sync to omie_imports
      await syncToOmie(baseRecord,tipo,formL)
      setShowForm(false);setEditId(null);setFormL({...emptyLanc,tipo});setCatSearch('');await loadAll()
    }
    setSaving(false);setTimeout(()=>setMsg(''),3000)
  }

  const syncToOmie=async(record:any,tipo:string,form:Lanc)=>{
    const importType=tipo==='pagar'?'contas_pagar':'contas_receber'
    const key=tipo==='pagar'?'conta_pagar_cadastro':'conta_receber_cadastro'
    const reg:any={
      data_emissao:record.data_emissao,data_vencimento:form.data_vencimento,
      data_previsao:form.data_previsao||form.data_vencimento,status_titulo:record.status,
      valor_documento:form.valor_documento,numero_documento:record.numero_documento,
      observacao:record.descricao,codigo_categoria:record.categoria,
      descricao_categoria:record.subcategoria||record.categoria,
    }
    if(tipo==='pagar'){reg.nome_fornecedor=record.nome_pessoa;if(form.data_pagamento){reg.data_pagamento=form.data_pagamento;reg.data_baixa=form.data_pagamento}}
    else{reg.nome_cliente=record.nome_pessoa;if(form.data_pagamento){reg.data_pagamento=form.data_pagamento;reg.data_baixa=form.data_pagamento}}
    await supabase.from('omie_imports').insert({company_id:sel,import_type:importType,import_data:{[key]:[reg],manual_id:'erp_'+Date.now()},record_count:1})
  }

  const deleteLanc=async(id:string)=>{
    if(!confirm('Excluir este lançamento?'))return
    await supabase.from('erp_lancamentos').delete().eq('id',id)
    setMsg('✅ Excluído');await loadAll();setTimeout(()=>setMsg(''),3000)
  }

  const savePessoa=async()=>{
    if(!formP.nome_fantasia.trim()){setMsg('❌ Nome obrigatório');return}
    setSaving(true)
    const table=tab==='clientes'?'erp_clientes':'erp_fornecedores'
    const record={company_id:sel,...formP,updated_at:new Date().toISOString()}
    let err:any=null
    if(editId){const r=await supabase.from(table).update(record).eq('id',editId);err=r.error}
    else{const r=await supabase.from(table).insert(record);err=r.error}
    if(err)setMsg('❌ '+err.message)
    else{setMsg(editId?'✅ Atualizado!':'✅ Cadastrado!');setShowForm(false);setEditId(null);setFormP(emptyPessoa);await loadAll()}
    setSaving(false);setTimeout(()=>setMsg(''),3000)
  }

  const deletePessoa=async(id:string)=>{
    if(!confirm('Excluir?'))return
    const table=tab==='clientes'?'erp_clientes':'erp_fornecedores'
    await supabase.from(table).update({ativo:false}).eq('id',id)
    setMsg('✅ Desativado');await loadAll();setTimeout(()=>setMsg(''),3000)
  }

  const saveContaBancaria=async()=>{
    if(!formCB.nome.trim()){setMsg('❌ Nome obrigatório');return}
    setSaving(true)
    const record={company_id:sel,...formCB}
    let err:any=null
    if(editId){const r=await supabase.from('erp_contas_bancarias').update(record).eq('id',editId);err=r.error}
    else{const r=await supabase.from('erp_contas_bancarias').insert(record);err=r.error}
    if(err)setMsg('❌ '+err.message)
    else{setMsg('✅ Conta bancária salva!');setShowForm(false);setEditId(null);setFormCB(emptyCB);await loadAll()}
    setSaving(false);setTimeout(()=>setMsg(''),3000)
  }

  const searchPessoa=(text:string)=>{
    setFormL({...formL,nome_pessoa:text})
    if(text.length<2){setSuggestions([]);setShowSugg(false);return}
    const lista=tab==='receber'?clientes:fornecedores
    const found=lista.filter(p=>p.nome_fantasia.toLowerCase().includes(text.toLowerCase())).slice(0,5)
    setSuggestions(found);setShowSugg(found.length>0)
  }

  const selectPessoa=(p:Pessoa)=>{
    setFormL({...formL,nome_pessoa:p.nome_fantasia,cliente_id:tab==='receber'?p.id:undefined,fornecedor_id:tab==='pagar'?p.id:undefined})
    setShowSugg(false)
  }

  const tipoTab=tab==='pagar'?'pagar':'receber'
  const filteredLancs=lancs.filter(l=>{
    if(l.tipo!==tipoTab)return false
    const search=`${l.nome_pessoa} ${l.descricao} ${l.categoria} ${l.numero_documento}`.toLowerCase()
    if(filtro&&!search.includes(filtro.toLowerCase()))return false
    if(filtroStatus&&l.status!==filtroStatus)return false
    return true
  })
  const totalVal=filteredLancs.reduce((s,l)=>s+l.valor_documento,0)
  const totalPago=filteredLancs.filter(l=>l.status==='PAGO'||l.status==='RECEBIDO').reduce((s,l)=>s+l.valor_documento,0)
  const totalPend=filteredLancs.filter(l=>l.status==='A VENCER').reduce((s,l)=>s+l.valor_documento,0)
  const totalVenc=filteredLancs.filter(l=>l.status==='VENCIDO').reduce((s,l)=>s+l.valor_documento,0)
  const filteredPessoas=(tab==='clientes'?clientes:fornecedores).filter(p=>!filtro||p.nome_fantasia.toLowerCase().includes(filtro.toLowerCase()))

  const inp:React.CSSProperties={background:C.card2,border:`1px solid ${C.border}`,color:C.text,borderRadius:6,padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'Arial'}
  const empresaNome=empresas.find(e=>e.id===sel)?.nome_fantasia||''

  return(
  <div style={{padding:16,minHeight:'100vh',background:C.bg,color:C.text}}>
    {/* HEADER */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:C.gold}}>PS Gestão — Operacional v9.0</div>
        <div style={{fontSize:10,color:C.dim}}>Contas a Pagar · Receber · Clientes · Fornecedores · Bancárias · Plano de Contas</div>
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <select value={sel} onChange={e=>setSel(e.target.value)} style={{...inp,minWidth:200,fontWeight:600,color:C.goldL,cursor:'pointer'}}>
          {empresas.map(e=><option key={e.id} value={e.id}>{e.nome_fantasia||e.razao_social}</option>)}
        </select>
        <a href="/dashboard" style={{padding:'6px 14px',border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
      </div>
    </div>

    {msg&&<div style={{background:msg.includes('❌')?C.red+'20':C.green+'20',border:`1px solid ${msg.includes('❌')?C.red:C.green}`,borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:msg.includes('❌')?C.red:C.green}} onClick={()=>setMsg('')}>{msg}</div>}

    {/* TABS */}
    <div style={{display:'flex',gap:4,marginBottom:16,flexWrap:'wrap'}}>
      {([
        {id:'receber' as const,label:'📥 Contas a Receber',color:C.green,count:lancs.filter(l=>l.tipo==='receber').length},
        {id:'pagar' as const,label:'📤 Contas a Pagar',color:C.red,count:lancs.filter(l=>l.tipo==='pagar').length},
        {id:'clientes' as const,label:'👥 Clientes',color:C.blue,count:clientes.length},
        {id:'fornecedores' as const,label:'🏭 Fornecedores',color:C.purple,count:fornecedores.length},
        {id:'bancarias' as const,label:'🏦 Contas Bancárias',color:C.gold,count:contasBancarias.length},
        {id:'plano' as const,label:'📑 Plano de Contas',color:C.goldL,count:plano.length},
      ]).map(t=>(
        <button key={t.id} onClick={()=>{setTab(t.id);setShowForm(false);setEditId(null);setFiltro('');setFiltroStatus('')}} style={{
          padding:'10px 16px',borderRadius:8,fontSize:12,fontWeight:tab===t.id?700:400,cursor:'pointer',
          border:tab===t.id?`2px solid ${t.color}`:`1px solid ${C.border}`,
          background:tab===t.id?t.color+'15':'transparent',color:tab===t.id?t.color:C.muted
        }}>{t.label}<span style={{marginLeft:6,fontSize:10,opacity:0.7}}>{t.count}</span></button>
      ))}
    </div>

    {/* CONTAS A RECEBER/PAGAR */}
    {(tab==='receber'||tab==='pagar')&&(<>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,marginBottom:12}}>
        {[
          {l:'Total',v:fmtVal(totalVal),c:tab==='receber'?C.green:C.red,icon:'📊'},
          {l:tab==='receber'?'Recebido':'Pago',v:fmtVal(totalPago),c:C.green,icon:'✅'},
          {l:'Pendente',v:fmtVal(totalPend),c:C.yellow,icon:'⏳'},
          {l:'Vencido',v:fmtVal(totalVenc),c:C.red,icon:'🚨'},
          {l:'Registros',v:String(filteredLancs.length),c:C.gold,icon:'📋'},
        ].map((k,i)=>(
          <div key={i} style={{background:`linear-gradient(135deg,${C.card},${C.card2})`,borderRadius:10,padding:10,border:`1px solid ${C.border}`,borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:8,color:C.dim,textTransform:'uppercase'}}>{k.icon} {k.l}</div>
            <div style={{fontSize:15,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{setEditId(null);setFormL({...emptyLanc,tipo:tab==='pagar'?'pagar':'receber'});setCatSearch('');setShowForm(!showForm)}} style={{
          padding:'10px 18px',borderRadius:8,fontWeight:700,fontSize:12,cursor:'pointer',border:'none',
          background:tab==='receber'?`linear-gradient(135deg,${C.green},#10B981)`:`linear-gradient(135deg,${C.red},#DC2626)`,color:C.text
        }}>+ {tab==='receber'?'Nova Conta a Receber':'Nova Conta a Pagar'}</button>
        <input value={filtro} onChange={e=>setFiltro(e.target.value)} placeholder="🔍 Buscar..." style={{...inp,flex:1,minWidth:180}}/>
        <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value)} style={{...inp,width:'auto',cursor:'pointer'}}>
          <option value="">Todos</option>
          <option value="A VENCER">A Vencer</option>
          <option value={tab==='receber'?'RECEBIDO':'PAGO'}>{tab==='receber'?'Recebido':'Pago'}</option>
          <option value="VENCIDO">Vencido</option>
          <option value="CANCELADO">Cancelado</option>
        </select>
      </div>

      {/* FORM */}
      {showForm&&(
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:14,border:`1px solid ${tab==='receber'?C.green:C.red}40`}}>
          <div style={{fontSize:14,fontWeight:700,color:tab==='receber'?C.green:C.red,marginBottom:14}}>
            {editId?'✏️ Editar':'➕ Nova'} — {tab==='receber'?'Conta a Receber':'Conta a Pagar'}
            <span style={{fontSize:10,color:C.dim,marginLeft:8}}>{empresaNome}</span>
          </div>

          {/* BLOCO 1: CLIENTE/FORNECEDOR + VALOR + CATEGORIA */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.gold,marginBottom:6,fontWeight:600,letterSpacing:0.5}}>IDENTIFICAÇÃO</div>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 2fr',gap:10}}>
              <div style={{position:'relative'}} ref={suggDropRef}>
                <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>{tab==='receber'?'CLIENTE *':'FORNECEDOR *'}</div>
                <input value={formL.nome_pessoa||''} onChange={e=>searchPessoa(e.target.value)} onFocus={()=>{if(suggestions.length>0)setShowSugg(true)}}
                  placeholder={`Digite ou selecione ${tab==='receber'?'cliente':'fornecedor'}`} style={inp}/>
                {showSugg&&suggestions.length>0&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:C.card2,border:`1px solid ${C.gold}`,borderRadius:6,zIndex:10,maxHeight:200,overflowY:'auto',marginTop:2}}>
                    {suggestions.map(p=>(
                      <div key={p.id} onClick={()=>selectPessoa(p)} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:12}}
                        onMouseEnter={e=>e.currentTarget.style.background=C.gold+'15'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                        <div style={{fontWeight:600,color:C.text}}>{p.nome_fantasia}</div>
                        <div style={{fontSize:9,color:C.dim}}>{p.cnpj_cpf||''} {p.cidade_estado?'· '+p.cidade_estado:''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>VALOR (R$) *</div>
                <input type="number" step="0.01" value={formL.valor_documento||''} onChange={e=>setFormL({...formL,valor_documento:parseFloat(e.target.value)||0})}
                  placeholder="0,00" style={{...inp,fontSize:16,fontWeight:700,color:tab==='receber'?C.green:C.red}}/>
              </div>
              <div style={{position:'relative'}} ref={catDropRef}>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CATEGORIA</div>
                <input value={catSearch||formL.categoria||''} onChange={e=>{setCatSearch(e.target.value);setShowCatDrop(true)}}
                  onFocus={()=>setShowCatDrop(true)} placeholder="Buscar código ou nome..." style={inp}/>
                {showCatDrop&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:C.card2,border:`1px solid ${C.gold}`,borderRadius:6,zIndex:10,maxHeight:250,overflowY:'auto',marginTop:2}}>
                    {plano.filter(p=>p.nivel>=2).filter(p=>{
                      if(!catSearch)return true
                      const s=catSearch.toLowerCase()
                      return p.codigo.toLowerCase().includes(s)||p.descricao.toLowerCase().includes(s)
                    }).slice(0,20).map(p=>{
                      const isGroup=p.nivel===2
                      return(
                        <div key={p.id} onClick={()=>{
                          if(isGroup)return
                          setFormL({...formL,categoria:p.codigo+' '+p.descricao,subcategoria:p.descricao})
                          setCatSearch(p.codigo+' '+p.descricao)
                          setShowCatDrop(false)
                        }} style={{
                          padding:isGroup?'6px 10px':'6px 10px 6px 24px',cursor:isGroup?'default':'pointer',
                          borderBottom:`1px solid ${C.border}`,fontSize:isGroup?10:11,
                          fontWeight:isGroup?700:400,color:isGroup?C.gold:C.text,
                          background:isGroup?C.bg+'80':'transparent',
                        }}
                          onMouseEnter={e=>{if(!isGroup)e.currentTarget.style.background=C.gold+'15'}}
                          onMouseLeave={e=>{if(!isGroup)e.currentTarget.style.background='transparent'}}>
                          <span style={{color:C.dim,marginRight:6,fontSize:9}}>{p.codigo}</span>{p.descricao}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* BLOCO 2: DATAS + SITUAÇÃO */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.gold,marginBottom:6,fontWeight:600,letterSpacing:0.5}}>DATAS E STATUS</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}>
              <DateInput value={formL.data_emissao||''} onChange={v=>setFormL({...formL,data_emissao:v})} label="DATA EMISSÃO"/>
              <DateInput value={formL.data_vencimento||''} onChange={v=>setFormL({...formL,data_vencimento:v,data_previsao:v})} label="VENCIMENTO" required color={C.gold}/>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>SITUAÇÃO</div>
                <select value={formL.status} onChange={e=>setFormL({...formL,status:e.target.value})} style={{...inp,cursor:'pointer'}}>
                  <option value="A VENCER">A Vencer</option>
                  <option value={tab==='receber'?'RECEBIDO':'PAGO'}>{tab==='receber'?'Recebido':'Pago'}</option>
                  <option value="VENCIDO">Vencido</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>
              {(formL.status==='PAGO'||formL.status==='RECEBIDO')&&(
                <DateInput value={formL.data_pagamento||''} onChange={v=>setFormL({...formL,data_pagamento:v})} label="DATA PAGAMENTO" color={C.green}/>
              )}
            </div>
          </div>

          {/* BLOCO 3: PARCELAMENTO */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.gold,marginBottom:6,fontWeight:600,letterSpacing:0.5}}>PARCELAMENTO</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,alignItems:'flex-end'}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>TOTAL PARCELAS</div>
                <select value={formL.total_parcelas||1} onChange={e=>setFormL({...formL,total_parcelas:parseInt(e.target.value)})} style={{...inp,cursor:'pointer'}}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12,15,18,24,36,48,60].map(n=><option key={n} value={n}>{n}x</option>)}
                </select>
              </div>
              {(formL.total_parcelas||1)>1&&(
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:3}}>INTERVALO (DIAS)</div>
                  <select value={formL.intervalo_dias||30} onChange={e=>setFormL({...formL,intervalo_dias:parseInt(e.target.value)})} style={{...inp,cursor:'pointer'}}>
                    <option value={7}>7 (semanal)</option>
                    <option value={15}>15 (quinzenal)</option>
                    <option value={30}>30 (mensal)</option>
                    <option value={60}>60 (bimestral)</option>
                    <option value={90}>90 (trimestral)</option>
                  </select>
                </div>
              )}
              {(formL.total_parcelas||1)>1&&formL.valor_documento>0&&(
                <div style={{background:C.gold+'15',borderRadius:6,padding:'6px 10px',border:`1px dashed ${C.gold}40`,fontSize:10,color:C.gold}}>
                  <div>Valor por parcela:</div>
                  <div style={{fontSize:14,fontWeight:700,marginTop:2}}>{fmtVal(formL.valor_documento/(formL.total_parcelas||1))}</div>
                </div>
              )}
            </div>
          </div>

          {/* BLOCO 4: PAGAMENTO E BANCO */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.gold,marginBottom:6,fontWeight:600,letterSpacing:0.5}}>FORMA DE PAGAMENTO</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>FORMA DE PAGAMENTO</div>
                <select value={formL.forma_pagamento||''} onChange={e=>setFormL({...formL,forma_pagamento:e.target.value})} style={{...inp,cursor:'pointer'}}>
                  <option value="">Selecione...</option>
                  {FORMAS_PGTO.map(f=><option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CONTA BANCÁRIA</div>
                <select value={formL.conta_bancaria_id||''} onChange={e=>setFormL({...formL,conta_bancaria_id:e.target.value})} style={{...inp,cursor:'pointer'}}>
                  <option value="">Selecione...</option>
                  {contasBancarias.map(cb=><option key={cb.id} value={cb.id}>{cb.nome} {cb.banco?`(${cb.banco})`:''}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Nº DOCUMENTO</div>
                <input value={formL.numero_documento||''} onChange={e=>setFormL({...formL,numero_documento:e.target.value})} placeholder="NF, boleto, nosso nº" style={inp}/>
              </div>
            </div>
          </div>

          {/* BLOCO 5: JUROS/MULTA/DESCONTO */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.gold,marginBottom:6,fontWeight:600,letterSpacing:0.5}}>AJUSTES (OPCIONAL)</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10}}>
              <div>
                <div style={{fontSize:10,color:C.yellow,marginBottom:3}}>JUROS (R$)</div>
                <input type="number" step="0.01" value={formL.juros||''} onChange={e=>setFormL({...formL,juros:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.red,marginBottom:3}}>MULTA (R$)</div>
                <input type="number" step="0.01" value={formL.multa||''} onChange={e=>setFormL({...formL,multa:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.green,marginBottom:3}}>DESCONTO (R$)</div>
                <input type="number" step="0.01" value={formL.desconto||''} onChange={e=>setFormL({...formL,desconto:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/>
              </div>
              {(formL.juros||formL.multa||formL.desconto)&&formL.valor_documento>0&&(
                <div style={{background:C.card2,borderRadius:6,padding:'6px 10px',border:`1px solid ${C.gold}40`,fontSize:10}}>
                  <div style={{color:C.dim}}>VALOR FINAL:</div>
                  <div style={{fontSize:14,fontWeight:700,color:C.gold,marginTop:2}}>{fmtVal(formL.valor_documento+(formL.juros||0)+(formL.multa||0)-(formL.desconto||0))}</div>
                </div>
              )}
            </div>
          </div>

          {/* BLOCO 6: DESCRIÇÃO E OBSERVAÇÕES */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.gold,marginBottom:6,fontWeight:600,letterSpacing:0.5}}>DESCRIÇÃO</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>DESCRIÇÃO (PÚBLICA)</div>
                <input value={formL.descricao||''} onChange={e=>setFormL({...formL,descricao:e.target.value})} placeholder="Descrição do lançamento" style={inp}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>OBSERVAÇÃO INTERNA</div>
                <input value={formL.observacao_interna||''} onChange={e=>setFormL({...formL,observacao_interna:e.target.value})} placeholder="Notas internas (não aparecem no relatório)" style={inp}/>
              </div>
            </div>
          </div>

          {/* BOTÕES */}
          <div style={{display:'flex',gap:8,marginTop:16,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
            <button onClick={saveLanc} disabled={saving} style={{padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',background:saving?C.border:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg}}>
              {saving?'⏳ Salvando...':editId?'💾 Atualizar':`💾 ${(formL.total_parcelas||1)>1?`Salvar ${formL.total_parcelas} Parcelas`:'Salvar'}`}
            </button>
            <button onClick={()=>{setShowForm(false);setEditId(null)}} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* LIST */}
      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        {loading?<div style={{padding:40,textAlign:'center',color:C.gold}}>⏳ Carregando...</div>:
         filteredLancs.length===0?<div style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>{tab==='receber'?'📥':'📤'}</div><div style={{fontSize:13,color:C.gold}}>Nenhum registro</div></div>:
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:900}}>
          <thead><tr style={{borderBottom:`2px solid ${C.gold}40`}}>
            {['Status','Vencimento',tab==='receber'?'Cliente':'Fornecedor','Descrição','Categoria','Forma','Parc.','Valor','Ações'].map(h=>
              <th key={h} style={{padding:'10px 8px',textAlign:h==='Valor'||h==='Ações'?'right':'left',color:C.gold,fontSize:9,fontWeight:600,position:'sticky',top:0,background:C.card}}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {filteredLancs.map(item=>{
              const forma=FORMAS_PGTO.find(f=>f.v===item.forma_pagamento)
              return(
                <tr key={item.id} style={{borderBottom:`0.5px solid ${C.border}30`}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.card2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{padding:8}}><span style={{fontSize:9,padding:'2px 8px',borderRadius:4,fontWeight:600,background:(STATUS_COLORS[item.status]||C.dim)+'18',color:STATUS_COLORS[item.status]||C.dim}}>{item.status}</span></td>
                  <td style={{padding:8,fontWeight:500,whiteSpace:'nowrap'}}>{item.data_vencimento}</td>
                  <td style={{padding:8,fontWeight:500,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.nome_pessoa||'—'}</td>
                  <td style={{padding:8,color:C.muted,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.descricao||'—'}</td>
                  <td style={{padding:8,fontSize:9}}>{item.categoria?<span style={{padding:'2px 6px',borderRadius:4,background:C.purple+'15',color:C.purple}}>{item.categoria}</span>:'—'}</td>
                  <td style={{padding:8,fontSize:10}}>{forma?<span style={{color:forma.c}}>{forma.l}</span>:<span style={{color:C.dim}}>—</span>}</td>
                  <td style={{padding:8,textAlign:'center',fontSize:10,color:C.dim}}>{item.total_parcelas&&item.total_parcelas>1?`${item.parcela_atual}/${item.total_parcelas}`:'—'}</td>
                  <td style={{padding:8,textAlign:'right',fontWeight:700,fontSize:13,color:tab==='receber'?C.green:C.red,whiteSpace:'nowrap'}}>{fmtVal(item.valor_documento)}</td>
                  <td style={{padding:8,textAlign:'right',whiteSpace:'nowrap'}}>
                    <button onClick={()=>{setFormL({...item});setCatSearch(item.categoria||'');setEditId(item.id||null);setShowForm(true)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.blue+'15',border:`1px solid ${C.blue}30`,color:C.blue,cursor:'pointer',marginRight:4}}>✏️</button>
                    <button onClick={()=>deleteLanc(item.id!)} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.red+'15',border:`1px solid ${C.red}30`,color:C.red,cursor:'pointer'}}>🗑</button>
                  </td>
                </tr>
              )
            })}
            <tr style={{borderTop:`2px solid ${C.gold}`,background:C.gold+'08'}}>
              <td colSpan={7} style={{padding:'10px 8px',fontWeight:700,color:C.gold,fontSize:12}}>TOTAL ({filteredLancs.length})</td>
              <td style={{padding:'10px 8px',textAlign:'right',fontWeight:700,fontSize:15,color:tab==='receber'?C.green:C.red}}>{fmtVal(totalVal)}</td>
              <td/>
            </tr>
          </tbody>
        </table>}
      </div>
    </>)}

    {/* CLIENTES / FORNECEDORES */}
    {(tab==='clientes'||tab==='fornecedores')&&(<>
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{setEditId(null);setFormP(emptyPessoa);setShowForm(!showForm)}} style={{
          padding:'10px 18px',borderRadius:8,fontWeight:700,fontSize:12,cursor:'pointer',border:'none',
          background:tab==='clientes'?`linear-gradient(135deg,${C.blue},#2563EB)`:`linear-gradient(135deg,${C.purple},#7C3AED)`,color:C.text
        }}>+ {tab==='clientes'?'Novo Cliente':'Novo Fornecedor'}</button>
        <input value={filtro} onChange={e=>setFiltro(e.target.value)} placeholder="🔍 Buscar..." style={{...inp,flex:1,minWidth:180}}/>
        <div style={{fontSize:11,color:C.dim}}>{filteredPessoas.length} cadastros</div>
      </div>

      {showForm&&(
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:14,border:`1px solid ${tab==='clientes'?C.blue:C.purple}40`}}>
          <div style={{fontSize:14,fontWeight:700,color:tab==='clientes'?C.blue:C.purple,marginBottom:12}}>{editId?'Editar':'Novo'} — {tab==='clientes'?'Cliente':'Fornecedor'}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10}}>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>NOME FANTASIA *</div>
              <input value={formP.nome_fantasia} onChange={e=>setFormP({...formP,nome_fantasia:e.target.value})} placeholder="Nome comercial" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>RAZÃO SOCIAL</div>
              <input value={formP.razao_social||''} onChange={e=>setFormP({...formP,razao_social:e.target.value})} style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CNPJ / CPF</div>
              <input value={formP.cnpj_cpf||''} onChange={e=>setFormP({...formP,cnpj_cpf:e.target.value})} placeholder="00.000.000/0001-00" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>TELEFONE</div>
              <input value={formP.telefone||''} onChange={e=>setFormP({...formP,telefone:e.target.value})} placeholder="(49) 99999-9999" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>E-MAIL</div>
              <input value={formP.email||''} onChange={e=>setFormP({...formP,email:e.target.value})} style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CIDADE / UF</div>
              <input value={formP.cidade_estado||''} onChange={e=>setFormP({...formP,cidade_estado:e.target.value})} placeholder="São Miguel do Oeste/SC" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>ENDEREÇO</div>
              <input value={formP.endereco||''} onChange={e=>setFormP({...formP,endereco:e.target.value})} style={inp}/>
            </div>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>OBSERVAÇÕES</div>
              <input value={formP.observacao||''} onChange={e=>setFormP({...formP,observacao:e.target.value})} style={inp}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={savePessoa} disabled={saving} style={{padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',background:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg}}>💾 Salvar</button>
            <button onClick={()=>{setShowForm(false);setEditId(null)}} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        {filteredPessoas.length===0?<div style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>{tab==='clientes'?'👥':'🏭'}</div><div style={{fontSize:13,color:C.gold}}>Nenhum cadastro</div></div>:
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:700}}>
          <thead><tr style={{borderBottom:`2px solid ${C.gold}40`}}>
            {['Nome','CNPJ/CPF','Telefone','E-mail','Cidade','Ações'].map(h=>
              <th key={h} style={{padding:'10px 8px',textAlign:h==='Ações'?'right':'left',color:C.gold,fontSize:9,fontWeight:600}}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {filteredPessoas.map(p=>(
              <tr key={p.id} style={{borderBottom:`0.5px solid ${C.border}30`}}
                onMouseEnter={e=>e.currentTarget.style.background=C.card2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{padding:8}}><div style={{fontWeight:600}}>{p.nome_fantasia}</div>{p.razao_social&&<div style={{fontSize:9,color:C.dim}}>{p.razao_social}</div>}</td>
                <td style={{padding:8,color:C.muted}}>{p.cnpj_cpf||'—'}</td>
                <td style={{padding:8,color:C.muted}}>{p.telefone||'—'}</td>
                <td style={{padding:8,color:C.blue}}>{p.email||'—'}</td>
                <td style={{padding:8,color:C.muted}}>{p.cidade_estado||'—'}</td>
                <td style={{padding:8,textAlign:'right'}}>
                  <button onClick={()=>{setFormP({...p});setEditId(p.id||null);setShowForm(true)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.blue+'15',border:`1px solid ${C.blue}30`,color:C.blue,cursor:'pointer',marginRight:4}}>✏️</button>
                  <button onClick={()=>deletePessoa(p.id!)} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.red+'15',border:`1px solid ${C.red}30`,color:C.red,cursor:'pointer'}}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </>)}

    {/* CONTAS BANCÁRIAS */}
    {tab==='bancarias'&&(<>
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{setEditId(null);setFormCB(emptyCB);setShowForm(!showForm)}} style={{
          padding:'10px 18px',borderRadius:8,fontWeight:700,fontSize:12,cursor:'pointer',border:'none',
          background:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg
        }}>+ Nova Conta Bancária</button>
        <div style={{fontSize:11,color:C.dim}}>{contasBancarias.length} contas</div>
      </div>

      {showForm&&(
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:14,border:`1px solid ${C.gold}40`}}>
          <div style={{fontSize:14,fontWeight:700,color:C.gold,marginBottom:12}}>{editId?'Editar':'Nova'} Conta Bancária</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>NOME *</div>
              <input value={formCB.nome} onChange={e=>setFormCB({...formCB,nome:e.target.value})} placeholder="Ex: Conta Principal Sicoob" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>BANCO</div>
              <input value={formCB.banco||''} onChange={e=>setFormCB({...formCB,banco:e.target.value})} placeholder="Sicoob, BB, Itaú..." style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>TIPO</div>
              <select value={formCB.tipo||'corrente'} onChange={e=>setFormCB({...formCB,tipo:e.target.value})} style={{...inp,cursor:'pointer'}}>
                <option value="corrente">Conta Corrente</option>
                <option value="poupanca">Poupança</option>
                <option value="aplicacao">Aplicação</option>
                <option value="caixa">Caixa</option>
                <option value="cartao">Cartão</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>AGÊNCIA</div>
              <input value={formCB.agencia||''} onChange={e=>setFormCB({...formCB,agencia:e.target.value})} style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CONTA</div>
              <input value={formCB.conta||''} onChange={e=>setFormCB({...formCB,conta:e.target.value})} style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>SALDO INICIAL (R$)</div>
              <input type="number" step="0.01" value={formCB.saldo_inicial||''} onChange={e=>setFormCB({...formCB,saldo_inicial:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={saveContaBancaria} disabled={saving} style={{padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',background:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg}}>💾 Salvar</button>
            <button onClick={()=>{setShowForm(false);setEditId(null)}} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        {contasBancarias.length===0?<div style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>🏦</div><div style={{fontSize:13,color:C.gold}}>Nenhuma conta bancária</div><div style={{fontSize:11,color:C.muted,marginTop:4}}>Cadastre suas contas bancárias, aplicações e caixa</div></div>:
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead><tr style={{borderBottom:`2px solid ${C.gold}40`}}>
            {['Nome','Banco','Agência','Conta','Tipo','Saldo Inicial','Ações'].map(h=>
              <th key={h} style={{padding:'10px 8px',textAlign:h==='Saldo Inicial'||h==='Ações'?'right':'left',color:C.gold,fontSize:9,fontWeight:600}}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {contasBancarias.map(cb=>(
              <tr key={cb.id} style={{borderBottom:`0.5px solid ${C.border}30`}}>
                <td style={{padding:8,fontWeight:600}}>{cb.nome}</td>
                <td style={{padding:8,color:C.muted}}>{cb.banco||'—'}</td>
                <td style={{padding:8,color:C.muted}}>{cb.agencia||'—'}</td>
                <td style={{padding:8,color:C.muted}}>{cb.conta||'—'}</td>
                <td style={{padding:8}}><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:C.gold+'15',color:C.gold}}>{cb.tipo}</span></td>
                <td style={{padding:8,textAlign:'right',fontWeight:600,color:C.green}}>{fmtVal(cb.saldo_inicial||0)}</td>
                <td style={{padding:8,textAlign:'right'}}>
                  <button onClick={()=>{setFormCB({...cb});setEditId(cb.id||null);setShowForm(true)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.blue+'15',border:`1px solid ${C.blue}30`,color:C.blue,cursor:'pointer',marginRight:4}}>✏️</button>
                  <button onClick={async()=>{if(!confirm('Excluir?'))return;await supabase.from('erp_contas_bancarias').update({ativo:false}).eq('id',cb.id);await loadAll();setMsg('✅ Excluída');setTimeout(()=>setMsg(''),3000)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.red+'15',border:`1px solid ${C.red}30`,color:C.red,cursor:'pointer'}}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </>)}

    {/* PLANO DE CONTAS */}
    {tab==='plano'&&(<>
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{setEditPC(null);setFormPC({codigo:'',descricao:'',grupo:'despesa',tipo:'despesa',pai_codigo:'',nivel:3});setShowFormPC(!showFormPC)}} style={{
          padding:'10px 18px',borderRadius:8,fontWeight:700,fontSize:12,cursor:'pointer',border:'none',
          background:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg
        }}>+ Nova Categoria</button>
        <input value={filtro} onChange={e=>setFiltro(e.target.value)} placeholder="🔍 Buscar por código ou nome..." style={{...inp,flex:1,minWidth:180}}/>
        <div style={{fontSize:11,color:C.dim}}>{plano.length} categorias</div>
      </div>

      {showFormPC&&(
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:14,border:`1px solid ${C.gold}40`}}>
          <div style={{fontSize:14,fontWeight:700,color:C.gold,marginBottom:12}}>{editPC?'Editar':'Nova'} Categoria</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
            <div>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>CÓDIGO *</div>
              <input value={formPC.codigo} onChange={e=>setFormPC({...formPC,codigo:e.target.value})} placeholder="Ex: 3.01.14" style={inp}/>
            </div>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>DESCRIÇÃO *</div>
              <input value={formPC.descricao} onChange={e=>setFormPC({...formPC,descricao:e.target.value})} style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>TIPO</div>
              <select value={formPC.tipo} onChange={e=>setFormPC({...formPC,tipo:e.target.value,grupo:e.target.value})} style={{...inp,cursor:'pointer'}}>
                <option value="receita">Receita</option>
                <option value="custo">Custo</option>
                <option value="despesa">Despesa</option>
                <option value="financeiro">Financeiro</option>
                <option value="investimento">Investimento</option>
              </select>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={async()=>{
              if(!formPC.codigo||!formPC.descricao){setMsg('❌ Obrigatórios');return}
              setSaving(true)
              const nivel=formPC.codigo.split('.').length
              const record={company_id:sel,codigo:formPC.codigo,descricao:formPC.descricao,grupo:formPC.grupo,tipo:formPC.tipo,nivel}
              let err:any
              if(editPC){const r=await supabase.from('erp_plano_contas').update(record).eq('id',editPC);err=r.error}
              else{const r=await supabase.from('erp_plano_contas').insert(record);err=r.error}
              if(err)setMsg('❌ '+err.message)
              else{setMsg('✅ Salva!');setShowFormPC(false);await loadAll()}
              setSaving(false);setTimeout(()=>setMsg(''),3000)
            }} style={{padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',background:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg}}>💾 Salvar</button>
            <button onClick={()=>setShowFormPC(false)} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead><tr style={{borderBottom:`2px solid ${C.gold}40`}}>
            {['Código','Descrição','Tipo','Escopo','Ações'].map(h=>
              <th key={h} style={{padding:'10px 8px',textAlign:h==='Ações'?'right':'left',color:C.gold,fontSize:9,fontWeight:600}}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {plano.filter(p=>!filtro||(p.codigo+p.descricao).toLowerCase().includes(filtro.toLowerCase())).map(p=>{
              const isN1=p.nivel===1,isN2=p.nivel===2
              const tipoCor:Record<string,string>={receita:C.green,custo:C.yellow,despesa:C.red,financeiro:C.blue,investimento:C.purple}
              return(
                <tr key={p.id} style={{borderBottom:`0.5px solid ${C.border}30`,background:isN1?C.gold+'08':isN2?C.card2:'transparent'}}>
                  <td style={{padding:8,fontWeight:isN1?700:isN2?600:400,color:isN1?C.gold:C.text}}>{p.codigo}</td>
                  <td style={{padding:'8px',paddingLeft:isN1?8:isN2?20:36,fontWeight:isN1?700:isN2?600:400,color:isN1?C.gold:isN2?C.goldL:C.text}}>{p.descricao}</td>
                  <td style={{padding:8}}><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:(tipoCor[p.tipo]||C.dim)+'18',color:tipoCor[p.tipo]||C.dim}}>{p.tipo}</span></td>
                  <td style={{padding:8}}><span style={{fontSize:8,padding:'2px 6px',borderRadius:4,background:p.company_id?C.blue+'18':C.green+'18',color:p.company_id?C.blue:C.green}}>{p.company_id?'Empresa':'Global'}</span></td>
                  <td style={{padding:8,textAlign:'right'}}>
                    {p.company_id?<>
                      <button onClick={()=>{setFormPC({codigo:p.codigo,descricao:p.descricao,grupo:p.grupo,tipo:p.tipo,pai_codigo:p.pai_codigo||'',nivel:p.nivel});setEditPC(p.id);setShowFormPC(true)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.blue+'15',border:`1px solid ${C.blue}30`,color:C.blue,cursor:'pointer',marginRight:4}}>✏️</button>
                      <button onClick={async()=>{if(!confirm('Excluir?'))return;await supabase.from('erp_plano_contas').delete().eq('id',p.id);setMsg('✅');await loadAll();setTimeout(()=>setMsg(''),3000)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.red+'15',border:`1px solid ${C.red}30`,color:C.red,cursor:'pointer'}}>🗑</button>
                    </>:<span style={{fontSize:8,color:C.dim}}>padrão</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>)}

    <div style={{fontSize:9,color:C.dim,textAlign:'center',marginTop:16}}>
      PS Gestão e Capital — Operacional v9.0 | Date pickers · Parcelas · Formas de pagamento · Contas bancárias · Juros/Multa/Desconto · Integração Dashboard + BPO + Custeio
    </div>
  </div>)
}
