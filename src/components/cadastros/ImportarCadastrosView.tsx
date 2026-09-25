'use client'

// IMPORT-CADASTROS · P3 — importação de clientes/fornecedores pela PLANILHA PADRÃO PS.
// Baixar modelo (estático) → subir → PRÉVIA (fn_cadastro_importar_previa, sem gravar) → escolher modo →
// aplicar (fn_cadastro_importar_aplicar). Contrato de colunas: src/lib/cadastros/colunasImportacao.ts
// (linha 4 do xlsx; check-modelo-cadastros quebra o build se divergir). Opcional: completar CNPJ pela
// BrasilAPI (buscarCNPJ), gratuita, só campo vazio. Paleta PS, mobile-first.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Download, Upload, Loader2, CheckCircle2, XCircle, AlertTriangle, Search } from 'lucide-react'
import { CHAVES_CADASTROS, NOME_EXEMPLO, casarColunasCadastros } from '@/lib/cadastros/colunasImportacao'
import { buscarCNPJ } from '@/lib/cadastros/buscarCNPJ'

type Tipo = 'cliente' | 'fornecedor'
type Linha = Record<string, string>
interface PreviaLinha { indice: number; acao: 'criar' | 'atualizar' | 'erro' | 'ignorar'; motivo: string | null; tipo: string }
interface Previa { ok: boolean; erro?: string; total: number; criar: number; atualizar: number; erro_: number; ignorar: number; ambos: number; linhas: PreviaLinha[] }
interface Resultado { criados: number; atualizados: number; ignorados: number; erros: number; criados_cliente: number; criados_fornecedor: number }

const soDig = (s: string) => (s || '').replace(/\D/g, '')

