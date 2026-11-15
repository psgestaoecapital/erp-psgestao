'use client'

// Chamado #5452 (Pdois/P&M) · Modelos de contrato — slice 2 (tela), dentro de /dashboard/contratos
// (aba própria, não é tela paralela — RD-96). CRUD dos modelos reutilizáveis de contrato:
//  - listar (fn_contrato_modelo_listar), com alternância "mostrar inativos";
//  - criar/editar (fn_contrato_modelo_salvar — editar gera versão nova e preserva a anterior);
//  - inativar/reativar rastreável (fn_contrato_modelo_inativar).
// RD-26: só consome RPCs JÁ publicadas e guardadas (#3896, migration 20261105005645). Não recria
// o cadastro de contrato — a geração do contrato a partir do modelo (→ erp_contratos.texto_legal) é
// o próximo slice. RD-95: "?" (AjudaCampo) em cada campo/filtro/ação. RLS por company_id nas RPCs.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', espressoD: '#9C8E80', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', danger: '#B4452F' }

interface Modelo {
  id: string
  modelo_grupo: string
  versao: number
  nome: string
  descricao: string | null
  texto: string
  ativo: boolean
  campos_obrigatorios: string[] | null
  atualizado_em: string | null
}

type Variavel = { chave: string; rotulo: string }

type FormState = { id: string | null; nome: string; descricao: string; texto: string; camposObrigatorios: string[] }
const FORM_VAZIO: FormState = { id: null, nome: '', descricao: '', texto: '', camposObrigatorios: [] }

