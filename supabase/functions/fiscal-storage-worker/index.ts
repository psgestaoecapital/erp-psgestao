// fiscal-storage-worker — arquiva XML/PDF das notas emitidas (NFS-e/NF-e) no bucket fiscal-xmls (GE-F7, 11 anos).
// Chamado pelo cron fn_fiscal_storage_dispatch (Bearer service_role). Até 07/10 só existia deployado (versão 8);
// entra no repo com o #1881 para ser versionado e deployado pelo deploy-functions.yml.
//
// #1881 (ressalva do Eng. Chefe): a Focus pode mandar o caminho RELATIVO ("/arquivos/..."), e o webhook grava o
// caminho como veio quando não sabe o ambiente da nota. Ao baixar, caminho relativo é absolutizado pela base do
// AMBIENTE DA NOTA lido agora (_shared/focusUrl.ts, a mesma regra do webhook — RD-65/RD-71). Sem ambiente,
// não adivinha: falha com motivo claro em vez de baixar do ambiente errado. Nota antiga com URL relativa volta a arquivar.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { ehCaminhoRelativo, focusUrlAbsoluta } from "../_shared/focusUrl.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

interface PendenteRow {
  tabela: "nfse" | "nfe"
  doc_id: string
  company_id: string
  numero: string | null
  xml_url: string | null
  pdf_url: string | null
  data_emissao: string | null
}

function buildStoragePath(
  tabela: "nfse" | "nfe",
  companyId: string,
  dataEmissao: string | null,
  docId: string,
  ext: "xml" | "pdf"
): string {
  const dt = dataEmissao ? new Date(dataEmissao) : new Date()
  const ano = dt.getUTCFullYear()
  const mes = String(dt.getUTCMonth() + 1).padStart(2, "0")
  return `${companyId}/${ano}/${mes}/${tabela}/${docId}.${ext}`
}

// Ambiente da nota (producao/homologacao) lido no momento do download.
async function ambienteDaNota(tabela: "nfse" | "nfe", docId: string): Promise<string | null> {
  const { data } = await supabase
    .from(tabela === "nfse" ? "erp_nfse_emitidas" : "erp_nfe_emitidas")
    .select("ambiente")
    .eq("id", docId)
    .maybeSingle()
  return (data as { ambiente?: string | null } | null)?.ambiente ?? null
}

async function baixarEArquivar(pendente: PendenteRow): Promise<{ ok: boolean; erro?: string }> {
  const { tabela, doc_id, company_id, data_emissao } = pendente
  let { xml_url, pdf_url } = pendente

  if (!xml_url) return { ok: false, erro: "xml_url ausente" }

  try {
    // #1881: caminho relativo → URL completa pela base do ambiente DA NOTA
    if (ehCaminhoRelativo(xml_url) || ehCaminhoRelativo(pdf_url)) {
      const ambiente = await ambienteDaNota(tabela, doc_id)
      xml_url = focusUrlAbsoluta(xml_url, ambiente)
      pdf_url = focusUrlAbsoluta(pdf_url, ambiente)
      if (ehCaminhoRelativo(xml_url)) {
        return { ok: false, erro: "URL relativa da Focus e ambiente da nota desconhecido (não adivinha a base)" }
      }
    }

    // Download XML
    const xmlResp = await fetch(xml_url!)
    if (!xmlResp.ok) return { ok: false, erro: `XML download HTTP ${xmlResp.status}` }
    const xmlBytes = new Uint8Array(await xmlResp.arrayBuffer())

    const xmlPath = buildStoragePath(tabela, company_id, data_emissao, doc_id, "xml")
    const { error: xmlUpErr } = await supabase.storage
      .from("fiscal-xmls")
      .upload(xmlPath, xmlBytes, {
        contentType: "application/xml",
        upsert: true
      })

    if (xmlUpErr) return { ok: false, erro: `XML upload: ${xmlUpErr.message}` }

    // Download PDF/DANFE (opcional · pode ainda não estar disponível)
    let pdfPath: string | null = null
    if (pdf_url && !ehCaminhoRelativo(pdf_url)) {
      const pdfResp = await fetch(pdf_url)
      if (pdfResp.ok) {
        const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer())
        pdfPath = buildStoragePath(tabela, company_id, data_emissao, doc_id, "pdf")
        const { error: pdfUpErr } = await supabase.storage
          .from("fiscal-xmls")
          .upload(pdfPath, pdfBytes, {
            contentType: "application/pdf",
            upsert: true
          })
        if (pdfUpErr) {
          // PDF é não-crítico · loga mas não falha
          console.warn(`PDF upload falhou (${doc_id}): ${pdfUpErr.message}`)
          pdfPath = null
        }
      }
    }

    // Atualiza referências no banco
    const { data: marcado } = await supabase.rpc("fn_fiscal_marcar_xml_armazenado", {
      p_tabela: tabela,
      p_doc_id: doc_id,
      p_xml_storage_path: xmlPath,
      p_pdf_storage_path: pdfPath
    })

    if (!marcado?.ok) return { ok: false, erro: "fn_fiscal_marcar_xml_armazenado falhou" }

    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}

Deno.serve(async (req: Request) => {
  // Aceita GET (cron) ou POST (manual)
  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get("limit") || "50")

  // Lista pendentes
  const { data: pendentes, error: listErr } = await supabase.rpc(
    "fn_fiscal_listar_pendentes_storage",
    { p_limit: limit }
  )

  if (listErr) {
    return new Response(
      JSON.stringify({ ok: false, erro: listErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }

  const resultados = {
    total: pendentes?.length || 0,
    sucessos: 0,
    falhas: 0,
    detalhes: [] as Array<{ doc_id: string; tabela: string; ok: boolean; erro?: string }>
  }

  for (const p of (pendentes || []) as PendenteRow[]) {
    const r = await baixarEArquivar(p)

    await supabase.rpc("fn_fiscal_storage_marcar_processado", {
      p_tabela: p.tabela,
      p_doc_id: p.doc_id,
      p_sucesso: r.ok,
      p_erro: r.erro ?? null
    })

    if (r.ok) resultados.sucessos++
    else resultados.falhas++

    resultados.detalhes.push({
      doc_id: p.doc_id,
      tabela: p.tabela,
      ok: r.ok,
      erro: r.erro
    })
  }

  return new Response(JSON.stringify({ ok: true, ...resultados }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
})