export default function ImportarCadastrosView({ companyId, tipo }: { companyId: string; tipo: Tipo }) {
  const modeloUrl = tipo === 'cliente'
    ? '/modelos/MODELO_importacao_cadastros_PS_clientes.xlsx'
    : '/modelos/MODELO_importacao_cadastros_PS_fornecedores.xlsx'
  const tituloTipo = tipo === 'cliente' ? 'clientes' : 'fornecedores'
  const tipoSugerido = tipo === 'cliente' ? 'Cliente' : 'Fornecedor'

  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [parseErro, setParseErro] = useState<string | null>(null)
  const [soErros, setSoErros] = useState(false)
  const [modo, setModo] = useState<'so_novos' | 'criar_e_atualizar' | 'completar_por_nome'>('criar_e_atualizar')
  const [carregando, setCarregando] = useState(false)
  const [completando, setCompletando] = useState<{ feito: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [avisos, setAvisos] = useState<{ colunasFaltando: string[]; semDoc: number; total: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const rodarPrevia = useCallback(async (ls: Linha[], modoAtual: 'so_novos' | 'criar_e_atualizar' | 'completar_por_nome' = 'criar_e_atualizar') => {
    const { data, error } = await supabase.rpc('fn_cadastro_importar_previa', { p_company: companyId, p_linhas: ls, p_modo: modoAtual })
    if (error) { setParseErro(error.message); return }
    const d = data as Record<string, unknown>
    if (!d?.ok) { setParseErro((d?.erro as string) ?? 'Falha na prévia'); return }
    setPrevia({
      ok: true, total: Number(d.total), criar: Number(d.criar), atualizar: Number(d.atualizar),
      erro_: Number(d.erro), ignorar: Number(d.ignorar), ambos: Number(d.ambos),
      linhas: (d.linhas as PreviaLinha[]) ?? [],
    })
  }, [companyId])

  async function onArquivo(file: File) {
    setParseErro(null); setResultado(null); setPrevia(null); setLinhas([]); setAvisos(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const wsName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('cadastro')) ?? wb.SheetNames[0]
      const matriz = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
      // Cabeçalho = a linha que, casada por ALIAS, reconhece o nome + pelo menos mais 2 colunas.
      // Tolerante a cabeçalhos humanos (MasterKey/Omie/Conta Azul), não só às chaves técnicas do modelo.
      let idxHeader = -1
      let colIndex: Record<string, number> = {}
      for (let r = 0; r < Math.min(matriz.length, 15); r++) {
        const cand = casarColunasCadastros((matriz[r] ?? []).map((c) => String(c ?? '')))
        const reconhecidas = CHAVES_CADASTROS.filter((k) => cand[k] >= 0).length
        if (cand['nome_fantasia'] >= 0 && reconhecidas >= 3) { idxHeader = r; colIndex = cand; break }
      }
      if (idxHeader < 0) { setParseErro('Não reconheci o cabeçalho da planilha. Garanta uma linha de cabeçalho com ao menos Nome e mais duas colunas (ex.: CNPJ, E-mail).'); return }

      const parsed: Linha[] = []
      for (let i = idxHeader + 1; i < matriz.length; i++) {
        const row = matriz[i]
        if (!row || row.every((c) => String(c ?? '').trim() === '')) continue
        const get = (k: string) => { const j = colIndex[k]; return j >= 0 ? String(row[j] ?? '').trim() : '' }
        if (get('nome_fantasia') === NOME_EXEMPLO) continue // linha de exemplo do modelo
        const l: Linha = {}
        for (const k of CHAVES_CADASTROS) l[k] = get(k)
        if (!l.tipo) l.tipo = tipoSugerido    // tela de clientes sugere Cliente; fornecedores, Fornecedor
        parsed.push(l)
      }
      if (parsed.length === 0) { setParseErro('Nenhuma linha de dados (fora a de exemplo).'); return }

      // AVISO na entrada (não bloqueia): coluna importante não reconhecida + registros sem documento.
      // Um campo importante 100% ausente é o sinal de cabeçalho não reconhecido — o que teria evitado
      // a importação de milhares de cadastros sem CNPJ no onboarding da Triches.
      const IMPORTANTES: [string, string][] = [
        ['cpf_cnpj', 'CPF/CNPJ'], ['ie', 'Inscrição estadual'], ['logradouro', 'Endereço'],
        ['cidade', 'Cidade'], ['uf', 'UF'],
      ]
      const colunasFaltando = IMPORTANTES.filter(([k]) => colIndex[k] < 0).map(([, label]) => label)
      const semDoc = parsed.filter((l) => soDig(l.cpf_cnpj).length < 11).length
      setAvisos({ colunasFaltando, semDoc, total: parsed.length })

      setLinhas(parsed); setNomeArquivo(file.name)
      await rodarPrevia(parsed, modo)
    } catch (e) {
      setParseErro((e as Error)?.message ?? 'Falha ao ler o arquivo')
    }
  }

  async function completarPelaReceita() {
    const alvos = linhas.map((l, idx) => ({ l, idx })).filter(({ l }) => soDig(l.cpf_cnpj).length === 14)
    if (alvos.length === 0) return
    setCompletando({ feito: 0, total: alvos.length })
    const novas = linhas.map((l) => ({ ...l }))
    for (let k = 0; k < alvos.length; k++) {
      const { l, idx } = alvos[k]
      const d = await buscarCNPJ(soDig(l.cpf_cnpj))
      if (d) {
        const set = (campo: string, val: string | null) => { if (val && !novas[idx][campo]?.trim()) novas[idx][campo] = String(val) }
        set('razao_social', d.razao_social); set('email', d.email); set('telefone', d.telefone)
        set('cep', d.cep); set('logradouro', d.logradouro); set('numero', d.numero)
        set('bairro', d.bairro); set('complemento', d.complemento); set('cidade', d.cidade); set('uf', d.uf)
        if (!novas[idx].nome_fantasia?.trim()) novas[idx].nome_fantasia = d.nome_fantasia || d.razao_social
      }
      setCompletando({ feito: k + 1, total: alvos.length })
      await new Promise((r) => setTimeout(r, 350))   // limite de ritmo (BrasilAPI gratuita)
    }
    setLinhas(novas); setCompletando(null)
    await rodarPrevia(novas, modo)
  }

  async function aplicar() {
    if (!previa) return
    if (modo === 'completar_por_nome') {
      const ok = window.confirm(
        'Modo CORRIGIR — completar vazios casando por nome\n\n'
        + `• Vou preencher APENAS campos vazios de ${previa.atualizar} cadastro(s) que casaram por nome (CNPJ, IE, endereço…).\n`
        + '• NUNCA sobrescrevo dado já preenchido.\n'
        + '• Não crio cadastros novos neste modo.\n'
        + (previa.erro_ > 0 ? `• ${previa.erro_} cadastro(s) com nome repetido na base ficam DE FORA (marque "Só erros" para revisá-los).\n` : '')
        + '\nConfirmar?'
      )
      if (!ok) return
    }
    setCarregando(true); setResultado(null)
    const { data, error } = await supabase.rpc('fn_cadastro_importar_aplicar', { p_company: companyId, p_linhas: linhas, p_modo: modo })
    setCarregando(false)
    if (error) { setParseErro(error.message); return }
    const d = data as Record<string, unknown>
    if (!d?.ok) { setParseErro((d?.erro as string) ?? 'Falha ao importar'); return }
    setResultado({
      criados: Number(d.criados), atualizados: Number(d.atualizados), ignorados: Number(d.ignorados),
      erros: Number(d.erros), criados_cliente: Number(d.criados_cliente), criados_fornecedor: Number(d.criados_fornecedor),
    })
    await rodarPrevia(linhas, modo)   // reflete o novo estado (agora "atualizar")
  }

  const linhasView = useMemo(() => {
    const ls = previa?.linhas ?? []
    return soErros ? ls.filter((l) => l.acao === 'erro') : ls
  }, [previa, soErros])

  const emoji = (a: string) => (a === 'erro' ? '🔴' : a === 'ignorar' ? '⚪' : a === 'atualizar' ? '🟡' : '🟢')
  const podeImportar = !!previa && !carregando && (previa.criar + previa.atualizar) > 0

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]"><div className="max-w-5xl mx-auto px-4 py-6">
      <header className="mb-5">
        <a href={`/dashboard/cadastros/${tituloTipo}`} className="text-[12px] text-[#3D2314]/60 hover:text-[#3D2314]">← {tituloTipo === 'clientes' ? 'Clientes' : 'Fornecedores'}</a>
        <h1 className="text-[24px] sm:text-[28px] font-medium leading-tight mt-1">Importar {tituloTipo} por planilha</h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5">Baixe a planilha padrão, preencha, confira a prévia e importe. Reimportar não duplica (casa por CPF/CNPJ).</p>
      </header>

      <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4 mb-4 flex flex-wrap items-center gap-3">
        <a href={modeloUrl} download className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#C8941A] text-[#C8941A] hover:bg-[#FFF8E7] flex items-center gap-2">
          <Download size={15} /> Baixar planilha modelo
        </a>
        <button type="button" onClick={() => inputRef.current?.click()} className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-2">
          <Upload size={15} /> {nomeArquivo ? 'Trocar arquivo' : 'Subir planilha'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArquivo(f); e.target.value = '' }} />
        {nomeArquivo && <span className="text-[12px] text-[#3D2314]/60">{nomeArquivo} · {linhas.length} linha(s)</span>}
        {linhas.some((l) => soDig(l.cpf_cnpj).length === 14) && (
          <button type="button" onClick={() => void completarPelaReceita()} disabled={!!completando}
            className="px-3 py-2 text-[12.5px] rounded-lg border border-[#3D2314]/20 text-[#3D2314]/80 hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-2">
            {completando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {completando ? `Completando ${completando.feito}/${completando.total}…` : 'Completar CNPJ pela Receita'}
          </button>
        )}
      </div>

      {parseErro && <div className="mb-4 rounded-lg bg-[#FCEBEB] border border-[#E8A6A5] px-4 py-3 text-[13px] text-[#791F1F]">{parseErro}</div>}

      {avisos && (avisos.colunasFaltando.length > 0 || avisos.semDoc > 0) && (
        <div className="mb-4 rounded-lg bg-[#FFF6E5] border border-[#E7C878] px-4 py-3 text-[13px] text-[#7A5A0F]">
          <div className="flex items-center gap-2 font-medium mb-1"><AlertTriangle size={15} /> Confira antes de importar</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {avisos.colunasFaltando.map((c) => (
              <li key={c}>A coluna <b>{c}</b> não foi reconhecida no arquivo — verifique o cabeçalho.</li>
            ))}
            {avisos.semDoc > 0 && (
              <li><b>{avisos.semDoc}</b> de <b>{avisos.total}</b> registros sem CPF/CNPJ — esses <b>não poderão emitir nota fiscal</b> enquanto o documento não for preenchido.</li>
            )}
          </ul>
          <div className="text-[12px] text-[#7A5A0F]/80 mt-1.5">A importação continua permitida — isto é só um aviso.</div>
        </div>
      )}

      {previa && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            {([['Criar', previa.criar, 'text-[#166534]'], ['Atualizar', previa.atualizar, 'text-[#8A5A00]'], ['Erro', previa.erro_, 'text-[#A32D2D]'], ['Ignorar', previa.ignorar, 'text-[#3D2314]/60'], ['Em ambos', previa.ambos, 'text-[#3D2314]']] as [string, number, string][]).map(([l, v, c]) => (
              <div key={l} className="rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2">
                <div className="text-[11px] text-[#3D2314]/60">{l}</div>
                <div className={`text-[18px] font-medium tabular-nums ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-[#3D2314]/10 overflow-hidden mb-4">
            <div className="px-4 py-2.5 border-b border-[#3D2314]/10 flex items-center justify-between gap-3 flex-wrap text-[12.5px]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[#166534]"><CheckCircle2 size={14} /> {previa.criar} criar</span>
                <span className="inline-flex items-center gap-1 text-[#8A5A00]"><AlertTriangle size={14} /> {previa.atualizar} atualizar</span>
                <span className="inline-flex items-center gap-1 text-[#A32D2D]"><XCircle size={14} /> {previa.erro_} erro(s)</span>
              </div>
              <div className="flex items-center gap-3">
                {previa.erro_ > 0 && (
                  <label className="flex items-center gap-1.5 text-[12px] text-[#3D2314]/75 cursor-pointer">
                    <input type="checkbox" checked={soErros} onChange={(e) => setSoErros(e.target.checked)} className="accent-[#C8941A]" /> Só erros
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-[12px] text-[#3D2314]/75">
                  <select value={modo}
                    onChange={(e) => { const m = e.target.value as 'so_novos' | 'criar_e_atualizar' | 'completar_por_nome'; setModo(m); void rodarPrevia(linhas, m) }}
                    className="border border-[#3D2314]/20 rounded px-2 py-1 text-[12px] bg-white">
                    <option value="criar_e_atualizar">Criar e atualizar</option>
                    <option value="so_novos">Só novos</option>
                    <option value="completar_por_nome">Corrigir: completar vazios (casar por nome)</option>
                  </select>
                </label>
              </div>
            </div>
            {modo === 'completar_por_nome' && (
              <div className="px-4 py-2.5 border-b border-[#3D2314]/10 bg-[#FFF6E5] text-[12.5px] text-[#7A5A0F]">
                <span className="inline-flex items-center gap-1.5 font-medium"><AlertTriangle size={14} /> Modo correção</span>
                {' '}preenche <b>só campos vazios</b> casando por nome (não sobrescreve nada, não cria cadastros).
                Cadastros com <b>nome repetido</b> na base ficam de fora, marcados como erro para revisão manual.
              </div>
            )}
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 sticky top-0"><tr>
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">ação</th>
                  <th className="text-left px-3 py-2 font-medium">tipo</th>
                  <th className="text-left px-3 py-2 font-medium">nome</th>
                  <th className="text-left px-3 py-2 font-medium">CPF/CNPJ</th>
                  <th className="text-left px-3 py-2 font-medium">motivo</th>
                </tr></thead>
                <tbody>
                  {linhasView.map((l) => {
                    const raw = linhas[l.indice - 1] || {}
                    return (
                      <tr key={l.indice} className="border-t border-[#3D2314]/8">
                        <td className="px-3 py-1.5 text-[#3D2314]/50">{l.indice}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{emoji(l.acao)} {l.acao}</td>
                        <td className="px-3 py-1.5">{l.tipo}</td>
                        <td className="px-3 py-1.5 max-w-[220px] truncate">{raw.nome_fantasia}</td>
                        <td className="px-3 py-1.5 font-mono">{raw.cpf_cnpj}</td>
                        <td className="px-3 py-1.5 text-[#A32D2D]">{l.motivo}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[#3D2314]/10 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[12px] text-[#3D2314]/60">{previa.erro_ > 0 ? 'Linhas com erro são ignoradas na importação.' : 'Pronto para importar.'}</span>
              <button type="button" onClick={() => void aplicar()} disabled={!podeImportar}
                className="px-5 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center gap-2">
                {carregando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                Importar {previa.criar + previa.atualizar} cadastro(s)
              </button>
            </div>
          </div>
        </>
      )}

      {resultado && (
        <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4 mb-4">
          <div className="text-[14px] font-medium mb-2 flex items-center gap-2"><CheckCircle2 size={18} className="text-[#3F7012]" /> Importação concluída</div>
          <div className="text-[13px] text-[#3D2314]/80">
            <b>{resultado.criados}</b> criado(s) · <b>{resultado.atualizados}</b> atualizado(s) · <b>{resultado.ignorados}</b> ignorado(s)
            {resultado.erros > 0 && <> · <b className="text-[#A32D2D]">{resultado.erros}</b> com erro</>}
            <br /><span className="text-[12px] text-[#3D2314]/60">clientes gravados: {resultado.criados_cliente} · fornecedores gravados: {resultado.criados_fornecedor}</span>
          </div>
        </div>
      )}
    </div></div>
  )
}
