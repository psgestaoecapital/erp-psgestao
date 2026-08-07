// Cabeçalho da empresa (logo + dados fiscais) — MESMO componente na visualização e na impressão da OS,
// pra garantir que o que aparece na tela sai no papel (RD-51). Dados vêm por company_id (fn_os_imprimir_dados);
// nada hardcoded. Logo à esquerda quando houver; sem logo, cai pro nome (não quebra). Só mostra os campos
// que existem (CNPJ/IE/IM/endereço podem faltar — RD-51: não inventar).

export type EmpresaHeader = {
  nome?: string | null
  razao_social?: string | null
  cnpj?: string | null
  ie?: string | null
  im?: string | null
  endereco?: string | null
  cidade_estado?: string | null
  logo?: string | null
}

export default function OSHeaderEmpresa({ empresa }: { empresa: EmpresaHeader }) {
  const e = empresa ?? {}
  const local = [e.endereco, e.cidade_estado].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      {e.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.logo} alt="Logomarca" style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain' }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#3D2314' }}>{e.nome ?? e.razao_social ?? '—'}</div>
        {e.razao_social && e.razao_social !== e.nome && <div style={{ fontSize: 11, color: '#6B5D4F' }}>{e.razao_social}</div>}
        <div style={{ fontSize: 10, color: '#6B5D4F', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
          {e.cnpj && <span>CNPJ: {e.cnpj}</span>}
          {e.ie && <span>IE: {e.ie}</span>}
          {e.im && <span>IM: {e.im}</span>}
        </div>
        {local && <div style={{ fontSize: 10, color: '#6B5D4F', marginTop: 2 }}>{local}</div>}
      </div>
    </div>
  )
}
