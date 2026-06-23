'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/hooks/useEmpresaSelecionada'

type Prop = { id: string; nome: string }
type Lote = { id: string; codigo: string; modo: string; fase: string | null }
type Animal = { id: string; identificacao: string | null; sexo: 'M' | 'F' | null; categoria: string; origem: string }

export default function Rebanho() {
  const { companyId } = useEmpresaSelecionada()
  const [props, setProps] = useState<Prop[]>([])
  const [prop, setProp] = useState('')
  const [lotes, setLotes] = useState<Lote[]>([])
  const [animais, setAnimais] = useState<Animal[]>([])
  const [tab, setTab] = useState<'animais' | 'lotes'>('animais')
  const [aForm, setAForm] = useState({ identificacao: '', sexo: 'M', categoria: 'bezerro', origem: 'nascido', lote_id: '', contraparte_nome: '' })
  const [lForm, setLForm] = useState({ codigo: '', modo: 'pasto', fase: '' })

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
    if (!prop) return
    const { data: l } = await supabase.from('erp_pec_lote').select('id,codigo,modo,fase')
      .eq('propriedade_id', prop).eq('status', 'ativo').order('codigo')
    setLotes((l as Lote[]) ?? [])
    const { data: a } = await supabase.from('erp_pec_animal').select('id,identificacao,sexo,categoria,origem')
      .eq('propriedade_id', prop).eq('status', 'ativo').order('created_at', { ascending: false }).limit(200)
    setAnimais((a as Animal[]) ?? [])
  }, [prop])
  useEffect(() => { load() }, [load])

  const salvarAnimal = async () => {
    if (!companyId || !prop) return
    await supabase.rpc('fn_pec_animal_salvar', {
      p_company_id: companyId, p_propriedade_id: prop,
      p_identificacao: aForm.identificacao || null,
      p_sexo: aForm.sexo, p_categoria: aForm.categoria, p_origem: aForm.origem,
      p_lote_id: aForm.lote_id || null, p_contraparte_nome: aForm.contraparte_nome || null,
    })
    setAForm({ identificacao: '', sexo: 'M', categoria: 'bezerro', origem: 'nascido', lote_id: '', contraparte_nome: '' })
    load()
  }
  const salvarLote = async () => {
    if (!companyId || !prop || !lForm.codigo) return
    await supabase.rpc('fn_pec_lote_salvar', {
      p_company_id: companyId, p_propriedade_id: prop, p_codigo: lForm.codigo, p_modo: lForm.modo, p_fase: lForm.fase || null,
    })
    setLForm({ codigo: '', modo: 'pasto', fase: '' })
    load()
  }
  const mover = async (animal_id: string, tipo: 'venda' | 'morte') => {
    if (!companyId || !prop) return
    await supabase.rpc('fn_pec_movimentacao_registrar', {
      p_company_id: companyId, p_propriedade_id: prop, p_tipo: tipo, p_animal_id: animal_id,
    })
    load()
  }

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa especifica no topo do menu para gerenciar o rebanho.
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4">
      <h1 className="text-xl font-bold text-[#3D2314]">Rebanho &amp; Lotes</h1>
      {props.length === 0 ? (
        <div className="rounded-2xl bg-white p-4 border border-[#E7DECF] text-sm text-[#3D2314]/60">
          Cadastre uma propriedade primeiro em Propriedades &amp; Áreas.
        </div>
      ) : (
        <>
          <select className={inp} value={prop} onChange={(e) => setProp(e.target.value)}>
            {props.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>

          <div className="flex gap-2">
            <button onClick={() => setTab('animais')} className={`flex-1 rounded-xl p-2 text-sm font-semibold ${tab === 'animais' ? 'bg-[#3D2314] text-white' : 'bg-white text-[#3D2314] border border-[#E7DECF]'}`}>Animais</button>
            <button onClick={() => setTab('lotes')} className={`flex-1 rounded-xl p-2 text-sm font-semibold ${tab === 'lotes' ? 'bg-[#3D2314] text-white' : 'bg-white text-[#3D2314] border border-[#E7DECF]'}`}>Lotes</button>
          </div>

          {tab === 'animais' ? (
            <>
              <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
                <h2 className="text-sm font-semibold text-[#3D2314]">Novo animal</h2>
                <input className={inp} placeholder="Brinco / identificação" value={aForm.identificacao} onChange={(e) => setAForm({ ...aForm, identificacao: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <select className={inp} value={aForm.sexo} onChange={(e) => setAForm({ ...aForm, sexo: e.target.value })}>
                    <option value="M">Macho</option>
                    <option value="F">Fêmea</option>
                  </select>
                  <select className={inp} value={aForm.categoria} onChange={(e) => setAForm({ ...aForm, categoria: e.target.value })}>
                    <option value="matriz">Matriz</option>
                    <option value="touro">Touro</option>
                    <option value="bezerro">Bezerro</option>
                    <option value="bezerra">Bezerra</option>
                    <option value="garrote">Garrote</option>
                    <option value="novilha">Novilha</option>
                    <option value="boi_magro">Boi magro</option>
                    <option value="boi_gordo">Boi gordo</option>
                    <option value="descarte">Descarte</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select className={inp} value={aForm.origem} onChange={(e) => setAForm({ ...aForm, origem: e.target.value })}>
                    <option value="nascido">Nascido</option>
                    <option value="comprado">Comprado</option>
                  </select>
                  <select className={inp} value={aForm.lote_id} onChange={(e) => setAForm({ ...aForm, lote_id: e.target.value })}>
                    <option value="">— sem lote —</option>
                    {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
                  </select>
                </div>
                {aForm.origem === 'comprado' && (
                  <input className={inp} placeholder="Fornecedor" value={aForm.contraparte_nome} onChange={(e) => setAForm({ ...aForm, contraparte_nome: e.target.value })} />
                )}
                <button onClick={salvarAnimal} className="w-full rounded-xl bg-[#3D2314] text-white p-2 font-semibold">CRIAR animal</button>
              </section>

              <section className="space-y-2">
                {animais.length === 0 && <div className="text-xs text-[#3D2314]/50">Nenhum animal ativo.</div>}
                {animais.map((a) => (
                  <div key={a.id} className="rounded-2xl bg-white p-3 border border-[#E7DECF]">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-semibold text-[#3D2314]">
                          {a.identificacao || '(sem brinco)'} <span className="text-xs text-[#3D2314]/50 capitalize">· {a.categoria.replace('_', ' ')}</span>
                        </div>
                        <div className="text-xs text-[#3D2314]/60">{a.sexo === 'M' ? 'Macho' : 'Fêmea'} · {a.origem}</div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => mover(a.id, 'venda')} className="text-xs rounded-lg bg-[#C8941A] text-white px-2">Vender</button>
                        <button onClick={() => mover(a.id, 'morte')} className="text-xs rounded-lg bg-[#E7DECF] text-[#3D2314] px-2">Baixa</button>
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <>
              <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
                <h2 className="text-sm font-semibold text-[#3D2314]">Novo lote</h2>
                <input className={inp} placeholder="Código (ex.: Lote A / Baia 3)" value={lForm.codigo} onChange={(e) => setLForm({ ...lForm, codigo: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <select className={inp} value={lForm.modo} onChange={(e) => setLForm({ ...lForm, modo: e.target.value })}>
                    <option value="pasto">Pasto</option>
                    <option value="semiconfinamento">Semiconfinamento</option>
                    <option value="confinamento">Confinamento</option>
                  </select>
                  <select className={inp} value={lForm.fase} onChange={(e) => setLForm({ ...lForm, fase: e.target.value })}>
                    <option value="">— fase —</option>
                    <option value="cria">Cria</option>
                    <option value="recria">Recria</option>
                    <option value="engorda">Engorda</option>
                    <option value="terminacao">Terminação</option>
                  </select>
                </div>
                <button onClick={salvarLote} className="w-full rounded-xl bg-[#3D2314] text-white p-2 font-semibold">CRIAR lote</button>
              </section>

              <section className="space-y-2">
                {lotes.map((l) => (
                  <div key={l.id} className="rounded-2xl bg-white p-3 border border-[#E7DECF] flex justify-between">
                    <span className="font-semibold text-[#3D2314]">{l.codigo}</span>
                    <span className="text-xs text-[#3D2314]/60 capitalize">{l.modo} {l.fase ? `· ${l.fase}` : ''}</span>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