// Extrai as chaves {{campo}} presentes num texto (normaliza {{ campo }} → campo). Usada para só oferecer
// como "obrigatório" os campos que de fato aparecem no modelo.
const chavesNoTexto = (texto: string): Set<string> => {
  const set = new Set<string>()
  for (const m of (texto ?? '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) set.add(m[1])
  return set
}

export default function ContratosModelosPanel({ companyId }: { companyId: string | null }) {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [inativando, setInativando] = useState<Modelo | null>(null)
  const [motivo, setMotivo] = useState('')
  const [variaveis, setVariaveis] = useState<Variavel[]>([])
  const [sugerindoIA, setSugerindoIA] = useState(false)
  const [sugestaoIA, setSugestaoIA] = useState<{ texto: string; campos: { chave: string; rotulo: string; trecho?: string }[] } | null>(null)
  const [avisoIA, setAvisoIA] = useState('')
  // F1b/F1c (#5452) · subir modelo em PDF ou Word (.docx): extrai o texto no navegador e preenche o editor.
  const [extraindoPdf, setExtraindoPdf] = useState(false)
  const [avisoPdf, setAvisoPdf] = useState('')
  const textoRef = useRef<HTMLTextAreaElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setModelos([]); setLoading(false); return }
    setLoading(true); setErro('')
    const { data, error } = await supabase.rpc('fn_contrato_modelo_listar', {
      p_company_id: companyId, p_incluir_inativos: incluirInativos,
    })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar os modelos. Tente de novo.')); setModelos([]); setLoading(false); return }
    setModelos(((data as { modelos?: Modelo[] } | null)?.modelos ?? []) as Modelo[])
    setLoading(false)
  }, [companyId, incluirInativos])

  useEffect(() => { void carregar() }, [carregar])

  // Campos variáveis disponíveis (fn_contrato_modelo_variaveis, sem argumento) — o usuário clica para
  // inserir {{chave}} no texto, em vez de ter de decorar os nomes. Carrega uma vez.
  useEffect(() => {
    let vivo = true
    void supabase.rpc('fn_contrato_modelo_variaveis').then(({ data, error }) => {
      if (!vivo || error || !Array.isArray(data)) return
      setVariaveis(data as Variavel[])
    })
    return () => { vivo = false }
  }, [])

  // Insere {{chave}} na posição do cursor do texto (ou no fim), sem apagar o que já está escrito.
  const inserirVariavel = (chave: string) => {
    if (!form) return
    const token = `{{${chave}}}`
    const el = textoRef.current
    const texto = form.texto ?? ''
    if (el && typeof el.selectionStart === 'number') {
      const ini = el.selectionStart, fim = el.selectionEnd ?? el.selectionStart
      const novo = texto.slice(0, ini) + token + texto.slice(fim)
      setForm({ ...form, texto: novo })
      requestAnimationFrame(() => { el.focus(); const p = ini + token.length; el.setSelectionRange(p, p) })
    } else {
      setForm({ ...form, texto: texto + token })
    }
  }

  const limparSugestaoIA = () => { setSugestaoIA(null); setAvisoIA(''); setAvisoPdf('') }
  const abrirNovo = () => { setErro(''); limparSugestaoIA(); setForm({ ...FORM_VAZIO }) }
  const abrirEdicao = (m: Modelo) => {
    setErro(''); limparSugestaoIA()
    setForm({ id: m.id, nome: m.nome, descricao: m.descricao ?? '', texto: m.texto ?? '', camposObrigatorios: m.campos_obrigatorios ?? [] })
  }
  // Duplicar: abre "Novo modelo" pré-preenchido com o texto/descrição deste (id null → cria um NOVO ao salvar,
  // reusando fn_contrato_modelo_salvar). O original não muda. Leva junto os campos obrigatórios marcados.
  const abrirDuplicacao = (m: Modelo) => {
    setErro(''); limparSugestaoIA()
    setForm({ id: null, nome: `${m.nome} (cópia)`, descricao: m.descricao ?? '', texto: m.texto ?? '', camposObrigatorios: m.campos_obrigatorios ?? [] })
  }

  // F2 (#5452) · marca/desmarca um campo variável como obrigatório (só os campos usados no texto).
  const toggleObrigatorio = (chave: string) => {
    if (!form) return
    const marcado = form.camposObrigatorios.includes(chave)
    setForm({
      ...form,
      camposObrigatorios: marcado
        ? form.camposObrigatorios.filter((c) => c !== chave)
        : [...form.camposObrigatorios, chave],
    })
  }

  // F1 (#5452) · "Sugerir campos com IA": manda o TEXTO atual do editor ao servidor, que propõe onde entram
  // os {{campos}} variáveis (só chaves válidas). Assistivo: nada é salvo; a pessoa confere e aplica. Se a IA
  // estiver indisponível/bloqueada por orçamento, mostra aviso honesto e os botões de campo seguem valendo (RD-102).
  const sugerirCamposIA = async () => {
    if (!form || !companyId) return
    const texto = (form.texto ?? '').trim()
    if (texto.length < 20) { setAvisoIA('Escreva ou cole o texto do modelo antes de pedir a sugestão.'); setSugestaoIA(null); return }
    setSugerindoIA(true); setAvisoIA(''); setSugestaoIA(null)
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch('/api/contratos/modelo/sugerir-campos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
        body: JSON.stringify({ companyId, texto }),
      })
      const j = await r.json().catch(() => ({ ok: false, erro: 'Falha de comunicação com o servidor.' }))
      if (!j.ok) { setAvisoIA(j.erro || 'Não consegui gerar a sugestão. Marque os campos manualmente abaixo.'); return }
      setSugestaoIA({ texto: j.texto_sugerido as string, campos: (j.campos ?? []) as { chave: string; rotulo: string; trecho?: string }[] })
    } catch {
      setAvisoIA('Não consegui falar com o servidor. Marque os campos manualmente abaixo.')
    } finally { setSugerindoIA(false) }
  }
  const aplicarSugestaoIA = () => {
    if (!form || !sugestaoIA) return
    setForm({ ...form, texto: sugestaoIA.texto })
    setSugestaoIA(null); setAvisoIA('')
  }

  // F1b/F1c (#5452) · "Subir modelo (PDF ou Word)": lê o arquivo que a pessoa já usa e extrai o texto
  // NO NAVEGADOR — PDF por pdfjs-dist (worker em /pdf.worker.min.mjs) e Word (.docx) por jszip (o .docx
  // é um .zip com word/document.xml). O texto cai no editor para a pessoa conferir e marcar os campos
  // variáveis. RD-102: arquivo sem texto extraível → aviso honesto para colar à mão; nada é enviado a
  // servidor nem salvo. .doc antigo (binário) não é suportado — salvar como .docx ou PDF antes.
  const MAX_ARQUIVO_BYTES = 20 * 1024 * 1024 // 20 MB

  // PDF → texto (pdfjs). Extrator puro: devolve só o texto (o tratamento comum fica no dispatcher).
  const extrairTextoDePdf = async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const pdfjs = await import('pdfjs-dist')
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    }
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
    } as unknown as Parameters<typeof pdfjs.getDocument>[0])
    const pdf = await loadingTask.promise
    const partes: string[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const linha = (content.items as Array<{ str?: string }>)
        .map((it) => (typeof it.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
      if (linha) partes.push(linha)
    }
    return partes.join('\n\n').trim()
  }

  // Word (.docx) → texto (jszip, já no projeto — RD-26). Preserva parágrafos (<w:p>) e quebras (<w:br>,
  // <w:tab>); títulos viram linhas próprias. Lê só word/document.xml; decodifica as entidades XML.
  const extrairTextoDeDocx = async (file: File): Promise<string> => {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const docXml = zip.file('word/document.xml')
    if (!docXml) return ''
    const xml = await docXml.async('string')
    const decodeEntidades = (s: string) =>
      s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    const paragrafos = xml
      .split(/<\/w:p>/) // cada <w:p> é um parágrafo
      .map((bloco) => {
        const comQuebras = bloco
          .replace(/<w:tab\b[^>]*\/?>/g, '\t')
          .replace(/<w:br\b[^>]*\/?>/g, '\n')
        const textos = comQuebras.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) ?? []
        return decodeEntidades(
          textos.map((t) => t.replace(/<[^>]+>/g, '')).join(''),
        ).replace(/[ \t]+/g, ' ').trim()
      })
      .filter((linha) => linha.length > 0)
    return paragrafos.join('\n').trim()
  }

  // Dispatcher: valida tamanho/formato, chama o extrator certo e trata o resultado de forma única.
  const extrairTextoDoArquivo = async (file: File) => {
    setAvisoPdf('')
    const nome = (file.name || '').toLowerCase()
    const ehPdf = file.type === 'application/pdf' || nome.endsWith('.pdf')
    const ehDocx =
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      nome.endsWith('.docx')
    if (!ehPdf && !ehDocx) {
      setAvisoPdf(
        nome.endsWith('.doc')
          ? 'Word antigo (.doc) não é lido direto. Abra no Word e salve como .docx (ou PDF) e suba de novo.'
          : 'Formato não suportado. Suba um PDF ou um Word (.docx).',
      )
      return
    }
    if (file.size > MAX_ARQUIVO_BYTES) {
      setAvisoPdf('Arquivo muito grande (máx. 20 MB). Suba um arquivo menor ou cole o texto à mão.')
      return
    }
    setExtraindoPdf(true)
    try {
      const texto = ehPdf ? await extrairTextoDePdf(file) : await extrairTextoDeDocx(file)
      if (!texto) {
        // RD-102 · sem texto extraível (PDF digitalizado/foto, ou .docx só com imagem).
        setAvisoPdf(
          ehPdf
            ? 'Este PDF não tem texto selecionável (parece digitalizado/foto). Cole o texto do contrato à mão no campo abaixo.'
            : 'Não encontrei texto neste Word. Se o contrato for só imagem, cole o texto à mão no campo abaixo.',
        )
        return
      }
      setForm((f) => {
        if (!f) return f
        const atual = (f.texto ?? '').trim()
        // Não apaga o que já estava escrito: anexa ao final com uma separação.
        const novo = atual ? `${atual}\n\n${texto}` : texto
        return { ...f, texto: novo }
      })
      setAvisoPdf(`Texto extraído de "${file.name}". Confira abaixo e marque os campos variáveis.`)
    } catch {
      setAvisoPdf('Não consegui ler este arquivo. Verifique se é um PDF ou Word (.docx) válido, ou cole o texto à mão.')
    } finally {
      setExtraindoPdf(false)
      if (pdfInputRef.current) pdfInputRef.current.value = '' // permite subir o mesmo arquivo de novo
    }
  }

  const salvar = async () => {
    if (!companyId || !form) return
    if (!form.nome.trim()) { setErro('Informe o nome do modelo.'); return }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('fn_contrato_modelo_salvar', {
      p_company_id: companyId,
      p_nome: form.nome.trim(),
      p_texto: form.texto ?? '',
      p_descricao: form.descricao.trim() || null,
      p_id: form.id,
    })
    if (error) { setSalvando(false); setErro(erroAmigavel(error, 'Não foi possível salvar o modelo. Tente de novo.')); return }

    // F2 (#5452): persiste os campos obrigatórios na versão recém-salva (só os que seguem presentes no texto).
    // Chamada à parte e best-effort: o save acima já funciona mesmo antes desta migration chegar à produção —
    // se a RPC ainda não existir no ambiente, a marcação apenas não é gravada (nasce desligada, não regride).
    const novoId = (data as { id?: string } | null)?.id
    if (novoId) {
      const usadas = chavesNoTexto(form.texto ?? '')
      const campos = form.camposObrigatorios.filter((c) => usadas.has(c))
      await supabase.rpc('fn_contrato_modelo_campos_obrigatorios_definir', {
        p_company_id: companyId,
        p_modelo_id: novoId,
        p_campos: campos,
      })
    }
    setSalvando(false)
    setForm(null)
    await carregar()
  }

  const confirmarInativacao = async () => {
    if (!inativando) return
    if (!motivo.trim()) { setErro('Informe o motivo da inativação.'); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('fn_contrato_modelo_inativar', {
      p_id: inativando.id, p_ativo: false, p_motivo: motivo.trim(),
    })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível inativar o modelo. Tente de novo.')); return }
    setInativando(null); setMotivo('')
    await carregar()
  }

  const reativar = async (m: Modelo) => {
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('fn_contrato_modelo_inativar', {
      p_id: m.id, p_ativo: true, p_motivo: null,
    })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível reativar o modelo. Tente de novo.')); return }
    await carregar()
  }

  if (!companyId) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: C.espressoM, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        Selecione uma única empresa (no topo) para gerenciar os modelos de contrato dela.
      </div>
    )
  }

  return (
    <div>
      {/* Cabeçalho da aba */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: C.espresso, margin: 0 }}>Modelos de contrato</h2>
          <p style={{ fontSize: 12.5, color: C.espressoM, margin: '4px 0 0', maxWidth: 560, lineHeight: 1.45 }}>
            Textos-padrão reutilizáveis. Escreva uma vez com campos variáveis <code style={{ background: C.cream, padding: '1px 5px', borderRadius: 4 }}>{'{{campo}}'}</code> e reaproveite em cada contrato.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.espressoM, cursor: 'pointer' }}>
            <input type="checkbox" checked={incluirInativos} onChange={(e) => setIncluirInativos(e.target.checked)} />
            Mostrar inativos <AjudaCampo chave="ge.contrato.modelo.incluir_inativos" />
          </label>
          <button onClick={abrirNovo} style={btnPrimary}>
            + Novo modelo <AjudaCampo chave="ge.contrato.modelo.novo" />
          </button>
        </div>
      </div>

      {erro && !form && !inativando && (
        <div style={alertErro}>{erro}</div>
      )}

      {/* Lista */}
      {loading ? (
        <div style={{ padding: 24, color: C.espressoM }}>Carregando…</div>
      ) : modelos.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: C.espressoM, background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          Nenhum modelo ainda. Clique em <b>“+ Novo modelo”</b> para criar o primeiro texto-padrão.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {modelos.map((m) => (
            <div key={m.id} style={{ ...card, opacity: m.ativo ? 1 : 0.72 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.espresso }}>{m.nome}</span>
                    <span style={verChip}>v{m.versao} <AjudaCampo chave="ge.contrato.modelo.versao" /></span>
                    {!m.ativo && <span style={inativoChip}>inativo</span>}
                  </div>
                  {m.descricao && <div style={{ fontSize: 12.5, color: C.espressoM, marginTop: 4 }}>{m.descricao}</div>}
                  <div style={{ fontSize: 12, color: C.espressoD, marginTop: 6, lineHeight: 1.4, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                    {m.texto ? m.texto.slice(0, 220) + (m.texto.length > 220 ? '…' : '') : <i>(sem texto)</i>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button onClick={() => abrirEdicao(m)} style={btnSec}>
                    Editar <AjudaCampo chave="ge.contrato.modelo.editar" />
                  </button>
                  <button onClick={() => abrirDuplicacao(m)} style={btnSec}>
                    Duplicar <AjudaCampo chave="ge.contrato.modelo.duplicar" />
                  </button>
                  {m.ativo ? (
                    <button onClick={() => { setErro(''); setMotivo(''); setInativando(m) }} style={btnDanger}>
                      Inativar <AjudaCampo chave="ge.contrato.modelo.inativar" />
                    </button>
                  ) : (
                    <button onClick={() => void reativar(m)} disabled={salvando} style={btnSec}>
                      Reativar <AjudaCampo chave="ge.contrato.modelo.reativar" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {form && (
        <div style={overlay} onClick={() => !salvando && setForm(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: C.espresso, margin: '0 0 2px' }}>
              {form.id ? 'Editar modelo' : 'Novo modelo'}
            </h3>
            {form.id && (
              <p style={{ fontSize: 11.5, color: C.espressoM, margin: '0 0 12px' }}>
                Ao salvar, uma versão nova é criada e a anterior fica guardada — contratos já gerados não mudam.
              </p>
            )}
            <label style={lbl}>
              <span style={lblTxt}>Nome <span style={{ color: C.gold }}>*</span> <AjudaCampo chave="ge.contrato.modelo.nome" /></span>
              <input autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} placeholder="Ex.: Fee mensal — marketing" />
            </label>

            <label style={lbl}>
              <span style={lblTxt}>Descrição <AjudaCampo chave="ge.contrato.modelo.descricao" /></span>
              <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} style={inp} placeholder="Quando usar este modelo (opcional)" />
            </label>

            <label style={lbl}>
              <span style={lblTxt}>Texto do modelo <AjudaCampo chave="ge.contrato.modelo.texto" /></span>
              <textarea ref={textoRef} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} style={{ ...inp, minHeight: 200, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                placeholder={'Escreva o contrato. Use campos variáveis entre chaves duplas, ex.: {{cliente_nome}}, {{cliente_cnpj}}, {{valor}}, {{data_inicio}}.'} />
            </label>

            {variaveis.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span style={lblTxt}>Campos variáveis — clique para inserir no texto <AjudaCampo chave="ge.contrato.modelo.variaveis" /></span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {variaveis.map((v) => (
                    <button key={v.chave} type="button" onClick={() => inserirVariavel(v.chave)} style={chipVar} title={`Inserir {{${v.chave}}}`}>
                      {v.rotulo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* F2 (#5452): marcar campos obrigatórios — só os campos variáveis que já aparecem no texto. */}
            {(() => {
              const usadas = chavesNoTexto(form.texto ?? '')
              const camposUsados = variaveis.filter((v) => usadas.has(v.chave))
              if (camposUsados.length === 0) return null
              return (
                <div style={{ marginTop: 12 }}>
                  <span style={lblTxt}>
                    Campos obrigatórios — clique para exigir o preenchimento <AjudaCampo chave="ge.contrato.modelo.campos_obrigatorios" />
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {camposUsados.map((v) => {
                      const on = form.camposObrigatorios.includes(v.chave)
                      return (
                        <button
                          key={v.chave}
                          type="button"
                          onClick={() => toggleObrigatorio(v.chave)}
                          aria-pressed={on}
                          style={on ? chipObrigOn : chipVar}
                          title={on ? 'Obrigatório — clique para tornar opcional' : 'Opcional — clique para exigir o preenchimento'}
                        >
                          {on && <span style={{ color: C.gold, fontWeight: 700, marginRight: 4 }}>*</span>}{v.rotulo}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.espressoM, marginTop: 6 }}>
                    Os campos com <span style={{ color: C.gold, fontWeight: 700 }}>*</span> precisarão estar preenchidos ao gerar o contrato com este modelo.
                  </div>
                </div>
              )
            })()}

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                style={{ display: 'none' }}
                onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void extrairTextoDoArquivo(fl) }}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button type="button" onClick={() => pdfInputRef.current?.click()} disabled={extraindoPdf} style={{ ...btnSec, cursor: extraindoPdf ? 'wait' : 'pointer' }}>
                  {extraindoPdf ? 'Lendo o arquivo…' : '📄 Subir modelo (PDF ou Word)'}
                </button>
                <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}><AjudaCampo chave="ge.contrato.modelo.subir_arquivo" /></span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button type="button" onClick={() => void sugerirCamposIA()} disabled={sugerindoIA} style={{ ...btnSec, borderColor: C.gold, cursor: sugerindoIA ? 'wait' : 'pointer' }}>
                  {sugerindoIA ? 'Analisando o texto…' : '✨ Sugerir campos com IA'}
                </button>
                <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}><AjudaCampo chave="ge.contrato.modelo.sugerir_ia" /></span>
              </span>
            </div>
            {avisoPdf && <div style={{ marginTop: 8, padding: '8px 12px', fontSize: 12, color: C.espressoM, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 8 }}>{avisoPdf}</div>}
            {avisoIA && <div style={{ marginTop: 8, padding: '8px 12px', fontSize: 12, color: C.espressoM, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 8 }}>{avisoIA}</div>}
            {sugestaoIA && (
              <div style={{ marginTop: 10, padding: 12, border: `1px solid ${C.gold}`, borderRadius: 8, background: 'rgba(200,148,26,0.06)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.espresso, marginBottom: 6 }}>
                  {sugestaoIA.campos.length > 0 ? `Encontrei ${sugestaoIA.campos.length} campo(s) para marcar:` : 'Nenhum campo variável identificado — o texto já parece sem dados que mudam por contrato.'}
                </div>
                {sugestaoIA.campos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {sugestaoIA.campos.map((c, i) => (
                      <span key={i} style={{ ...chipVar, cursor: 'default' }} title={c.trecho ? `No texto: ${c.trecho}` : undefined}>{c.rotulo}</span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: C.espressoM, marginBottom: 8 }}>Confira a prévia abaixo. Nada é salvo até você clicar em “Aplicar ao texto” e depois em “Salvar”.</div>
                <div style={{ maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, color: C.espresso, background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, lineHeight: 1.5 }}>{sugestaoIA.texto}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" onClick={aplicarSugestaoIA} style={btnPrimary}>Aplicar ao texto</button>
                  <button type="button" onClick={() => setSugestaoIA(null)} style={btnSec}>Descartar</button>
                </div>
              </div>
            )}

            {erro && <div style={alertErro}>{erro}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={() => setForm(null)} disabled={salvando} style={btnSec}>Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal inativar (motivo obrigatório) */}
      {inativando && (
        <div style={overlay} onClick={() => !salvando && setInativando(null)}>
          <div style={{ ...modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: C.espresso, margin: '0 0 6px' }}>Inativar “{inativando.nome}”</h3>
            <p style={{ fontSize: 12.5, color: C.espressoM, margin: '0 0 12px' }}>
              O modelo sai de uso mas continua guardado (rastreável) e pode ser reativado depois.
            </p>
            <label style={lbl}>
              <span style={lblTxt}>Motivo <span style={{ color: C.gold }}>*</span> <AjudaCampo chave="ge.contrato.modelo.inativar" /></span>
              <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} style={inp} placeholder="Ex.: substituído pelo modelo novo" />
            </label>
            {erro && <div style={alertErro}>{erro}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={() => setInativando(null)} disabled={salvando} style={btnSec}>Cancelar</button>
              <button onClick={() => void confirmarInativacao()} disabled={salvando} style={btnDanger}>{salvando ? 'Inativando…' : 'Inativar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const btnBase: CSSProperties = { padding: '8px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid transparent' }
const btnPrimary: CSSProperties = { ...btnBase, background: C.espresso, color: C.white }
const btnSec: CSSProperties = { ...btnBase, background: C.white, color: C.espresso, border: `1px solid ${C.border}` }
const btnDanger: CSSProperties = { ...btnBase, background: C.white, color: C.danger, border: `1px solid ${C.danger}` }
const card: CSSProperties = { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }
const verChip: CSSProperties = { fontSize: 11, fontWeight: 600, color: C.espressoM, background: C.cream, borderRadius: 999, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }
const chipVar: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: C.espresso, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 999, padding: '4px 10px', cursor: 'pointer' }
const chipObrigOn: CSSProperties = { ...chipVar, background: C.white, color: C.espresso, border: `1.5px solid ${C.gold}` }
const inativoChip: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.espressoD, background: '#EFE8DE', borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.4 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(40,25,12,0.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60 }
const modal: CSSProperties = { background: C.white, borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(40,25,12,0.25)' }
const lbl: CSSProperties = { display: 'block', margin: '12px 0 0' }
const lblTxt: CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: C.espressoM, marginBottom: 4 }
const inp: CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.espresso, background: C.white, boxSizing: 'border-box' }
const alertErro: CSSProperties = { marginTop: 12, padding: '9px 12px', fontSize: 12.5, color: C.danger, background: '#FBEEEA', border: `1px solid ${C.danger}`, borderRadius: 8 }
