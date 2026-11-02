'use client'

// #59 PDOIS parte 2 · "Solicitar elaboração de contrato" (comercial). Dois modos:
//  - "A partir de uma proposta": fn_contrato_solicitar copia cliente/título/valor/escopo da proposta
//    (e a condição de pagamento dela); o que for preenchido aqui prevalece;
//  - "Com dados novos": cliente (cadastro rápido) + título + código + valor.
// CEO (reunião Pdois 14/10) · "Comunicação P&M ↔ Financeiro nos contratos": ao abrir a partir de uma proposta, o modal
//  PREENCHE automaticamente os campos com os dados reais (editáveis) — cliente, CPF/CNPJ, contato, objeto, serviços
//  (itens com qtd e valor), valor por parcela, condição e periodicidade — marcando "veio da proposta"/"do cadastro",
//  para o usuário ver o que será enviado. Proposta sem cliente: avisa e exige escolher/cadastrar. Só deixa solicitar de
//  proposta APROVADA. Obrigatórios para o financeiro: cliente, CPF/CNPJ, objeto, valor, periodicidade. "?" em todo campo (RD-95).
// Cria o contrato em status 'solicitado' e dispara o aviso ao responsável (fn_contrato_solicitar). Depois de criado,
// o comercial pode anexar modelos/prints de referência (tipo 'outro' — não conta como contrato assinado).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import ClientePickerInline from './ClientePickerInline'
import ContratoArquivos from './ContratoArquivos'
import { FORMAS_PAGAMENTO, PERIODICIDADES_CONTRATO, TIPOS_REAJUSTE_CONTRATO, gradeContrato } from './contratoOpcoes'

