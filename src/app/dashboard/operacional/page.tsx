'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C={bg:'#0F0F0F',card:'#1A1410',card2:'#1E1E1B',border:'#2A2822',gold:'#C8941A',goldL:'#E8C872',text:'#FAF7F2',muted:'#B0AB9F',dim:'#918C82',green:'#22C55E',red:'#EF4444',blue:'#3B82F6',yellow:'#F59E0B',purple:'#8B5CF6'}
const STATUS_COLORS:Record<string,string>={PAGO:C.green,RECEBIDO:C.green,'A VENCER':C.yellow,VENCIDO:C.red,CANCELADO:C.dim}
const fmtVal=(v:number)=>`R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2})}`
const today=()=>{const d=new Date();return`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`}

type Pessoa = {id?:string;nome_fantasia:string;razao_social?:string;cnpj_cpf?:string;telefone?:string;email?:string;cidade_estado?:string;endereco?:string;observacao?:string;ativo?:boolean}
type Lanc = {id?:string;tipo:string;nome_pessoa?:string;cliente_id?:string;fornecedor_id?:string;data_emissao?:string;data_vencimento:string;data_previsao?:string;data_pagamento?:string;valor_documento:number;status:string;categoria?:string;subcategoria?:string;numero_documento?:string;descricao?:string;parcela_atual?:number;total_parcelas?:number}

