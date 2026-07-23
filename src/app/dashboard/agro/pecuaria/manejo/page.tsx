'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/hooks/useEmpresaSelecionada'

type Prop = { id: string; nome: string }
type Animal = { id: string; identificacao: string | null; categoria: string; peso_atual_kg: number | null; gmd_atual_kg_dia: number | null }
type Painel = {
  gmd_medio_rebanho: number | null
  pesados_30d: number
  pendencias_sanitarias: Array<{ tipo: string; produto: string | null; proxima_dose: string; animal_id: string | null; lote_id: string | null }>
}

export default function Manejo() {
  const { companyId } = useEmpresaSelecionada()
  const [props, setProps] = useState<Prop[]>([])
  const [prop, setProp] = useState('')
  const [animais, setAnimais] = useState<Animal[]>([])
  const [painel, setPainel] = useState<Painel | null>(null)
  const [tab, setTab] = useState<'pesagem' | 'sanidade'>('pesagem')
  const [pes, setPes] = useState({ animal_id: '', peso_kg: '', origem: 'manual' })
  const [san, setSan] = useState({ animal_id: '', tipo: 'vacina', produto: '', proxima_dose: '', dose: '' })
  const [ultimoGmd, setUltimoGmd] = useState<number | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_pec_propriedade').select('id,nome').eq('ativo', true).order('nome')
      if (!alive) return
      const list = (data as Prop[]) ?? []
      setProps(list)
      if (list[0]) setProp(list[0].id)
    })()
    return () => { alive = false }
  }, [companyId])

  const load = useCallback(async () => {
    if (!prop || !companyId) return
    const { data: a } = await supabase.from('erp_pec_animal')
      .select('id,identificacao,categoria,peso_atual_kg,gmd_atual_kg_dia')
      .eq('propriedade_id', prop).eq('status', 'ativo').order('identificacao').limit(300)
    setAnimais((a as Animal[]) ?? [])
    const { data: pn } = await supabase.rpc('fn_pec_painel_manejo', { p_company_id: companyId, p_propriedade_id: prop })
    setPainel(pn as Painel)
  }, [prop, companyId])
  useEffect(() => { load() }, [load])

  const registrarPeso = async () => {
    if (!companyId || !prop || !pes.animal_id || !pes.peso_kg) return
    const { data } = await supabase.rpc('fn_pec_pesagem_registrar', {
      p_company_id: companyId, p_propriedade_id: prop, p_peso_kg: Number(pes.peso_kg),
      p_animal_id: pes.animal_id, p_origem: pes.origem,
    })
    const d = data as { gmd_kg_dia: number | null } | null
    setUltimoGmd(d?.gmd_kg_dia ?? null)
    setPes({ animal_id: '', peso_kg: '', origem: 'manual' })
    load()
  }
  const registrarSanidade = async () => {
    if (!companyId || !prop || !san.animal_id || !san.tipo) return
    await supabase.rpc('fn_pec_evento_sanitario_registrar', {
      p_company_id: companyId, p_propriedade_id: prop, p_tipo: san.tipo, p_produto: san.produto || null,
      p_animal_id: san.animal_id, p_dose: san.dose || null, p_proxima_dose: san.proxima_dose || null,
    })
    setSan({ animal_id: '', tipo: 'vacina', produto: '', proxima_dose: '', dose: '' })
    load()
  }

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa especifica no topo do menu para abrir o manejo.
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4">
      <h1 className="text-xl font-bold text-[#3D2314]">Manejo &amp; Pesagem</h1>
      {props.length === 0 ? (
        <div className="rounded-2xl bg-white p-4 border border-[#E7DECF] text-sm text-[#3D2314]/60">
          Cadastre uma propriedade primeiro em Propriedades &amp; Áreas.
        </div>
      ) : (
        <>
          <select className={inp} value={prop} onChange={(e) => setProp(e.target.value)}>
            {props.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 border border-[#E7DECF]">
              <div className="text-2xl font-bold text-[#3D2314]">{painel?.gmd_medio_rebanho ?? '—'}</div>
              <div className="text-xs text-[#3D2314]/60">GMD médio (kg/dia)</div>
            </div>
            <div className="rounded-2xl bg-white p-4 border border-[#E7DECF]">
              <div className="text-2xl font-bold text-[#3D2314]">{painel?.pesados_30d ?? '—'}</div>
              <div className="text-xs text-[#3D2314]/60">Pesados (30d)</div>
            </div>
          </div>

          {(painel?.pendencias_sanitarias?.length ?? 0) > 0 && (
            <section className="rounded-2xl bg-white p-4 border border-[#C8941A]">
              <h2 className="text-sm font-semibold text-[#3D2314] mb-1">⚠️ Próximas doses (15 dias)</h2>
              {painel?.pendencias_sanitarias.map((p, i) => (
                <div key={i} className="flex justify-between text-sm border-b border-[#E7DECF] py-1">
                  <span className="capitalize text-[#3D2314]">{p.tipo} {p.produto ? `· ${p.produto}` : ''}</span>
                  <span className="text-[#C8941A] font-semibold">{p.proxima_dose}</span>
                </div>
              ))}
            </section>
          )}

          <div className="flex gap-2">
            <button onClick={() => setTab('pesagem')} className={`flex-1 rounded-xl p-2 text-sm font-semibold ${tab === 'pesagem' ? 'bg-[#3D2314] text-white' : 'bg-white text-[#3D2314] border border-[#E7DECF]'}`}>Pesagem</button>
            <button onClick={() => setTab('sanidade')} className={`flex-1 rounded-xl p-2 text-sm font-semibold ${tab === 'sanidade' ? 'bg-[#3D2314] text-white' : 'bg-white text-[#3D2314] border border-[#E7DECF]'}`}>Sanidade</button>
          </div>

          {tab === 'pesagem' ? (
            <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
              <select className={inp} value={pes.animal_id} onChange={(e) => setPes({ ...pes, animal_id: e.target.value })}>
                <option value="">— escolha o animal —</option>
                {animais.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.identificacao || '(sem brinco)'} · {a.categoria}{a.peso_atual_kg ? ` · ${a.peso_atual_kg}kg` : ''}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className={inp} inputMode="decimal" placeholder="Peso (kg)" value={pes.peso_kg} onChange={(e) => setPes({ ...pes, peso_kg: e.target.value })} />
                <select className={inp} value={pes.origem} onChange={(e) => setPes({ ...pes, origem: e.target.value })}>
                  <option value="manual">Manual</option>
                  <option value="balanca">Balança</option>
                </select>
              </div>
              <button onClick={registrarPeso} className="w-full rounded-xl bg-[#3D2314] text-white p-2 font-semibold">REGISTRAR pesagem</button>
              {ultimoGmd !== null && (
                <div className="text-center text-sm text-[#C8941A] font-semibold">GMD desde a última: {ultimoGmd} kg/dia</div>
              )}
            </section>
          ) : (
            <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
              <select className={inp} value={san.animal_id} onChange={(e) => setSan({ ...san, animal_id: e.target.value })}>
                <option value="">— escolha o animal —</option>
                {animais.map((a) => (
                  <option key={a.id} value={a.id}>{a.identificacao || '(sem brinco)'} · {a.categoria}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select className={inp} value={san.tipo} onChange={(e) => setSan({ ...san, tipo: e.target.value })}>
                  <option value="vacina">Vacina</option>
                  <option value="vermifugo">Vermífugo</option>
                  <option value="medicamento">Medicamento</option>
                  <option value="exame">Exame</option>
                  <option value="outro">Outro</option>
                </select>
                <input className={inp} placeholder="Produto" value={san.produto} onChange={(e) => setSan({ ...san, produto: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={inp} placeholder="Dose" value={san.dose} onChange={(e) => setSan({ ...san, dose: e.target.value })} />
                <input className={inp} type="date" value={san.proxima_dose} onChange={(e) => setSan({ ...san, proxima_dose: e.target.value })} />
              </div>
              <button onClick={registrarSanidade} className="w-full rounded-xl bg-[#C8941A] text-white p-2 font-semibold">REGISTRAR manejo</button>
            </section>
          )}
        </>
      )}
    </div>
  )
}