const ROTA = '/dashboard/pm/propostas'
const C = { espresso: '#3D2314', espressoM: '#6B5D4F', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', red: '#A32D2D', redBg: '#FCEBEB', green: '#1E7A46', greenBg: '#EAF6EE', amber: '#8A6A1E', amberBg: '#FBF4E6' }
const inp: React.CSSProperties = { width: '100%', minHeight: 38, padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.espresso, outline: 'none', boxSizing: 'border-box' }

export interface SolicitarResultado { contrato_id: string; numero: string; responsavel_id: string | null; aviso: string | null }

interface Props {
  companyId: string
  propostaId?: string | null
  propostaLabel?: string | null      // rótulo p/ mostrar de qual proposta veio
  propostaStatus?: string | null     // status da proposta (gate: só 'aprovada' pode solicitar)
  clienteId?: string | null          // prefill (aberto do cliente/lead)
  onClose: () => void
  onSolicitado?: (r: SolicitarResultado) => void
}

interface ClienteInfo { id: string | null; nome: string; doc: string; email: string; telefone: string; endereco: string }

// "1.500,50" e "1500.50" → 1500.5
const num = (s: string) => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// prazo sugerido: 5 dias úteis a partir de hoje (pula sáb/dom)
function prazoSugerido(): string {
  const d = new Date(); let u = 0
  while (u < 5) { d.setDate(d.getDate() + 1); const dia = d.getDay(); if (dia !== 0 && dia !== 6) u++ }
  return d.toISOString().slice(0, 10)
}

export default function SolicitarContratoModal({ companyId, propostaId, propostaLabel, propostaStatus, clienteId, onClose, onSolicitado }: Props) {
  const [modo, setModo] = useState<'proposta' | 'manual'>(propostaId ? 'proposta' : 'manual')
  const [cli, setCli] = useState(clienteId ?? '')
  const [titulo, setTitulo] = useState('')
  const [valorMensal, setValorMensal] = useState('')
  // #59 · identificação e objeto
  const [doc, setDoc] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [objeto, setObjeto] = useState('')
  const [escopo, setEscopo] = useState('')
  // #59 · pagamento
  const [forma, setForma] = useState('boleto')
  const [condicao, setCondicao] = useState('')
  const [nParcelas, setNParcelas] = useState('')
  const [periodicidade, setPeriodicidade] = useState('mensal')
  const [diaVenc, setDiaVenc] = useState('')
  const [primeiroVenc, setPrimeiroVenc] = useState('')
  // #59 · vigência e condições
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [reajuste, setReajuste] = useState('nenhum')
  const [reajustePct, setReajustePct] = useState('')
  const [especificas, setEspecificas] = useState('')
  const [prazo, setPrazo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [criado, setCriado] = useState<SolicitarResultado | null>(null)
  // CEO 14/10 · dados reais da proposta/cadastro (preenchidos ao abrir)
  const [status, setStatus] = useState<string | null>(propostaStatus ?? null)
  const [cliInfo, setCliInfo] = useState<ClienteInfo | null>(null)
  const [semCliente, setSemCliente] = useState(false)
  const [prefilled, setPrefilled] = useState(false)

  // Preenche a partir da proposta + cadastro do cliente (fonte da verdade do que será enviado).
  useEffect(() => {
    if (!propostaId) { setPrefilled(true); return }
    let vivo = true
    void (async () => {
      const { data: p } = await supabase.from('agency_propostas')
        .select('titulo, descricao, condicao_pagamento, valor_final, valor_total, erp_cliente_id, cliente_id, status, numero')
        .eq('id', propostaId).maybeSingle()
      if (!vivo || !p) { setPrefilled(true); return }
      const prop = p as { titulo?: string | null; descricao?: string | null; condicao_pagamento?: string | null; valor_final?: number | null; valor_total?: number | null; erp_cliente_id?: string | null; cliente_id?: string | null; status?: string | null; numero?: string | null }
      setStatus(prop.status ?? propostaStatus ?? null)

      // itens da proposta → escopo (• desc (qtd x R$ unit)) + valor somado
      const { data: itensRaw } = await supabase.from('agency_proposta_itens')
        .select('descricao, quantidade, valor_unitario, valor_total, ordem, excluido_em')
        .eq('proposta_id', propostaId).order('ordem')
      const itens = ((itensRaw ?? []) as Array<{ descricao: string | null; quantidade: number | null; valor_unitario: number | null; valor_total: number | null; excluido_em: string | null }>).filter((i) => !i.excluido_em)
      const escopoTxt = itens.map((i) => `• ${i.descricao ?? 'item'} (${i.quantidade ?? 1} x R$ ${brl(Number(i.valor_unitario) || 0)})`).join('\n')
      const somaItens = itens.reduce((s, i) => s + (Number(i.valor_total) || 0), 0)
      const valorBase = somaItens > 0 ? somaItens : (Number(prop.valor_final) || Number(prop.valor_total) || 0)

      // cliente: erp_clientes (erp_cliente_id) → agency_clientes (cliente_id) → sem cliente
      let info: ClienteInfo | null = null
      if (prop.erp_cliente_id) {
        const { data: ec } = await supabase.from('erp_clientes')
          .select('razao_social, nome_fantasia, cnpj_cpf, email, telefone, celular, logradouro, numero, bairro, cidade, uf, endereco, contato_operacional')
          .eq('id', prop.erp_cliente_id).maybeSingle()
        if (ec) {
          const e = ec as Record<string, string | null>
          const end = e.endereco || [e.logradouro, e.numero, e.bairro, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : (e.cidade || e.uf)].filter(Boolean).join(', ')
          info = { id: prop.erp_cliente_id, nome: e.nome_fantasia || e.razao_social || '', doc: e.cnpj_cpf || '', email: e.email || '', telefone: e.telefone || e.celular || '', endereco: end }
        }
      } else if (prop.cliente_id) {
        const { data: ac } = await supabase.from('agency_clientes')
          .select('nome_fantasia, nome, cnpj_cpf, email, telefone').eq('id', prop.cliente_id).maybeSingle()
        if (ac) {
          const a = ac as Record<string, string | null>
          info = { id: null, nome: a.nome_fantasia || a.nome || '', doc: a.cnpj_cpf || '', email: a.email || '', telefone: a.telefone || '', endereco: '' }
        }
      }
      if (!vivo) return
      setCliInfo(info)
      setSemCliente(!info || !info.nome)
      // prefill (só se o campo ainda está vazio, para não apagar edição do usuário)
      setTitulo((v) => v || (prop.titulo ?? ''))
      setObjeto((v) => v || (prop.descricao ?? ''))
      setEscopo((v) => v || escopoTxt)
      setValorMensal((v) => v || (valorBase ? brl(valorBase) : ''))
      setCondicao((v) => v || (prop.condicao_pagamento ?? ''))
      setDoc((v) => v || (info?.doc ?? ''))
      setResponsavel((v) => v) // contato do cadastro não existe em agency_clientes; vem do erp quando houver
      if (info && 'id' in info) { /* contato vem abaixo */ }
      setPrazo((v) => v || prazoSugerido())
      setPrefilled(true)
    })()
    return () => { vivo = false }
  }, [propostaId, propostaStatus])

  // contato operacional do cadastro ERP → responsável (quando houver)
  useEffect(() => {
    if (!propostaId || !cliInfo?.id) return
    let vivo = true
    void supabase.from('erp_clientes').select('contato_operacional').eq('id', cliInfo.id).maybeSingle()
      .then(({ data }) => { const c = (data as { contato_operacional?: string | null } | null)?.contato_operacional; if (vivo && c) setResponsavel((v) => v || c) })
    return () => { vivo = false }
  }, [propostaId, cliInfo?.id])

  const aprovada = modo !== 'proposta' || status === 'aprovada'
  const chip = (txt: string, cor: string, bg: string) => <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: bg, padding: '1px 6px', borderRadius: 999, marginLeft: 6 }}>{txt}</span>
  const daProposta = modo === 'proposta' ? chip('da proposta', C.amber, C.amberBg) : null
  const doCadastro = modo === 'proposta' && cliInfo ? chip('do cadastro', C.green, C.greenBg) : null

  // escolher cliente para proposta sem vínculo: puxa nome/doc do cadastro p/ enviar como identidade do contrato
  async function escolherCliente(id: string) {
    const { data } = await supabase.from('erp_clientes').select('razao_social, nome_fantasia, cnpj_cpf, email, telefone, celular, logradouro, numero, bairro, cidade, uf, endereco, contato_operacional').eq('id', id).maybeSingle()
    const e = (data ?? {}) as Record<string, string | null>
    const end = e.endereco || [e.logradouro, e.numero, e.bairro, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : (e.cidade || e.uf)].filter(Boolean).join(', ')
    setCliInfo({ id, nome: e.nome_fantasia || e.razao_social || '', doc: e.cnpj_cpf || '', email: e.email || '', telefone: e.telefone || e.celular || '', endereco: end })
    setSemCliente(false)
    setDoc((v) => v || e.cnpj_cpf || '')
    if (e.contato_operacional) setResponsavel((v) => v || e.contato_operacional || '')
  }

  async function solicitar() {
    setErro(null)
    if (modo === 'proposta' && !aprovada) { setErro('Só dá para solicitar o contrato de uma proposta APROVADA. Aprove a proposta primeiro.'); return }
    if (modo === 'proposta' && !propostaId) { setErro('Proposta não informada.'); return }
    // Obrigatórios para enviar ao financeiro (CEO 14/10): cliente, CPF/CNPJ, objeto, valor, periodicidade.
    const temCliente = modo === 'proposta' ? !!(cliInfo && cliInfo.nome) : !!cli
    if (!temCliente) { setErro('Esta proposta não tem cliente — escolha ou cadastre um cliente antes de pedir o contrato.'); return }
    if (!doc.trim()) { setErro('Informe o CPF/CNPJ do cliente.'); return }
    if (!objeto.trim()) { setErro('Informe o objeto do contrato (o que está sendo contratado).'); return }
    if (num(valorMensal) == null || (num(valorMensal) ?? 0) <= 0) { setErro('Informe o valor (por parcela).'); return }
    if (!periodicidade) { setErro('Escolha a periodicidade.'); return }
    const dia = diaVenc ? Number(diaVenc) : null
    if (dia != null && (!Number.isInteger(dia) || dia < 1 || dia > 28)) { setErro('Dia de vencimento: de 1 a 28.'); return }
    if (inicio && fim && fim < inicio) { setErro('O fim da vigência não pode ser antes do início.'); return }
    const dados: Record<string, unknown> = {
      cliente_cnpj: doc.trim() || null,
      responsavel: responsavel.trim() || null,
      objeto: objeto.trim() || null,
      escopo: escopo.trim() || null,
      forma_pagamento: forma || null,
      condicao_pagamento: condicao.trim() || null,
      numero_parcelas: nParcelas ? Number(nParcelas) : null,
      periodicidade: periodicidade || null,
      dia_vencimento: dia,
      data_primeiro_vencimento: primeiroVenc || null,
      data_inicio: inicio || null,
      data_fim: fim || null,
      tipo_reajuste: reajuste || null,
      reajuste_percentual: reajuste !== 'nenhum' ? num(reajustePct) : null,
      condicoes_especificas: especificas.trim() || null,
      titulo: titulo.trim() || null,
      valor_mensal: num(valorMensal),
    }
    if (modo === 'proposta' && cliInfo?.nome) dados.cliente_nome = cliInfo.nome   // identidade do cliente escolhido/vinculado
    if (modo === 'manual') {
      dados.cliente_id = cli || null
    }
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc('fn_contrato_solicitar', {
        p_company_id: companyId,
        p_proposta_id: modo === 'proposta' ? propostaId : null,
        p_prazo_desejado: prazo || null,
        p_observacoes: obs.trim() || null,
        p_dados: dados,
      })
      setSalvando(false)
      if (error) { setErro(error.message); return }
      const r = data as { ok?: boolean; erro?: string; contrato_id?: string; numero?: string; responsavel_id?: string | null; aviso?: string | null }
      if (!r?.ok) { setErro(traduz(r?.erro)); return }
      setCriado({ contrato_id: r.contrato_id!, numero: r.numero ?? '', responsavel_id: r.responsavel_id ?? null, aviso: r.aviso ?? null })
    } catch (e) {
      setSalvando(false); setErro(e instanceof Error ? e.message : String(e))
    }
  }

  const concluir = () => { if (criado) onSolicitado?.(criado); else onClose() }

  return (
    <div onClick={criado ? concluir : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Solicitar elaboração de contrato" style={{ background: C.cream, borderRadius: 12, maxWidth: 680, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ background: C.espresso, color: C.cream, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 5 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Solicitar elaboração de contrato</h2>
          <button type="button" onClick={criado ? concluir : onClose} aria-label="Fechar" style={{ background: 'transparent', color: C.cream, border: 'none', fontSize: 22, cursor: 'pointer', width: 28, height: 28, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {erro && <div style={{ background: C.redBg, color: C.red, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{erro}</div>}
          {toast && <div style={{ background: C.greenBg, color: C.green, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{toast}</div>}

          {criado ? (
            <div data-testid="solicitacao-criada">
              <div style={{ background: C.greenBg, color: C.green, padding: '12px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
                Solicitação enviada{criado.numero ? <> — contrato nº <strong>{criado.numero}</strong></> : null}.
                {criado.aviso ? <> {criado.aviso}.</> : null}
              </div>
              <p style={{ fontSize: 13, color: C.espresso, margin: '0 0 8px' }}>
                Tem um modelo de contrato, print ou documento do cliente? Anexe aqui para quem vai elaborar (opcional).
              </p>
              <ContratoArquivos companyId={companyId} contratoId={criado.contrato_id} tipo="outro" titulo="Modelos e documentos de referência" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" onClick={concluir} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Concluir</button>
              </div>
            </div>
          ) : (
            <>
              {/* seletor de modo */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#EFEAE1', borderRadius: 8, padding: 4 }}>
                <button type="button" onClick={() => setModo('proposta')} disabled={!propostaId}
                  style={tab(modo === 'proposta', !propostaId)}>A partir de uma proposta</button>
                <button type="button" onClick={() => setModo('manual')} style={tab(modo === 'manual', false)}>Com dados novos</button>
              </div>

              {/* gate: proposta não aprovada */}
              {modo === 'proposta' && prefilled && !aprovada && (
                <div style={{ background: C.amberBg, color: C.amber, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
                  Esta proposta está em <strong>{rotuloStatus(status)}</strong>. Só dá para solicitar o contrato de uma proposta
                  <strong> aprovada</strong> — aprove a proposta primeiro (botão “Aprovar” na proposta) e depois peça o contrato.
                </div>
              )}

              <Secao titulo="Cliente e contrato">
                {modo === 'proposta' ? (
                  <>
                    <div style={{ fontSize: 13, color: C.espresso, lineHeight: 1.6, marginBottom: 12 }}>
                      Os campos abaixo já vêm preenchidos com os dados da proposta
                      {propostaLabel ? <> <strong>{propostaLabel}</strong></> : null} e do cadastro do cliente — confira e ajuste o que precisar.
                    </div>
                    {semCliente ? (
                      <div style={{ background: C.redBg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 13, color: C.red, fontWeight: 700, marginBottom: 8 }}>
                          Esta proposta não tem cliente — escolha ou cadastre antes de pedir o contrato.
                        </div>
                        <ClientePickerInline companyId={companyId} value={cliInfo?.id ?? ''} onChange={(id) => { if (id) void escolherCliente(id) }} onToast={(s) => setToast(s)} />
                      </div>
                    ) : cliInfo ? (
                      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.espresso }}>{cliInfo.nome}{doCadastro}</div>
                        {cliInfo.endereco && <div style={{ fontSize: 12, color: C.espressoM, marginTop: 4 }}>{cliInfo.endereco}</div>}
                        <div style={{ fontSize: 12, color: C.espressoM, marginTop: 2 }}>
                          {cliInfo.email || 'sem e-mail'} · {cliInfo.telefone || 'sem telefone'}
                        </div>
                        <div style={{ fontSize: 11, color: C.espressoM, marginTop: 6 }}>Endereço, e-mail e telefone vêm do cadastro do cliente — edite no cadastro se mudaram.</div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Campo label="Cliente" chave="pm.solicitar_contrato.cliente" ajuda>
                    <ClientePickerInline companyId={companyId} value={cli} onChange={(id) => setCli(id)} onToast={(s) => setToast(s)} />
                  </Campo>
                )}
                <div style={gradeContrato}>
                  <Campo label="CPF/CNPJ do cliente" chave="pm.solicitar_contrato.cpf_cnpj" ajuda>
                    <input style={inp} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Obrigatório" />
                  </Campo>
                  <Campo label="Responsável pelo contrato" chave="pm.solicitar_contrato.responsavel" ajuda>
                    <input style={inp} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Quem assina / contato no cliente" />
                  </Campo>
                </div>
                <Campo label="Título do contrato" chave="pm.solicitar_contrato.titulo" ajuda>
                  <input style={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={modo === 'proposta' ? 'O título da proposta' : 'Ex.: "Fee mensal — assessoria contábil"'} />
                </Campo>
                <Campo label="Objeto do contrato" chave="pm.solicitar_contrato.objeto" ajuda>
                  <textarea style={{ ...inp, minHeight: 56, fontFamily: 'inherit' }} value={objeto} onChange={(e) => setObjeto(e.target.value)} placeholder="O que está sendo contratado" />
                </Campo>
                <Campo label="Serviços / produtos" chave="pm.solicitar_contrato.servicos" ajuda>
                  <textarea style={{ ...inp, minHeight: 56, fontFamily: 'inherit' }} value={escopo} onChange={(e) => setEscopo(e.target.value)} placeholder={modo === 'proposta' ? 'Os itens da proposta' : 'Um por linha'} />
                </Campo>
                <div style={gradeContrato}>
                  <Campo label="Código identificador (automático)" chave="pm.solicitar_contrato.codigo" ajuda>
                    <input style={inp} value="" readOnly disabled placeholder="Gerado automaticamente ao solicitar (ex.: CTR-2026-0001)" />
                  </Campo>
                  <Campo label="Valor (por parcela)" chave="pm.solicitar_contrato.valor" ajuda>
                    <input style={inp} inputMode="decimal" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} placeholder={modo === 'proposta' ? 'Somado dos itens da proposta' : '0,00'} />
                    {modo === 'proposta' && valorMensal ? daProposta : null}
                  </Campo>
                </div>
              </Secao>

              <Secao titulo="Pagamento">
                <div style={gradeContrato}>
                  <Campo label="Forma de pagamento" chave="pm.solicitar_contrato.forma_pagamento" ajuda>
                    <select style={inp} value={forma} onChange={(e) => setForma(e.target.value)}>
                      {FORMAS_PAGAMENTO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Condição de pagamento" chave="pm.solicitar_contrato.condicao_pagamento" ajuda>
                    <input style={inp} value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="Ex.: entrada + 5x, 30/60/90" />
                  </Campo>
                  <Campo label="Nº de parcelas" chave="pm.solicitar_contrato.num_parcelas" ajuda>
                    <input style={inp} type="number" min={1} value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} />
                  </Campo>
                  <Campo label="Periodicidade" chave="pm.solicitar_contrato.periodicidade" ajuda>
                    <select style={inp} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
                      {PERIODICIDADES_CONTRATO.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Dia do vencimento" chave="pm.solicitar_contrato.dia_vencimento" ajuda>
                    <input style={inp} type="number" min={1} max={28} value={diaVenc} onChange={(e) => setDiaVenc(e.target.value)} placeholder="1 a 28" />
                  </Campo>
                  <Campo label="1º vencimento" chave="pm.solicitar_contrato.primeiro_vencimento" ajuda>
                    <input style={inp} type="date" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} />
                  </Campo>
                </div>
              </Secao>

              <Secao titulo="Vigência e condições">
                <div style={gradeContrato}>
                  <Campo label="Início previsto" chave="pm.solicitar_contrato.inicio" ajuda>
                    <input style={inp} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                  </Campo>
                  <Campo label="Fim da vigência" chave="pm.solicitar_contrato.fim" ajuda>
                    <input style={inp} type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
                  </Campo>
                  <Campo label="Reajuste" chave="pm.solicitar_contrato.reajuste" ajuda>
                    <select style={inp} value={reajuste} onChange={(e) => setReajuste(e.target.value)}>
                      {TIPOS_REAJUSTE_CONTRATO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </Campo>
                  <Campo label="% de reajuste" chave="pm.solicitar_contrato.reajuste_pct" ajuda>
                    <input style={inp} inputMode="decimal" value={reajustePct} onChange={(e) => setReajustePct(e.target.value)} disabled={reajuste === 'nenhum'} placeholder="0,00" />
                  </Campo>
                </div>
                <Campo label="Condições específicas" chave="pm.solicitar_contrato.condicoes_especificas" ajuda>
                  <textarea style={{ ...inp, minHeight: 56, fontFamily: 'inherit' }} value={especificas} onChange={(e) => setEspecificas(e.target.value)} placeholder="Multa, fidelidade, garantias, o que foi combinado" />
                </Campo>
                <Campo label="Prazo desejado para o contrato" chave="pm.solicitar_contrato.prazo" ajuda>
                  <input type="date" style={inp} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
                </Campo>
                <Campo label="Observação para quem vai elaborar" chave="pm.solicitar_contrato.observacao" ajuda>
                  <textarea style={{ ...inp, minHeight: 70, fontFamily: 'inherit' }} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contexto, pedidos do cliente, etc." />
                </Campo>
                <div style={{ fontSize: 11, color: C.espressoM, marginTop: -6, marginBottom: 12 }}>
                  Obrigatórios para enviar ao financeiro: cliente, CPF/CNPJ, objeto, valor e periodicidade. O resto o financeiro pode completar.
                </div>
              </Secao>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: C.espresso, border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button type="button" data-testid="solicitar-contrato" onClick={() => void solicitar()} disabled={salvando || (modo === 'proposta' && !aprovada)} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : (modo === 'proposta' && !aprovada) ? 'not-allowed' : 'pointer', opacity: (modo === 'proposta' && !aprovada) ? 0.5 : 1 }}>
                  {salvando ? 'Enviando…' : 'Solicitar elaboração'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function tab(active: boolean, disabled: boolean): React.CSSProperties {
  return { flex: 1, minHeight: 36, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, background: active ? '#FFFFFF' : 'transparent', color: active ? '#3D2314' : '#6B5D4F', boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8, paddingTop: 12, borderTop: '1px solid rgba(61,35,20,0.10)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3D2314', marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
// RD-95: o "?" (AjudaCampo) renderiza ao lado do rótulo quando há `chave`; o atributo `ajuda` marca o campo como coberto
// para o gate check-ajuda-campo-telas-alteradas (que lê o call-site, não o interior deste componente).
function Campo({ label, chave, children }: { label: string; chave?: string; ajuda?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}{chave ? <AjudaCampo chave={chave} rota={ROTA} /> : null}
      </label>
      {children}
    </div>
  )
}
function rotuloStatus(s: string | null): string {
  switch (s) { case 'rascunho': return 'Rascunho'; case 'enviada': return 'Enviada'; case 'recusada': return 'Recusada'; case 'aprovada': return 'Aprovada'; default: return s || 'rascunho' }
}
function traduz(e?: string): string {
  switch (e) {
    case 'company_id_ausente': return 'Empresa não informada.'
    case 'sem_acesso': return 'Você não tem acesso a esta empresa.'
    case 'proposta_nao_encontrada': return 'Proposta não encontrada nesta empresa.'
    case 'cliente_de_outra_empresa': return 'Esse cliente não é desta empresa.'
    case 'dia_vencimento_invalido': return 'Dia de vencimento: de 1 a 28.'
    case 'numero_parcelas_invalido': return 'Nº de parcelas precisa ser pelo menos 1.'
    case 'vigencia_invalida': return 'O fim da vigência não pode ser antes do início.'
    default: return e || 'Não foi possível solicitar o contrato.'
  }
}
