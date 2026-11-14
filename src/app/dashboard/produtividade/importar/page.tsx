'use client'

// Produtividade Industrial · Importar quadro por planilha (CEO 08/11, c1e941c5). Página fina: toda a lógica
// (baixar modelo .xlsx pré-preenchido com exemplo DEMO + subir e abastecer via fn_rh_importar_postos) vive no
// componente ImportarPostosView. RD-26: reusa a RPC já publicada e guardada; não altera backend.

import { ImportarPostosView } from '@/components/produtividade/ImportarPostosView'

export default function ImportarPostosPage() {
  return <ImportarPostosView />
}