export default function OperacionalPage(){
  const [empresas,setEmpresas]=useState<any[]>([])
  const [sel,setSel]=useState('')
  const [tab,setTab]=useState<'receber'|'pagar'|'clientes'|'fornecedores'>('receber')
  const [loading,setLoading]=useState(true)
  const [msg,setMsg]=useState('')

  // Data
  const [lancs,setLancs]=useState<Lanc[]>([])
  const [clientes,setClientes]=useState<Pessoa[]>([])
  const [fornecedores,setFornecedores]=useState<Pessoa[]>([])

  // Forms
  const [showForm,setShowForm]=useState(false)
  const [saving,setSaving]=useState(false)
  const [editId,setEditId]=useState<string|null>(null)
  const [filtro,setFiltro]=useState('')
  const [filtroStatus,setFiltroStatus]=useState('')

  // Lancamento form
  const emptyLanc:Lanc={tipo:'receber',data_emissao:today(),data_vencimento:today(),data_previsao:today(),valor_documento:0,status:'A VENCER',nome_pessoa:'',categoria:'',descricao:'',numero_documento:''}
  const [formL,setFormL]=useState<Lanc>(emptyLanc)

  // Pessoa form
  const emptyPessoa:Pessoa={nome_fantasia:'',razao_social:'',cnpj_cpf:'',telefone:'',email:'',cidade_estado:'',endereco:'',observacao:''}
  const [formP,setFormP]=useState<Pessoa>(emptyPessoa)

  // Suggestions
  const [suggestions,setSuggestions]=useState<Pessoa[]>([])
  const [showSugg,setShowSugg]=useState(false)

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
    // Lancamentos
    const{data:ld}=await supabase.from('erp_lancamentos').select('*').eq('company_id',sel).order('data_vencimento',{ascending:false})
    setLancs((ld||[]).map((r:any)=>({id:r.id,tipo:r.tipo,nome_pessoa:r.nome_pessoa,cliente_id:r.cliente_id,fornecedor_id:r.fornecedor_id,data_emissao:r.data_emissao,data_vencimento:r.data_vencimento,data_previsao:r.data_previsao,data_pagamento:r.data_pagamento,valor_documento:Number(r.valor_documento),status:r.status,categoria:r.categoria,subcategoria:r.subcategoria,numero_documento:r.numero_documento,descricao:r.descricao,parcela_atual:r.parcela_atual,total_parcelas:r.total_parcelas})))
    // Clientes
    const{data:cd}=await supabase.from('erp_clientes').select('*').eq('company_id',sel).eq('ativo',true).order('nome_fantasia')
    setClientes(cd||[])
    // Fornecedores
    const{data:fd}=await supabase.from('erp_fornecedores').select('*').eq('company_id',sel).eq('ativo',true).order('nome_fantasia')
    setFornecedores(fd||[])
    setLoading(false)
  },[sel])

  useEffect(()=>{loadAll()},[loadAll])

  // ═══ SAVE LANCAMENTO ═══
  const saveLanc=async()=>{
    if(formL.valor_documento<=0||!formL.data_vencimento){setMsg('❌ Preencha valor e data de vencimento');return}
    setSaving(true)
    const tipo=tab==='pagar'?'pagar':'receber'
    const catParts=(formL.categoria||'').split(' > ')
    const record:any={
      company_id:sel, tipo,
      nome_pessoa:formL.nome_pessoa||'',
      cliente_id:tipo==='receber'&&formL.cliente_id?formL.cliente_id:null,
      fornecedor_id:tipo==='pagar'&&formL.fornecedor_id?formL.fornecedor_id:null,
      data_emissao:formL.data_emissao||formL.data_vencimento,
      data_vencimento:formL.data_vencimento,
      data_previsao:formL.data_previsao||formL.data_vencimento,
      data_pagamento:(formL.status==='PAGO'||formL.status==='RECEBIDO')?formL.data_pagamento||null:null,
      valor_documento:formL.valor_documento,
      status:formL.status,
      categoria:catParts[0]?.trim()||'',
      subcategoria:catParts[1]?.trim()||'',
      numero_documento:formL.numero_documento||'',
      descricao:formL.descricao||'',
      parcela_atual:formL.parcela_atual||null,
      total_parcelas:formL.total_parcelas||null,
    }

    let error:any=null
    if(editId){
      const res=await supabase.from('erp_lancamentos').update({...record,updated_at:new Date().toISOString()}).eq('id',editId)
      error=res.error
    }else{
      const res=await supabase.from('erp_lancamentos').insert(record)
      error=res.error
    }

    if(error){setMsg('❌ Erro: '+error.message)}
    else{
      setMsg(editId?'✅ Lançamento atualizado!':'✅ Lançamento cadastrado!')
      // Sync to omie_imports for dashboard compatibility
      await syncToOmie(record, tipo)
      setShowForm(false);setEditId(null);setFormL({...emptyLanc,tipo});await loadAll()
    }
    setSaving(false);setTimeout(()=>setMsg(''),3000)
  }

  // Sync individual record to omie_imports
  const syncToOmie=async(record:any,tipo:string)=>{
    const importType=tipo==='pagar'?'contas_pagar':'contas_receber'
    const key=tipo==='pagar'?'conta_pagar_cadastro':'conta_receber_cadastro'
    const reg:any={
      data_emissao:record.data_emissao,data_vencimento:record.data_vencimento,
      data_previsao:record.data_previsao,status_titulo:record.status,
      valor_documento:record.valor_documento,numero_documento:record.numero_documento,
      observacao:record.descricao,codigo_categoria:record.categoria,
      descricao_categoria:record.subcategoria||record.categoria,
    }
    if(tipo==='pagar'){reg.nome_fornecedor=record.nome_pessoa;if(record.data_pagamento){reg.data_pagamento=record.data_pagamento;reg.data_baixa=record.data_pagamento}}
    else{reg.nome_cliente=record.nome_pessoa;if(record.data_pagamento){reg.data_pagamento=record.data_pagamento;reg.data_baixa=record.data_pagamento}}
    await supabase.from('omie_imports').insert({company_id:sel,import_type:importType,import_data:{[key]:[reg],manual_id:'erp_'+Date.now()},record_count:1})
  }

  // ═══ DELETE LANCAMENTO ═══
  const deleteLanc=async(id:string)=>{
    if(!confirm('Excluir este lançamento?'))return
    const{error}=await supabase.from('erp_lancamentos').delete().eq('id',id)
    if(error)setMsg('❌ '+error.message)
    else{setMsg('✅ Excluído');await loadAll()}
    setTimeout(()=>setMsg(''),3000)
  }

  // ═══ SAVE PESSOA ═══
  const savePessoa=async()=>{
    if(!formP.nome_fantasia.trim()){setMsg('❌ Nome é obrigatório');return}
    setSaving(true)
    const table=tab==='clientes'?'erp_clientes':'erp_fornecedores'
    const record={company_id:sel,...formP,updated_at:new Date().toISOString()}
    let error:any=null
    if(editId){
      const res=await supabase.from(table).update(record).eq('id',editId)
      error=res.error
    }else{
      const res=await supabase.from(table).insert(record)
      error=res.error
    }
    if(error)setMsg('❌ '+error.message)
    else{setMsg(editId?'✅ Atualizado!':'✅ Cadastrado!');setShowForm(false);setEditId(null);setFormP(emptyPessoa);await loadAll()}
    setSaving(false);setTimeout(()=>setMsg(''),3000)
  }

  // ═══ DELETE PESSOA ═══
  const deletePessoa=async(id:string)=>{
    if(!confirm('Excluir este cadastro?'))return
    const table=tab==='clientes'?'erp_clientes':'erp_fornecedores'
    await supabase.from(table).update({ativo:false}).eq('id',id)
    setMsg('✅ Desativado');await loadAll();setTimeout(()=>setMsg(''),3000)
  }

  // ═══ SEARCH SUGGESTIONS ═══
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

  // Filters
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
  const empresaNome=empresas.find(e=>e.id===sel)?.nome_fantasia||empresas.find(e=>e.id===sel)?.razao_social||''

  return(
  <div style={{padding:16,minHeight:'100vh',background:C.bg,color:C.text}}>
    {/* HEADER */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,color:C.gold}}>PS Gestão — Operacional</div>
        <div style={{fontSize:10,color:C.dim}}>Contas a Pagar · Contas a Receber · Clientes · Fornecedores</div>
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
        {id:'receber' as const,label:'📥 Contas a Receber',color:C.green},
        {id:'pagar' as const,label:'📤 Contas a Pagar',color:C.red},
        {id:'clientes' as const,label:'👥 Clientes',color:C.blue},
        {id:'fornecedores' as const,label:'🏭 Fornecedores',color:C.purple},
      ]).map(t=>(
        <button key={t.id} onClick={()=>{setTab(t.id);setShowForm(false);setEditId(null);setFiltro('');setFiltroStatus('')}} style={{
          padding:'10px 18px',borderRadius:8,fontSize:12,fontWeight:tab===t.id?700:400,cursor:'pointer',
          border:tab===t.id?`2px solid ${t.color}`:`1px solid ${C.border}`,
          background:tab===t.id?t.color+'15':'transparent',color:tab===t.id?t.color:C.muted
        }}>{t.label}
          <span style={{marginLeft:6,fontSize:10,opacity:0.7}}>
            {t.id==='receber'?lancs.filter(l=>l.tipo==='receber').length:
             t.id==='pagar'?lancs.filter(l=>l.tipo==='pagar').length:
             t.id==='clientes'?clientes.length:fornecedores.length}
          </span>
        </button>
      ))}
    </div>

    {/* ═══ CONTAS A RECEBER / PAGAR ═══ */}
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

      {/* Toolbar */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{setEditId(null);setFormL({...emptyLanc,tipo:tab==='pagar'?'pagar':'receber'});setShowForm(!showForm)}} style={{
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

      {/* Form */}
      {showForm&&(
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:14,border:`1px solid ${tab==='receber'?C.green:C.red}40`}}>
          <div style={{fontSize:14,fontWeight:700,color:tab==='receber'?C.green:C.red,marginBottom:12}}>
            {editId?'Editar':'Novo'} — {tab==='receber'?'Conta a Receber':'Conta a Pagar'}
            <span style={{fontSize:10,color:C.dim,marginLeft:8}}>{empresaNome}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
            {/* Nome com sugestões */}
            <div style={{gridColumn:'span 2',position:'relative'}}>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>{tab==='receber'?'CLIENTE *':'FORNECEDOR *'}</div>
              <input value={formL.nome_pessoa||''} onChange={e=>searchPessoa(e.target.value)} onFocus={()=>{if(suggestions.length>0)setShowSugg(true)}}
                placeholder={tab==='receber'?'Digite ou selecione o cliente':'Digite ou selecione o fornecedor'} style={inp}/>
              {showSugg&&suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:C.card2,border:`1px solid ${C.gold}`,borderRadius:6,zIndex:10,maxHeight:200,overflowY:'auto'}}>
                  {suggestions.map(p=>(
                    <div key={p.id} onClick={()=>selectPessoa(p)} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:12}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.gold+'15'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{fontWeight:600,color:C.text}}>{p.nome_fantasia}</div>
                      <div style={{fontSize:9,color:C.dim}}>{p.cnpj_cpf||''} {p.cidade_estado?'· '+p.cidade_estado:''}</div>
                    </div>
                  ))}
                  <div onClick={()=>{setShowSugg(false);setTab(tab==='receber'?'clientes':'fornecedores');setShowForm(true);setFormP({...emptyPessoa,nome_fantasia:formL.nome_pessoa||''})}} 
                    style={{padding:'8px 12px',cursor:'pointer',color:C.gold,fontSize:11,fontWeight:600,borderTop:`1px solid ${C.gold}30`}}>
                    + Cadastrar {tab==='receber'?'novo cliente':'novo fornecedor'}
                  </div>
                </div>
              )}
              {formL.nome_pessoa&&formL.nome_pessoa.length>=2&&suggestions.length===0&&(
                <div style={{fontSize:9,color:C.yellow,marginTop:2}}>
                  Não encontrado no cadastro — será salvo como texto livre.
                  <span onClick={()=>{setTab(tab==='receber'?'clientes':'fornecedores');setShowForm(true);setFormP({...emptyPessoa,nome_fantasia:formL.nome_pessoa||''})}}
                    style={{color:C.gold,cursor:'pointer',marginLeft:4,textDecoration:'underline'}}>Cadastrar agora</span>
                </div>
              )}
            </div>

            <div>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>VALOR (R$) *</div>
              <input type="number" step="0.01" value={formL.valor_documento||''} onChange={e=>setFormL({...formL,valor_documento:parseFloat(e.target.value)||0})}
                placeholder="0,00" style={{...inp,fontSize:16,fontWeight:700,color:tab==='receber'?C.green:C.red}}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>DATA EMISSÃO</div>
              <input value={formL.data_emissao||''} onChange={e=>setFormL({...formL,data_emissao:e.target.value})} placeholder="DD/MM/AAAA" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>VENCIMENTO *</div>
              <input value={formL.data_vencimento||''} onChange={e=>setFormL({...formL,data_vencimento:e.target.value,data_previsao:e.target.value})} placeholder="DD/MM/AAAA" style={inp}/>
            </div>
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
              <div>
                <div style={{fontSize:10,color:C.green,marginBottom:3,fontWeight:600}}>DATA PAGAMENTO</div>
                <input value={formL.data_pagamento||''} onChange={e=>setFormL({...formL,data_pagamento:e.target.value})} placeholder="DD/MM/AAAA" style={inp}/>
              </div>
            )}
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CATEGORIA</div>
              <input value={formL.categoria||''} onChange={e=>setFormL({...formL,categoria:e.target.value})} placeholder="Ex: DESPESAS ADM > Aluguel" style={inp}/>
            </div>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>DESCRIÇÃO</div>
              <input value={formL.descricao||''} onChange={e=>setFormL({...formL,descricao:e.target.value})} placeholder="Descrição do lançamento" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Nº DOCUMENTO</div>
              <input value={formL.numero_documento||''} onChange={e=>setFormL({...formL,numero_documento:e.target.value})} placeholder="NF, boleto" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>PARCELAS (ex: 1/3)</div>
              <div style={{display:'flex',gap:4}}>
                <input type="number" value={formL.parcela_atual||''} onChange={e=>setFormL({...formL,parcela_atual:parseInt(e.target.value)||undefined})} placeholder="1" style={{...inp,width:'50%'}}/>
                <span style={{color:C.dim,alignSelf:'center'}}>/</span>
                <input type="number" value={formL.total_parcelas||''} onChange={e=>setFormL({...formL,total_parcelas:parseInt(e.target.value)||undefined})} placeholder="1" style={{...inp,width:'50%'}}/>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={saveLanc} disabled={saving} style={{padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',background:saving?C.border:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg}}>
              {saving?'⏳ Salvando...':'💾 Salvar'}
            </button>
            <button onClick={()=>{setShowForm(false);setEditId(null)}} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* List */}
      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        {loading?<div style={{padding:40,textAlign:'center',color:C.gold}}>⏳ Carregando...</div>:
         filteredLancs.length===0?<div style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>{tab==='receber'?'📥':'📤'}</div><div style={{fontSize:13,color:C.gold}}>Nenhum registro</div><div style={{fontSize:11,color:C.muted,marginTop:4}}>Clique no botão acima para adicionar</div></div>:
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:800}}>
          <thead><tr style={{borderBottom:`2px solid ${C.gold}40`}}>
            {['Status','Vencimento',tab==='receber'?'Cliente':'Fornecedor','Descrição','Categoria','Doc','Valor','Ações'].map(h=>
              <th key={h} style={{padding:'10px 8px',textAlign:h==='Valor'||h==='Ações'?'right':'left',color:C.gold,fontSize:9,fontWeight:600,position:'sticky',top:0,background:C.card}}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {filteredLancs.map(item=>(
              <tr key={item.id} style={{borderBottom:`0.5px solid ${C.border}30`}}
                onMouseEnter={e=>e.currentTarget.style.background=C.card2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{padding:8}}><span style={{fontSize:9,padding:'2px 8px',borderRadius:4,fontWeight:600,background:(STATUS_COLORS[item.status]||C.dim)+'18',color:STATUS_COLORS[item.status]||C.dim}}>{item.status}</span></td>
                <td style={{padding:8,fontWeight:500,whiteSpace:'nowrap'}}>{item.data_vencimento}</td>
                <td style={{padding:8,fontWeight:500,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.nome_pessoa||'—'}</td>
                <td style={{padding:8,color:C.muted,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.descricao||'—'}</td>
                <td style={{padding:8,fontSize:9}}>{item.categoria?<span style={{padding:'2px 6px',borderRadius:4,background:C.purple+'15',color:C.purple}}>{item.categoria}{item.subcategoria?' > '+item.subcategoria:''}</span>:'—'}</td>
                <td style={{padding:8,color:C.dim,fontSize:10}}>{item.numero_documento||'—'}</td>
                <td style={{padding:8,textAlign:'right',fontWeight:700,fontSize:13,color:tab==='receber'?C.green:C.red,whiteSpace:'nowrap'}}>{fmtVal(item.valor_documento)}</td>
                <td style={{padding:8,textAlign:'right',whiteSpace:'nowrap'}}>
                  <button onClick={()=>{setFormL({...item});setEditId(item.id||null);setShowForm(true)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.blue+'15',border:`1px solid ${C.blue}30`,color:C.blue,cursor:'pointer',marginRight:4}}>✏️</button>
                  <button onClick={()=>deleteLanc(item.id!)} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.red+'15',border:`1px solid ${C.red}30`,color:C.red,cursor:'pointer'}}>🗑</button>
                </td>
              </tr>
            ))}
            <tr style={{borderTop:`2px solid ${C.gold}`,background:C.gold+'08'}}>
              <td colSpan={6} style={{padding:'10px 8px',fontWeight:700,color:C.gold,fontSize:12}}>TOTAL ({filteredLancs.length})</td>
              <td style={{padding:'10px 8px',textAlign:'right',fontWeight:700,fontSize:15,color:tab==='receber'?C.green:C.red}}>{fmtVal(totalVal)}</td>
              <td/>
            </tr>
          </tbody>
        </table>}
      </div>
    </>)}

    {/* ═══ CLIENTES / FORNECEDORES ═══ */}
    {(tab==='clientes'||tab==='fornecedores')&&(<>
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{setEditId(null);setFormP(emptyPessoa);setShowForm(!showForm)}} style={{
          padding:'10px 18px',borderRadius:8,fontWeight:700,fontSize:12,cursor:'pointer',border:'none',
          background:tab==='clientes'?`linear-gradient(135deg,${C.blue},#2563EB)`:`linear-gradient(135deg,${C.purple},#7C3AED)`,color:C.text
        }}>+ {tab==='clientes'?'Novo Cliente':'Novo Fornecedor'}</button>
        <input value={filtro} onChange={e=>setFiltro(e.target.value)} placeholder="🔍 Buscar por nome..." style={{...inp,flex:1,minWidth:180}}/>
        <div style={{fontSize:11,color:C.dim}}>{filteredPessoas.length} cadastros</div>
      </div>

      {/* Form Pessoa */}
      {showForm&&(
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:14,border:`1px solid ${tab==='clientes'?C.blue:C.purple}40`}}>
          <div style={{fontSize:14,fontWeight:700,color:tab==='clientes'?C.blue:C.purple,marginBottom:12}}>
            {editId?'Editar':'Novo'} — {tab==='clientes'?'Cliente':'Fornecedor'}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10}}>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>NOME FANTASIA *</div>
              <input value={formP.nome_fantasia} onChange={e=>setFormP({...formP,nome_fantasia:e.target.value})} placeholder="Nome comercial" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>RAZÃO SOCIAL</div>
              <input value={formP.razao_social||''} onChange={e=>setFormP({...formP,razao_social:e.target.value})} placeholder="Razão social completa" style={inp}/>
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
              <input value={formP.email||''} onChange={e=>setFormP({...formP,email:e.target.value})} placeholder="contato@empresa.com" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CIDADE / UF</div>
              <input value={formP.cidade_estado||''} onChange={e=>setFormP({...formP,cidade_estado:e.target.value})} placeholder="São Miguel do Oeste/SC" style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>ENDEREÇO</div>
              <input value={formP.endereco||''} onChange={e=>setFormP({...formP,endereco:e.target.value})} placeholder="Rua, número, bairro" style={inp}/>
            </div>
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>OBSERVAÇÕES</div>
              <input value={formP.observacao||''} onChange={e=>setFormP({...formP,observacao:e.target.value})} placeholder="Informações adicionais" style={inp}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={savePessoa} disabled={saving} style={{padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',background:saving?C.border:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg}}>
              {saving?'⏳ Salvando...':'💾 Salvar'}
            </button>
            <button onClick={()=>{setShowForm(false);setEditId(null)}} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* List Pessoas */}
      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        {loading?<div style={{padding:40,textAlign:'center',color:C.gold}}>⏳</div>:
         filteredPessoas.length===0?<div style={{padding:40,textAlign:'center'}}><div style={{fontSize:28,marginBottom:8}}>{tab==='clientes'?'👥':'🏭'}</div><div style={{fontSize:13,color:C.gold}}>Nenhum cadastro</div><div style={{fontSize:11,color:C.muted,marginTop:4}}>Clique no botão acima para cadastrar</div></div>:
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:700}}>
          <thead><tr style={{borderBottom:`2px solid ${C.gold}40`}}>
            {['Nome','CNPJ/CPF','Telefone','E-mail','Cidade','Ações'].map(h=>
              <th key={h} style={{padding:'10px 8px',textAlign:h==='Ações'?'right':'left',color:C.gold,fontSize:9,fontWeight:600,position:'sticky',top:0,background:C.card}}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {filteredPessoas.map(p=>(
              <tr key={p.id} style={{borderBottom:`0.5px solid ${C.border}30`}}
                onMouseEnter={e=>e.currentTarget.style.background=C.card2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{padding:8}}>
                  <div style={{fontWeight:600,color:C.text}}>{p.nome_fantasia}</div>
                  {p.razao_social&&<div style={{fontSize:9,color:C.dim}}>{p.razao_social}</div>}
                </td>
                <td style={{padding:8,color:C.muted,fontSize:11}}>{p.cnpj_cpf||'—'}</td>
                <td style={{padding:8,color:C.muted,fontSize:11}}>{p.telefone||'—'}</td>
                <td style={{padding:8,color:C.blue,fontSize:11}}>{p.email||'—'}</td>
                <td style={{padding:8,color:C.muted,fontSize:11}}>{p.cidade_estado||'—'}</td>
                <td style={{padding:8,textAlign:'right',whiteSpace:'nowrap'}}>
                  <button onClick={()=>{setFormP({...p});setEditId(p.id||null);setShowForm(true)}} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.blue+'15',border:`1px solid ${C.blue}30`,color:C.blue,cursor:'pointer',marginRight:4}}>✏️</button>
                  <button onClick={()=>deletePessoa(p.id!)} style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:C.red+'15',border:`1px solid ${C.red}30`,color:C.red,cursor:'pointer'}}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </>)}

    <div style={{fontSize:9,color:C.dim,textAlign:'center',marginTop:16}}>
      PS Gestão e Capital — Operacional v8.8.0 | Integrado com Dashboard, BPO e Custeio por Absorção
    </div>
  </div>)
}
