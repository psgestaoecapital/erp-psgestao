'use client'
// OFICINA · RECEPÇÃO DE VEÍCULO (check-in). Mobile-first (o recepcionista/mecânico usa celular).
// Busca por placa → prefill do histórico → cliente/veículo/km/queixa + checklist + FOTOS → cria OS (pátio).
import React, { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Camera, Car, Package, ChevronLeft, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import AssinaturaModal from '@/components/oficina/AssinaturaModal'
import Modal from '@/components/ui/Modal'
import { useOficinaRamo } from '@/lib/oficina/ramo'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'
const BUCKET = 'oficina-recepcao'
const CHECK_ITENS = ['Pneus', 'Estepe', 'Faróis / lanternas', 'Retrovisores', 'Vidros', 'Documentos', 'Tapetes / objetos']
const COMBUSTIVEL = [{ v: 'vazio', l: 'Vazio' }, { v: '1_4', l: '1/4' }, { v: 'meio', l: '1/2' }, { v: '3_4', l: '3/4' }, { v: 'cheio', l: 'Cheio' }]

type Foto = { path: string; legenda: string; url?: string }

// Comprime a foto no celular antes de subir (box com 4G ruim): redimensiona p/ máx 1600px e JPEG 0.7.
async function comprimirImagem(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const MAX = 1600
    let { width, height } = bitmap
    if (width > MAX || height > MAX) {
      const r = Math.min(MAX / width, MAX / height)
      width = Math.round(width * r); height = Math.round(height * r)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.7))
  } catch { return file }
}

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function RecepcaoPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  // RD-41 · ramo dirige a recepção: automotiva = check-in de carro; retífica/usinagem/elétrica = recebimento da peça.
  const { config: ramo } = useOficinaRamo(companyId)
  // OFIC-A (#10) · quando vem do Pátio ("Apontar chegada"), a URL traz o agendamento + prefill.
  // Ao criar a OS (fim do check-in), vinculamos o agendamento (fn_agendamento_vincular_os).
  const [agendamentoId, setAgendamentoId] = useState<string | null>(null)
  const [placa, setPlaca] = useState(''); const [buscando, setBuscando] = useState(false); const [historico, setHistorico] = useState<string | null>(null)
  const [clienteNome, setClienteNome] = useState(''); const [clienteCnpj, setClienteCnpj] = useState(''); const [clienteId, setClienteId] = useState('')
  // RD-41 · busca de cliente por documento (CPF/CNPJ) na base do tenant + cadastro inline (sem sair da recepção).
  const [buscandoDoc, setBuscandoDoc] = useState(false)
  type DocStatus = { tipo: 'cliente' | 'fornecedor' | 'nao_encontrado' | 'sem_plano' | 'erro'; razao?: string; fornecedorId?: string }
  const [docStatus, setDocStatus] = useState<DocStatus | null>(null)
  const [cadAberto, setCadAberto] = useState(false)
  const [cadNome, setCadNome] = useState(''); const [cadTelefone, setCadTelefone] = useState('')
  const [cadEndereco, setCadEndereco] = useState<Record<string, string> | null>(null) // enriquecimento CNPJ (persistido via RPC)
  const [cadEnriq, setCadEnriq] = useState(false); const [cadSalvando, setCadSalvando] = useState(false); const [cadMsg, setCadMsg] = useState<string | null>(null)
  // KGF/Kleiton · busca de cliente por NOME (homônimos → lista pra escolher). Reusa fn_cliente_buscar (Pilar 2).
  type CliOpt = { cliente_id: string; nome: string; cnpj_cpf: string | null; cidade: string | null }
  const [cliNomeOpts, setCliNomeOpts] = useState<CliOpt[]>([])
  const [buscandoNome, setBuscandoNome] = useState(false)
  const [nomeBuscou, setNomeBuscou] = useState(false)
  const nomeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [marca, setMarca] = useState(''); const [modelo, setModelo] = useState(''); const [ano, setAno] = useState(''); const [km, setKm] = useState('')
  const [chassi, setChassi] = useState(''); const [queixa, setQueixa] = useState(''); const [combustivel, setCombustivel] = useState('meio')
  // não-automotiva: descrição da peça/trabalho + material + medidas/specs + quantidade (colunas nullable estruturadas).
  const [itemDesc, setItemDesc] = useState(''); const [medidas, setMedidas] = useState(''); const [material, setMaterial] = useState(''); const [quantidade, setQuantidade] = useState('')
  const [origemAberta, setOrigemAberta] = useState(false)   // "motor/veículo de origem" colapsado
  const [mecanico, setMecanico] = useState(''); const [mecLimpos, setMecLimpos] = useState<string[]>([])  // responsável no check-in (opcional)
  const [check, setCheck] = useState<Record<string, 'ok' | 'avaria'>>({}); const [avarias, setAvarias] = useState(''); const [objetos, setObjetos] = useState('')
  const [fotos, setFotos] = useState<Foto[]>([]); const [subindoFoto, setSubindoFoto] = useState(false)
  const [salvando, setSalvando] = useState(false); const [msg, setMsg] = useState<string | null>(null)
  const [assinarOsId, setAssinarOsId] = useState<string | null>(null)  // RD-41 · assinatura "ciente do checklist"

  const buscarPlaca = async () => {
    if (!companyId || placa.trim().length < 5) return
    setBuscando(true); setHistorico(null)
    const { data } = await supabase.rpc('fn_oficina_buscar_placa', { p_company_id: companyId, p_placa: placa })
    setBuscando(false)
    const d = data as { cliente_id?: string; cliente_nome?: string; cliente_cnpj?: string; marca?: string; modelo?: string; ano?: number; ultimo_km?: number; os_anteriores?: number } | null
    if (d) {
      setClienteId(d.cliente_id ?? ''); setClienteNome(d.cliente_nome ?? ''); setClienteCnpj(d.cliente_cnpj ?? '')
      setMarca(d.marca ?? ''); setModelo(d.modelo ?? ''); setAno(d.ano ? String(d.ano) : '')
      setHistorico(`Veículo já esteve aqui ${d.os_anteriores ?? 1}× · último km ${d.ultimo_km ?? '—'}`)
    } else {
      setHistorico('Veículo novo — cadastrando na hora.')
    }
  }

  // Detecta CPF (11) x CNPJ (14) pela quantidade de dígitos. A busca só dispara com documento válido.
  const docDigits = clienteCnpj.replace(/\D/g, '')
  const isCnpj = docDigits.length === 14
  const isCpf = docDigits.length === 11
  const docValido = isCpf || isCnpj

  // FIX 1 · busca interna por documento (reusa fn_pessoa_existe_por_cnpj — genérica p/ CPF e CNPJ, RD-26).
  const buscarDocumento = async () => {
    if (!companyId || !docValido) return
    setBuscandoDoc(true); setDocStatus(null); setClienteId('')
    const { data } = await supabase.rpc('fn_pessoa_existe_por_cnpj', { p_company_id: companyId, p_cnpj: docDigits })
    setBuscandoDoc(false)
    const r = data as { sem_plano?: boolean; existe_como_cliente?: boolean; cliente_id?: string; cliente_razao?: string; existe_como_fornecedor?: boolean; fornecedor_id?: string; fornecedor_razao?: string } | null
    if (!r) { setDocStatus({ tipo: 'erro' }); return }
    if (r.sem_plano) { setDocStatus({ tipo: 'sem_plano' }); return }
    if (r.existe_como_cliente && r.cliente_id) {
      setClienteId(r.cliente_id)
      if (r.cliente_razao) setClienteNome(r.cliente_razao)
      setDocStatus({ tipo: 'cliente', razao: r.cliente_razao ?? '' }); return
    }
    if (r.existe_como_fornecedor && r.fornecedor_id) {
      setDocStatus({ tipo: 'fornecedor', razao: r.fornecedor_razao ?? '', fornecedorId: r.fornecedor_id }); return
    }
    setDocStatus({ tipo: 'nao_encontrado' })
  }

  // Existe só como fornecedor → cria o vínculo de cliente com a mesma razão/doc (fronteira GE via RPC).
  const usarFornecedorComoCliente = async () => {
    if (!companyId) return
    const nome = (docStatus?.razao || clienteNome || '').trim()
    setBuscandoDoc(true)
    const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: companyId, p_nome: nome || 'Cliente', p_cpf_cnpj: docDigits })
    setBuscandoDoc(false)
    if (error) { setMsg('❌ ' + error.message); return }
    setClienteId(data as string); if (nome) setClienteNome(nome)
    setDocStatus({ tipo: 'cliente', razao: nome }); setMsg('✅ Cliente vinculado.')
  }

  // Busca por NOME → lista (documento é único, nome não: homônimos aparecem, desambiguados por cidade/doc).
  const buscarNome = async () => {
    const termo = clienteNome.trim()
    if (!companyId || termo.length < 2) { setCliNomeOpts([]); return }
    setBuscandoNome(true); setNomeBuscou(false)
    const { data } = await supabase.rpc('fn_cliente_buscar', { p_company_id: companyId, p_termo: termo, p_limit: 10 })
    setBuscandoNome(false); setNomeBuscou(true)
    const r = data as { ok?: boolean; resultados?: CliOpt[] } | null
    setCliNomeOpts(r?.ok ? (r.resultados ?? []) : [])
  }
  const onClienteNomeChange = (v: string) => {
    setClienteNome(v); setClienteId(''); setDocStatus(null); setNomeBuscou(false)
    if (nomeTimer.current) clearTimeout(nomeTimer.current)
    if (v.trim().length < 2) { setCliNomeOpts([]); return }
    nomeTimer.current = setTimeout(() => { void buscarNome() }, 350)
  }
  const escolherClienteNome = (o: CliOpt) => {
    setClienteId(o.cliente_id); setClienteNome(o.nome); setClienteCnpj(o.cnpj_cpf ?? '')
    setCliNomeOpts([]); setNomeBuscou(false); setDocStatus({ tipo: 'cliente', razao: o.nome })
  }

  const abrirCadastro = () => { setCadNome(clienteNome || ''); setCadTelefone(''); setCadEndereco(null); setCadMsg(null); setCadAberto(true) }

  // FIX 2 · só CNPJ enriquece (BrasilAPI/ReceitaWS — mesma lupa da GE, RD-26). CPF: nome manual (LGPD).
  const enriquecerCnpj = async () => {
    if (!isCnpj) return
    setCadEnriq(true); setCadMsg(null)
    try {
      const res = await fetch(`/api/cnpj-lookup?cnpj=${docDigits}`)
      const d = await res.json()
      if (!res.ok || d.error) { setCadMsg(d.error || 'Não encontrei dados públicos.'); return }
      if (d.razao_social) setCadNome(d.razao_social)
      if (d.telefone) setCadTelefone(d.telefone)
      setCadEndereco({ logradouro: d.logradouro || '', numero: d.numero || '', bairro: d.bairro || '', cidade: d.cidade || '', uf: d.uf || '', cep: d.cep || '', ibge: d.ibge || '', email: d.email || '' })
      setCadMsg('✓ Dados públicos preenchidos.')
    } catch { setCadMsg('Falha ao consultar dados públicos.') }
    finally { setCadEnriq(false) }
  }

  const salvarCadastro = async () => {
    if (!companyId) return
    if (!cadNome.trim()) { setCadMsg('Informe o nome / razão social.'); return }
    setCadSalvando(true)
    const extra: Record<string, string> = { ...(cadEndereco || {}) }
    if (cadTelefone.trim()) extra.telefone = cadTelefone.trim()
    const { data, error } = await supabase.rpc('fn_cliente_criar_inline', {
      p_company_id: companyId, p_nome: cadNome.trim(), p_cpf_cnpj: docDigits,
      p_extra: Object.keys(extra).length ? extra : null,
    })
    setCadSalvando(false)
    if (error) { setCadMsg('❌ ' + error.message); return }
    setClienteId(data as string); setClienteNome(cadNome.trim())
    setDocStatus({ tipo: 'cliente', razao: cadNome.trim() })
    setCadAberto(false); setMsg('✅ Cliente cadastrado e vinculado.')
  }

  const onFotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length || !companyId) return
    setSubindoFoto(true)
    const novos: Foto[] = []
    for (const f of files) {
      const blob = await comprimirImagem(f)
      const path = `${companyId}/recepcao/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (error) continue
      // gera signed URL já aqui: se o thumbnail renderiza, a LEITURA do bucket privado está OK (o ⚠️ do CEO)
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
      novos.push({ path, legenda: '', url: signed?.signedUrl })
    }
    setFotos((p) => [...p, ...novos]); setSubindoFoto(false)
    if (novos.length < files.length) setMsg('Algumas fotos não subiram — tente de novo.')
    e.target.value = '' // permite re-selecionar o mesmo arquivo / tirar outra foto
  }
  const setLegenda = (i: number, v: string) => setFotos((p) => p.map((f, idx) => (idx === i ? { ...f, legenda: v } : f)))
  const removerFoto = (i: number) => setFotos((p) => p.filter((_, idx) => idx !== i))

  const salvar = async () => {
    if (!companyId) return
    if (ramo.automotivo) {
      if (placa.trim().length < 5) { setMsg('Informe a placa.'); return }
    } else if (!itemDesc.trim() && !queixa.trim()) {
      setMsg(`Descreva a ${ramo.objetoLabelCurto} ou o serviço solicitado.`); return
    }
    setSalvando(true)
    // automotiva → check-in de carro; demais ramos → recebimento da peça (dados nullable, sem placa/combustível/km).
    const p_dados = ramo.automotivo
      ? {
          cliente_id: clienteId || null, cliente_nome: clienteNome || null, cliente_cnpj: clienteCnpj || null,
          placa, marca, modelo, ano, km, chassi, queixa, combustivel,
          checklist: check, avarias, objetos,
          fotos: fotos.map((f) => ({ path: f.path, legenda: f.legenda })),
        }
      : {
          cliente_id: clienteId || null, cliente_nome: clienteNome || null, cliente_cnpj: clienteCnpj || null,
          placa: null, marca: marca || null, modelo: itemDesc.trim() || null,   // objeto = peça/trabalho → erp_os.modelo (aparece nos cards)
          ano: null, km: null, chassi: null,
          queixa: queixa.trim() || itemDesc.trim(),                             // "o que fazer" → erp_os.descricao_servico
          combustivel: null, checklist: {}, avarias: null, objetos: null,
          // snapshot estruturado da peça (colunas aditivas em erp_os_recepcao)
          peca_descricao: itemDesc.trim() || null, peca_material: material.trim() || null,
          peca_medidas: medidas.trim() || null, peca_quantidade: quantidade.trim() || null,
          fotos: fotos.map((f) => ({ path: f.path, legenda: f.legenda })),
        }
    const { data, error } = await supabase.rpc('fn_oficina_recepcao_criar', {
      p_company_id: companyId,
      p_dados,
    })
    const j = data as { ok?: boolean; erro?: string; numero?: string; os_id?: string } | null
    if (error || j?.ok === false) { setSalvando(false); setMsg('❌ ' + (error?.message || j?.erro)); return }
    // mecânico responsável opcional no check-in → reusa fn_os_designar_responsavel (trilha)
    if (j?.os_id && mecanico.trim()) {
      await supabase.rpc('fn_os_designar_responsavel', { p_os_id: j.os_id, p_nome: mecanico.trim() })
    }
    // OFIC-A (#10) · veio de um agendamento do Pátio → vincula a OS (os_id + status em_atendimento).
    // Idempotente no backend; o agendamento sai dos "Programados" (fn_agenda_patio_hoje filtra os_id).
    if (j?.os_id && agendamentoId) {
      await supabase.rpc('fn_agendamento_vincular_os', { p_agendamento_id: agendamentoId, p_os_id: j.os_id })
    }
    setSalvando(false)
    setMsg(`✅ Recepção registrada — ${j?.numero}.`)
    // RD-41 · colher a assinatura "ciente do checklist" do cliente (pode pular).
    if (j?.os_id) setAssinarOsId(j.os_id)
    else setTimeout(() => router.push('/dashboard/oficina/patio'), 1200)
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])
  useEffect(() => {
    if (!companyId) return
    void supabase.rpc('fn_oficina_mecanicos', { p_company_id: companyId }).then(({ data }) => {
      setMecLimpos(Array.isArray(data) ? data.map((r: { nome: string }) => r.nome) : [])
    })
  }, [companyId])
  // OFIC-A (#10) · prefill vindo do Pátio (?ag=&placa=&cliente_id=&cliente_nome=). Só no mount (client).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const ag = q.get('ag'); if (ag) setAgendamentoId(ag)
    const pl = q.get('placa'); if (pl) setPlaca(pl)
    const cid = q.get('cliente_id'); if (cid) setClienteId(cid)
    const cnome = q.get('cliente_nome'); if (cnome) setClienteNome(cnome)
  }, [])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir a Recepção.</div>

  const toggleCheck = (item: string) => setCheck((c) => ({ ...c, [item]: c[item] === 'ok' ? 'avaria' : 'ok' }))

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px' }}>
        <button onClick={() => router.push('/dashboard/oficina')} style={{ background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }}><ChevronLeft size={16} /> Oficina</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Recepção</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {ramo.automotivo ? <Car size={22} /> : <Package size={22} />} {ramo.recepcaoTitulo}
        </h1>

        {/* PLACA + busca — só na automotiva (a peça/trabalho não tem placa) */}
        {ramo.pedeVeiculo && (
          <Sec titulo="Placa">
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} onBlur={buscarPlaca}
                placeholder="ABC1D23" inputMode="text" autoCapitalize="characters"
                style={{ ...inp, fontSize: 20, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }} />
              <button onClick={buscarPlaca} disabled={buscando} style={{ ...btnGold, minWidth: 52 }}><Search size={18} /></button>
            </div>
            {historico && <div style={{ fontSize: 12, color: historico.startsWith('Veículo novo') ? GOLD : OK, marginTop: 6, fontWeight: 600 }}>{historico}</div>}
          </Sec>
        )}

        {/* CLIENTE + OBJETO (veículo OU peça/trabalho) */}
        <Sec titulo={ramo.automotivo ? 'Cliente & veículo' : `Cliente & ${ramo.objetoLabelCurto}`}>
          <Campo l="Cliente">
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={clienteNome} onChange={(e) => onClienteNomeChange(e.target.value)}
                placeholder="Nome do cliente — digite pra buscar" style={inp} />
              <button type="button" onClick={() => void buscarNome()} disabled={buscandoNome || clienteNome.trim().length < 2}
                title="Buscar cliente pelo nome" style={{ ...btnGold, minWidth: 52, opacity: (buscandoNome || clienteNome.trim().length < 2) ? 0.5 : 1 }}>
                <Search size={18} />
              </button>
            </div>
            {buscandoNome && <div style={selMut}>buscando…</div>}
            {cliNomeOpts.length > 0 && (
              <div style={{ marginTop: 4, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                {cliNomeOpts.map((o) => (
                  <button key={o.cliente_id} type="button" onClick={() => escolherClienteNome(o)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${LINE}`, background: '#fff', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: ESP }}>{o.nome}</div>
                    <div style={{ fontSize: 11, color: ESP60 }}>{[o.cnpj_cpf, o.cidade].filter(Boolean).join(' · ') || 'sem documento/cidade'}</div>
                  </button>
                ))}
              </div>
            )}
            {nomeBuscou && !buscandoNome && cliNomeOpts.length === 0 && clienteNome.trim().length >= 2 && docStatus?.tipo !== 'cliente' && (
              <div style={selWarn}>
                <span>Nenhum cliente com esse nome.</span>
                <button type="button" onClick={abrirCadastro} style={miniBtn}>Cadastrar novo</button>
              </div>
            )}
            {!buscandoNome && cliNomeOpts.length === 0 && clienteId && docStatus?.tipo === 'cliente' && (
              <div style={selOk}>✓ Cliente selecionado: {clienteNome}</div>
            )}
          </Campo>
          <Campo l="CPF/CNPJ (opcional)">
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={clienteCnpj}
                onChange={(e) => { setClienteCnpj(e.target.value); setDocStatus(null); setClienteId('') }}
                onBlur={() => { if (docValido) void buscarDocumento() }}
                inputMode="numeric" placeholder="Só números · CPF ou CNPJ" style={inp} />
              <button type="button" onClick={() => void buscarDocumento()} disabled={!docValido || buscandoDoc}
                title="Buscar cliente pelo documento" style={{ ...btnGold, minWidth: 52, opacity: (!docValido || buscandoDoc) ? 0.5 : 1 }}>
                <Search size={18} />
              </button>
            </div>
            {buscandoDoc && <div style={selMut}>buscando…</div>}
            {!buscandoDoc && docStatus?.tipo === 'cliente' && (
              <div style={selOk}>✓ Cliente encontrado{docStatus.razao ? `: ${docStatus.razao}` : ''}</div>
            )}
            {!buscandoDoc && docStatus?.tipo === 'fornecedor' && (
              <div style={selWarn}>
                <span>Esse documento está cadastrado como fornecedor. Usar como cliente também?</span>
                <button type="button" onClick={() => void usarFornecedorComoCliente()} style={miniBtn}>Usar como cliente</button>
              </div>
            )}
            {!buscandoDoc && docStatus?.tipo === 'nao_encontrado' && (
              <div style={selWarn}>
                <span>Não encontrei cadastro com esse documento.</span>
                <button type="button" onClick={abrirCadastro} style={miniBtn}>Cadastrar agora</button>
              </div>
            )}
            {!buscandoDoc && docStatus?.tipo === 'sem_plano' && <div style={selMut}>Busca de cadastro indisponível para esta empresa.</div>}
            {!buscandoDoc && docStatus?.tipo === 'erro' && <div style={selMut}>Não consegui buscar agora — pode digitar o nome manualmente.</div>}
          </Campo>
          {ramo.automotivo ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Campo l="Marca"><input value={marca} onChange={(e) => setMarca(e.target.value)} style={inp} /></Campo>
                <Campo l="Modelo"><input value={modelo} onChange={(e) => setModelo(e.target.value)} style={inp} /></Campo>
                <Campo l="Ano"><input value={ano} onChange={(e) => setAno(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={4} style={inp} /></Campo>
                <Campo l="KM atual"><input value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={inp} /></Campo>
              </div>
              <Campo l="Chassi (opcional)"><input value={chassi} onChange={(e) => setChassi(e.target.value.toUpperCase())} style={inp} /></Campo>
            </>
          ) : (
            <>
              <Campo l={`${ramo.objetoLabel} *`}><input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} placeholder={ramo.identPlaceholder} style={inp} /></Campo>
              <Campo l="Material (opcional)"><input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: alumínio / ferro fundido" style={inp} /></Campo>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                <Campo l="Medidas / specs (opcional)"><input value={medidas} onChange={(e) => setMedidas(e.target.value)} placeholder="Ex.: Ø 82,00mm" style={inp} /></Campo>
                <Campo l="Quantidade (opcional)"><input value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="1" style={inp} /></Campo>
              </div>
              {/* Motor/veículo de origem — colapsado (rastreio opcional de qual carro veio a peça) */}
              {origemAberta ? (
                <Campo l="Motor / veículo de origem (opcional)"><input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ex.: motor AP 1.8 / Gol G4" style={inp} autoFocus /></Campo>
              ) : (
                <button onClick={() => setOrigemAberta(true)} style={{ background: 'none', border: 'none', color: GOLD, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '2px 0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  + Motor / veículo de origem
                </button>
              )}
            </>
          )}
        </Sec>

        {/* SERVIÇO / O QUE FAZER */}
        <Sec titulo={ramo.servicoLabel}>
          <textarea value={queixa} onChange={(e) => setQueixa(e.target.value)} rows={3}
            placeholder={ramo.automotivo ? 'Ex.: barulho na frente ao frear, luz do motor acesa…' : 'Ex.: retífica de cabeçote, plaina, brunimento…'}
            style={{ ...inp, resize: 'vertical' }} />
        </Sec>

        {/* MECÂNICO RESPONSÁVEL (opcional no check-in; pode designar depois no Pátio) */}
        <Sec titulo="Mecânico responsável (opcional)">
          <input list="mec-recepcao" value={mecanico} onChange={(e) => setMecanico(e.target.value)}
            placeholder="Nome do mecânico" style={inp} />
          <datalist id="mec-recepcao">{mecLimpos.map((m) => <option key={m} value={m} />)}</datalist>
        </Sec>

        {/* CHECKLIST DE ENTRADA — só automotiva (combustível/retrovisores/pneus não fazem sentido p/ peça) */}
        {ramo.pedeCheckinAutomotivo && (
          <Sec titulo="Como o carro chegou (checklist)">
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: ESP60 }}>Combustível:</span>
              {COMBUSTIVEL.map((c) => (
                <button key={c.v} onClick={() => setCombustivel(c.v)} style={{ ...chip, background: combustivel === c.v ? ESP : '#fff', color: combustivel === c.v ? '#fff' : ESP }}>{c.l}</button>
              ))}
            </div>
            {CHECK_ITENS.map((item) => {
              const st = check[item]
              return (
                <button key={item} onClick={() => toggleCheck(item)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 12px', marginBottom: 6, borderRadius: 10, cursor: 'pointer', minHeight: 46,
                  border: `1px solid ${st === 'avaria' ? RED : st === 'ok' ? OK : LINE}`,
                  background: st === 'avaria' ? 'rgba(163,45,45,0.07)' : st === 'ok' ? 'rgba(22,101,52,0.06)' : '#fff' }}>
                  <span style={{ fontSize: 14, fontWeight: st ? 600 : 400 }}>{item}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: st === 'avaria' ? RED : st === 'ok' ? OK : ESP60 }}>
                    {st === 'avaria' ? <><X size={14} /> Avaria</> : st === 'ok' ? <><Check size={14} /> OK</> : 'toque p/ marcar'}
                  </span>
                </button>
              )
            })}
            <Campo l="Avarias na entrada (riscos, amassados…)"><textarea value={avarias} onChange={(e) => setAvarias(e.target.value)} rows={2} placeholder="Ex.: risco na porta esquerda" style={{ ...inp, resize: 'vertical' }} /></Campo>
            <Campo l="Objetos deixados no veículo"><input value={objetos} onChange={(e) => setObjetos(e.target.value)} placeholder="Ex.: documento no porta-luvas" style={inp} /></Campo>
          </Sec>
        )}

        {/* FOTOS */}
        <Sec titulo={ramo.automotivo ? 'Fotos de como o carro chegou' : `Fotos da ${ramo.objetoLabelCurto}`}>
          <label style={{ ...btnGold, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', width: 'auto' }}>
            <Camera size={18} /> {subindoFoto ? 'Enviando…' : 'Tirar / anexar fotos'}
            <input type="file" accept="image/*" capture="environment" multiple onChange={onFotos} style={{ display: 'none' }} />
          </label>
          {fotos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10, marginTop: 12 }}>
              {fotos.map((f, i) => (
                <div key={f.path} style={{ border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                  {f.url
                    ? <img src={f.url} alt={f.legenda || 'foto'} style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', height: 72, background: '#F0EADE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: ESP60 }}>enviando…</div>}
                  <input value={f.legenda} onChange={(e) => setLegenda(i, e.target.value)} placeholder="Legenda…"
                    style={{ width: '100%', border: 'none', borderTop: `1px solid ${LINE}`, padding: '6px 8px', fontSize: 11, color: ESP, outline: 'none', fontFamily: 'inherit' }} />
                  <button onClick={() => removerFoto(i)} style={{ width: '100%', border: 'none', borderTop: `1px solid ${LINE}`, background: '#fff', color: RED, fontSize: 11, fontWeight: 700, padding: '5px 0', cursor: 'pointer' }}>remover</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: ESP60, marginTop: 8 }}>Várias fotos (risco na porta, para-choque, farol…) · comprimidas p/ subir rápido · legenda em cada uma.</div>
        </Sec>
      </div>

      {/* barra fixa de salvar (mobile) */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={salvar} disabled={salvando} style={{ ...btnGold, maxWidth: 560, width: '100%', fontSize: 15, minHeight: 48 }}>
          {salvando ? 'Registrando…' : 'Registrar recepção → Pátio'}
        </button>
      </div>
      {msg && <div style={{ position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{msg}</div>}

      {/* RD-41 · assinatura "ciente do checklist" (entrada). Pode pular ("Agora não"). */}
      {assinarOsId && (
        <AssinaturaModal
          osId={assinarOsId}
          tipo="checklist_ciente"
          titulo={ramo.automotivo ? 'Cliente ciente do checklist' : `Cliente ciente do recebimento da ${ramo.objetoLabelCurto}`}
          subtitulo={ramo.automotivo
            ? 'Confirmo que estou ciente do estado/checklist do veículo. (Não é aprovação de orçamento.)'
            : `Confirmo a entrega da ${ramo.objetoLabelCurto} para o serviço solicitado. (Não é aprovação de orçamento.)`}
          aberto
          onFechar={() => { setAssinarOsId(null); router.push('/dashboard/oficina/patio') }}
          onAssinado={() => setMsg('✅ Checklist assinado pelo cliente.')}
        />
      )}

      {/* FIX 2 · cadastro inline do cliente — overlay, NÃO navega pra fora da recepção. */}
      <Modal
        open={cadAberto}
        onClose={() => setCadAberto(false)}
        title="Cadastrar cliente"
        subtitle={`Documento ${clienteCnpj || docDigits} — sem sair da recepção`}
        footer={<>
          <button type="button" onClick={() => setCadAberto(false)} style={btnGhost}>Cancelar</button>
          <button type="button" onClick={() => void salvarCadastro()} disabled={cadSalvando} style={{ ...btnGold, opacity: cadSalvando ? 0.6 : 1 }}>
            {cadSalvando ? 'Salvando…' : 'Salvar e vincular'}
          </button>
        </>}
      >
        <Campo l="Nome / Razão social *"><input value={cadNome} onChange={(e) => setCadNome(e.target.value)} style={inp} autoFocus /></Campo>
        <Campo l="Documento"><input value={clienteCnpj} readOnly style={{ ...inp, background: '#F0EADE', color: ESP60 }} /></Campo>
        <Campo l="Telefone (opcional)"><input value={cadTelefone} onChange={(e) => setCadTelefone(e.target.value)} inputMode="tel" style={inp} /></Campo>
        {isCnpj && (
          <button type="button" onClick={() => void enriquecerCnpj()} disabled={cadEnriq} style={{ ...btnGold, width: 'auto', opacity: cadEnriq ? 0.6 : 1 }}>
            <Search size={16} /> {cadEnriq ? 'Buscando…' : 'Buscar dados públicos'}
          </button>
        )}
        {isCpf && <div style={{ fontSize: 11, color: ESP60, marginTop: 4 }}>CPF: sem consulta pública (LGPD) — informe o nome manualmente.</div>}
        {cadEndereco?.cidade && (
          <div style={{ fontSize: 12, color: OK, marginTop: 8 }}>📍 {[cadEndereco.logradouro, cadEndereco.numero, cadEndereco.bairro, cadEndereco.cidade, cadEndereco.uf].filter(Boolean).join(', ')}</div>
        )}
        {cadMsg && <div style={{ fontSize: 12, color: /^(✓|📍)/.test(cadMsg) ? OK : RED, marginTop: 8 }}>{cadMsg}</div>}
      </Modal>
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: ESP60, marginBottom: 4 }}>{l}</div>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const chip: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const selOk: CSSProperties = { fontSize: 12, color: OK, marginTop: 6, fontWeight: 600 }
const selWarn: CSSProperties = { fontSize: 12, color: '#854F0B', marginTop: 6, fontWeight: 600, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }
const selMut: CSSProperties = { fontSize: 12, color: ESP60, marginTop: 6 }
const miniBtn: CSSProperties = { background: ESP, color: '#fff', border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const btnGhost: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
