'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/hooks/useEmpresaSelecionada'

type Prop = { id: string; nome: string; tipo_operacao: string; cidade: string | null; uf: string | null }
type Area = { id: string; nome: string; tipo: string; area_ha: number | null; arrendada_para: string | null }

export default function Propriedades() {
  const { companyId } = useEmpresaSelecionada()
  const [props, setProps] = useState<Prop[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [sel, setSel] = useState<string>('')
  const [form, setForm] = useState({ nome: '', tipo_operacao: 'ciclo_completo', cidade: '', uf: '', area_total_ha: '' })
  const [areaForm, setAreaForm] = useState({ nome: '', tipo: 'piquete', area_ha: '', arrendada_para: '' })

  const load = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('erp_pec_propriedade').select('id,nome,tipo_operacao,cidade,uf').eq('ativo', true).order('nome')
    setProps((data as Prop[]) ?? [])
    if (sel) {
      const { data: a } = await supabase.from('erp_pec_area').select('id,nome,tipo,area_ha,arrendada_para')
        .eq('propriedade_id', sel).eq('ativo', true).order('nome')
      setAreas((a as Area[]) ?? [])
    } else {
      setAreas([])
    }
  }, [companyId, sel])
  useEffect(() => { load() }, [load])

  const salvarProp = async () => {
    if (!companyId || !form.nome) return
    await supabase.rpc('fn_pec_propriedade_salvar', {
      p_company_id: companyId, p_nome: form.nome, p_tipo_operacao: form.tipo_operacao,
      p_cidade: form.cidade || null, p_uf: form.uf || null,
      p_area_total_ha: form.area_total_ha ? Number(form.area_total_ha) : null,
    })
    setForm({ nome: '', tipo_operacao: 'ciclo_completo', cidade: '', uf: '', area_total_ha: '' })
    load()
  }
  const salvarArea = async () => {
    if (!companyId || !sel || !areaForm.nome) return
    await supabase.rpc('fn_pec_area_salvar', {
      p_company_id: companyId, p_propriedade_id: sel, p_nome: areaForm.nome, p_tipo: areaForm.tipo,
      p_area_ha: areaForm.area_ha ? Number(areaForm.area_ha) : null,
      p_arrendada_para: areaForm.arrendada_para || null,
    })
    setAreaForm({ nome: '', tipo: 'piquete', area_ha: '', arrendada_para: '' })
    load()
  }

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa especifica no topo do menu para gerenciar propriedades.
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4">
      <h1 className="text-xl font-bold text-[#3D2314]">Propriedades &amp; Áreas</h1>

      <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
        <h2 className="text-sm font-semibold text-[#3D2314]">Nova propriedade</h2>
        <input className={inp} placeholder="Nome (ex.: Fazenda Umuarama)" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <select className={inp} value={form.tipo_operacao} onChange={(e) => setForm({ ...form, tipo_operacao: e.target.value })}>
          <option value="cria">Cria</option>
          <option value="recria">Recria</option>
          <option value="engorda">Engorda</option>
          <option value="semiconfinamento">Semiconfinamento</option>
          <option value="confinamento">Confinamento</option>
          <option value="ciclo_completo">Ciclo completo</option>
        </select>
        <div className="grid grid-cols-3 gap-2">
          <input className={inp} placeholder="Cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
          <input className={inp} placeholder="UF" value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })} />
          <input className={inp} placeholder="Área (ha)" value={form.area_total_ha} onChange={(e) => setForm({ ...form, area_total_ha: e.target.value })} />
        </div>
        <button onClick={salvarProp} className="w-full rounded-xl bg-[#3D2314] text-white p-2 font-semibold">CRIAR propriedade</button>
      </section>

      <section className="space-y-2">
        {props.map((pr) => (
          <button key={pr.id} onClick={() => setSel(pr.id)}
            className={`w-full text-left rounded-2xl p-3 border ${sel === pr.id ? 'border-[#C8941A] bg-white' : 'border-[#E7DECF] bg-white'}`}>
            <div className="font-semibold text-[#3D2314]">{pr.nome}</div>
            <div className="text-xs text-[#3D2314]/60 capitalize">
              {pr.tipo_operacao.replace('_', ' ')} · {pr.cidade ?? ''} {pr.uf ?? ''}
            </div>
          </button>
        ))}
      </section>

      {sel && (
        <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
          <h2 className="text-sm font-semibold text-[#3D2314]">Áreas desta propriedade</h2>
          {areas.map((a) => (
            <div key={a.id} className="flex justify-between text-sm border-b border-[#E7DECF] py-1">
              <span className="text-[#3D2314] capitalize">{a.nome} <span className="text-[#3D2314]/50">({a.tipo.replace('_', ' ')})</span></span>
              <span className="text-[#3D2314]/60">{a.arrendada_para ?? (a.area_ha ? `${a.area_ha} ha` : '')}</span>
            </div>
          ))}
          <div className="pt-2 space-y-2">
            <input className={inp} placeholder="Nome da área (ex.: Piquete 1)" value={areaForm.nome} onChange={(e) => setAreaForm({ ...areaForm, nome: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={areaForm.tipo} onChange={(e) => setAreaForm({ ...areaForm, tipo: e.target.value })}>
                <option value="piquete">Piquete</option>
                <option value="curral_baia">Curral/Baia</option>
                <option value="sede">Sede</option>
                <option value="area_arrendada">Área arrendada</option>
                <option value="mangueira">Mangueira</option>
                <option value="outro">Outro</option>
              </select>
              <input className={inp} placeholder="Área (ha)" value={areaForm.area_ha} onChange={(e) => setAreaForm({ ...areaForm, area_ha: e.target.value })} />
            </div>
            {areaForm.tipo === 'area_arrendada' && (
              <input className={inp} placeholder="Arrendada para (ex.: Soja - terceiro)" value={areaForm.arrendada_para}
                onChange={(e) => setAreaForm({ ...areaForm, arrendada_para: e.target.value })} />
            )}
            <button onClick={salvarArea} className="w-full rounded-xl bg-[#C8941A] text-white p-2 font-semibold">CRIAR área</button>
          </div>
        </section>
      )}
    </div>
  )
}
