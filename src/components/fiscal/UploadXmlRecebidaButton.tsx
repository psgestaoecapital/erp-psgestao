'use client'

// nfe-recebida-upload-xml · Sobe o XML do fornecedor e completa a nota sem esperar a SEFAZ.
// Chama fn_nfe_recebida_upload_xml direto do browser — a função faz sua própria autorização
// (auth.uid() + get_user_company_ids) e reusa a MESMA fn_nfe_recebida_aplicar_xml do SEFAZ.
// Caso A: nota já em aguardando_xml → completa. Caso B: nota não existe → o upload cria.

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  companyId: string | null
  onDone?: () => void
}

interface RpcResp {
  ok: boolean
  erro?: string
  motivo?: string
  valor_xml?: number
  valor_resumo?: number
  xml_atual_origem?: string
  cnpj_no_xml?: string
  cnpj_empresa?: string
  caso?: string
  criada?: boolean
  itens?: number
  duplicatas?: number
}

const fmtBRL = (v?: number) =>
  'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function UploadXmlRecebidaButton({ companyId, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  async function chamar(xml: string, aceiteSobre: boolean, aceiteDiv: boolean): Promise<RpcResp> {
    const { data, error } = await supabase.rpc('fn_nfe_recebida_upload_xml', {
      p_company_id: companyId,
      p_xml: xml,
      p_aceite_sobrescrever: aceiteSobre,
      p_aceite_divergencia: aceiteDiv,
    })
    if (error) return { ok: false, erro: error.message }
    return (data ?? { ok: false, erro: 'sem resposta' }) as RpcResp
  }

  async function processar(xml: string) {
    setEnviando(true)
    try {
      let aceiteSobre = false
      let aceiteDiv = false
      // no máximo 3 rodadas: cada aceite (sobrescrever, divergência) libera uma nova tentativa
      for (let i = 0; i < 3; i++) {
        const r = await chamar(xml, aceiteSobre, aceiteDiv)
        if (r.ok) {
          alert(
            `XML aplicado — nota ${r.criada ? 'criada' : 'completada'} ` +
            `(${r.itens ?? 0} ${r.itens === 1 ? 'item' : 'itens'}, ${r.duplicatas ?? 0} ` +
            `${r.duplicatas === 1 ? 'duplicata' : 'duplicatas'}).`
          )
          onDone?.()
          return
        }
        if (r.erro === 'requer_aceite' && r.motivo === 'sobrescrever_sefaz' && !aceiteSobre) {
          if (!confirm(
            `Esta nota já tem XML do SEFAZ (origem: ${r.xml_atual_origem ?? 'sefaz'}). ` +
            `Sobrescrever com o arquivo enviado?`
          )) return
          aceiteSobre = true
          continue
        }
        if (r.erro === 'requer_aceite' && r.motivo === 'divergencia_valor' && !aceiteDiv) {
          if (!confirm(
            `O valor do XML (${fmtBRL(r.valor_xml)}) diverge do resumo do SEFAZ ` +
            `(${fmtBRL(r.valor_resumo)}). Pode ser ajuste legítimo. Aceitar mesmo assim?`
          )) return
          aceiteDiv = true
          continue
        }
        // erros finais
        const msg =
          r.erro === 'cnpj_destinatario_diverge'
            ? `O XML é destinado a outro CNPJ (${r.cnpj_no_xml}), não ao da empresa (${r.cnpj_empresa}). Recusado.`
            : r.erro === 'chave_invalida'
              ? 'A chave de acesso do XML é inválida (44 dígitos + verificador). Recusado.'
              : r.erro === 'xml_invalido'
                ? 'O arquivo não é um XML de NF-e válido.'
                : r.erro === 'empresa_sem_cnpj'
                  ? 'A empresa selecionada não tem CNPJ cadastrado.'
                  : r.erro === 'sem_acesso'
                    ? 'Sem acesso a esta empresa.'
                    : r.erro === 'aplicar_xml_falhou'
                      ? 'O XML foi validado mas falhou ao gravar. Tente novamente.'
                      : (r.erro ?? 'Falha ao aplicar o XML.')
        alert(msg)
        return
      }
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const txt = await file.text()
      await processar(txt)
    } catch {
      alert('Não foi possível ler o arquivo.')
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        hidden
        onChange={(e) => void onFile(e)}
      />
      <button
        type="button"
        disabled={enviando || !companyId}
        onClick={() => inputRef.current?.click()}
        title="Sobe o XML do fornecedor e completa a nota sem esperar a SEFAZ (cria a nota se ainda não existir)"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#3D2314]/15 text-[12px] font-medium text-[#3D2314]/70 hover:bg-[#3D2314]/5 disabled:opacity-50 min-h-[44px]"
      >
        {enviando ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
        {enviando ? 'Subindo…' : 'Subir XML'}
      </button>
    </>
  )
}
