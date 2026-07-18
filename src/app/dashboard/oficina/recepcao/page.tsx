'use client'
// OFICINA · RECEPÇÃO DE VEÍCULO (check-in). Mobile-first (o recepcionista/mecânico usa celular).
// Busca por placa → prefill do histórico → cliente/veículo/km/queixa + checklist + FOTOS → cria OS (pátio).
import React, { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Camera, Car, ChevronLeft, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'
const BUCKET = 'oficina-recepcao'
const CHECK_ITENS = ['Pneus', 'Estepe', 'Faróis / lanternas', 'Retrovisores', 'Vidros', 'Documentos', 'Tapetes / objetos']
const COMBUSTIVEL = [{ v: 'vazio', l: 'Vazio' }, { v: '1_4', l: '1/4' }, { v: 'meio', l: '1/2' }, { v: '3_4', l: '3/4' }, { v: 'cheio', l: 'Cheio' }]

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
  const [placa, setPlaca] = useState(''); const [buscando, setBuscando] = useState(false); const [historico, setHistorico] = useState<string | null>(null)
  const [clienteNome, setClienteNome] = useState(''); const [clienteCnpj, setClienteCnpj] = useState(''); const [clienteId, setClienteId] = useState('')
  const [marca, setMarca] = useState(''); const [modelo, setModelo] = useState(''); const [ano, setAno] = useState(''); const [km, setKm] = useState('')
  const [chassi, setChassi] = useState(''); const [queixa, setQueixa] = useState(''); const [combustivel, setCombustivel] = useState('meio')
  const [check, setCheck] = useState<Record<string, 'ok' | 'avaria'>>({}); const [avarias, setAvarias] = useState(''); const [objetos, setObjetos] = useState('')
  const [fotos, setFotos] = useState<string[]>([]); const [subindoFoto, setSubindoFoto] = useState(false)
  const [salvando, setSalvando] = useState(false); const [msg, setMsg] = useState<string | null>(null)

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

  const onFotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !companyId) return
    setSubindoFoto(true)
    const novos: string[] = []
    for (const f of files) {
      const path = `${companyId}/recepcao/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false })
      if (!error) novos.push(path)
    }
    setFotos((p) => [...p, ...novos]); setSubindoFoto(false)
    if (novos.length < files.length) setMsg('Algumas fotos não subiram — tente de novo.')
  }

  const salvar = async () => {
    if (!companyId) return
    if (placa.trim().length < 5) { setMsg('Informe a placa.'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_oficina_recepcao_criar', {
      p_company_id: companyId,
      p_dados: {
        cliente_id: clienteId || null, cliente_nome: clienteNome || null, cliente_cnpj: clienteCnpj || null,
        placa, marca, modelo, ano, km, chassi, queixa, combustivel,
        checklist: check, avarias, objetos, fotos,
      },
    })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string; numero?: string } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setMsg(`✅ Recepção registrada — ${j?.numero}. O carro está no Pátio.`)
    setTimeout(() => router.push('/dashboard/oficina/patio'), 1200)
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir a Recepção.</div>

  const toggleCheck = (item: string) => setCheck((c) => ({ ...c, [item]: c[item] === 'ok' ? 'avaria' : 'ok' }))

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px' }}>
        <button onClick={() => router.push('/dashboard/oficina')} style={{ background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }}><ChevronLeft size={16} /> Oficina</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Recepção</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Car size={22} /> Check-in do veículo</h1>

        {/* PLACA + busca */}
        <Sec titulo="Placa">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} onBlur={buscarPlaca}
              placeholder="ABC1D23" inputMode="text" autoCapitalize="characters"
              style={{ ...inp, fontSize: 20, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }} />
            <button onClick={buscarPlaca} disabled={buscando} style={{ ...btnGold, minWidth: 52 }}><Search size={18} /></button>
          </div>
          {historico && <div style={{ fontSize: 12, color: historico.startsWith('Veículo novo') ? GOLD : OK, marginTop: 6, fontWeight: 600 }}>{historico}</div>}
        </Sec>

        {/* CLIENTE + VEÍCULO */}
        <Sec titulo="Cliente & veículo">
          <Campo l="Cliente"><input value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} placeholder="Nome do cliente" style={inp} /></Campo>
          <Campo l="CPF/CNPJ (opcional)"><input value={clienteCnpj} onChange={(e) => setClienteCnpj(e.target.value)} inputMode="numeric" style={inp} /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Campo l="Marca"><input value={marca} onChange={(e) => setMarca(e.target.value)} style={inp} /></Campo>
            <Campo l="Modelo"><input value={modelo} onChange={(e) => setModelo(e.target.value)} style={inp} /></Campo>
            <Campo l="Ano"><input value={ano} onChange={(e) => setAno(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={4} style={inp} /></Campo>
            <Campo l="KM atual"><input value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={inp} /></Campo>
          </div>
          <Campo l="Chassi (opcional)"><input value={chassi} onChange={(e) => setChassi(e.target.value.toUpperCase())} style={inp} /></Campo>
        </Sec>

        {/* QUEIXA */}
        <Sec titulo="O que está acontecendo? (queixa do cliente)">
          <textarea value={queixa} onChange={(e) => setQueixa(e.target.value)} rows={3} placeholder="Ex.: barulho na frente ao frear, luz do motor acesa…" style={{ ...inp, resize: 'vertical' }} />
        </Sec>

        {/* CHECKLIST DE ENTRADA */}
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
              <button key={item} onClick={() => toggleCheck(item)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 12px', marginBottom: 6, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', minHeight: 46 }}>
                <span style={{ fontSize: 14 }}>{item}</span>
                <span style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: st === 'avaria' ? RED : st === 'ok' ? OK : ESP60 }}>
                  {st === 'avaria' ? <><X size={14} /> Avaria</> : st === 'ok' ? <><Check size={14} /> OK</> : 'toque'}
                </span>
              </button>
            )
          })}
          <Campo l="Avarias na entrada (riscos, amassados…)"><textarea value={avarias} onChange={(e) => setAvarias(e.target.value)} rows={2} placeholder="Ex.: risco na porta esquerda" style={{ ...inp, resize: 'vertical' }} /></Campo>
          <Campo l="Objetos deixados no veículo"><input value={objetos} onChange={(e) => setObjetos(e.target.value)} placeholder="Ex.: documento no porta-luvas" style={inp} /></Campo>
        </Sec>

        {/* FOTOS */}
        <Sec titulo="Fotos de como o carro chegou">
          <label style={{ ...btnGold, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', width: 'auto' }}>
            <Camera size={18} /> {subindoFoto ? 'Enviando…' : 'Tirar / anexar fotos'}
            <input type="file" accept="image/*" capture="environment" multiple onChange={onFotos} style={{ display: 'none' }} />
          </label>
          {fotos.length > 0 && <div style={{ fontSize: 12, color: OK, marginTop: 8, fontWeight: 600 }}>{fotos.length} foto(s) anexada(s) ✓</div>}
          <div style={{ fontSize: 11, color: ESP60, marginTop: 6 }}>Protege a oficina: registra o estado do carro na entrada.</div>
        </Sec>
      </div>

      {/* barra fixa de salvar (mobile) */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={salvar} disabled={salvando} style={{ ...btnGold, maxWidth: 560, width: '100%', fontSize: 15, minHeight: 48 }}>
          {salvando ? 'Registrando…' : 'Registrar recepção → Pátio'}
        </button>
      </div>
      {msg && <div style={{ position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{msg}</div>}
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
