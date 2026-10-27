// RD-51 (Pdois/Marciana 07/10): tela de P&M sem empresa resolvida DIZ o motivo — nunca "escolha uma empresa" para quem
// só tem uma, nem lista vazia calada. Três casos: ainda carregando; usuário sem empresa ligada; mais de uma empresa e
// nenhuma escolhida no seletor.
export default function EmpresaNaoResolvida({ carregando, temEmpresa, tela }: { carregando: boolean; temEmpresa: boolean; tela: string }) {
  if (carregando) return <div className="p-6 text-[13px] text-[#3D2314]/70" data-testid="pm-empresa-carregando">Carregando a sua empresa…</div>
  if (!temEmpresa) {
    return (
      <div className="m-6 rounded-xl border border-[#791F1F]/25 bg-[#F7E1E1] p-4 text-[13.5px] text-[#791F1F]" role="alert" data-testid="pm-sem-empresa">
        <div className="font-medium">Não encontramos nenhuma empresa ligada ao seu usuário.</div>
        <div className="mt-1">Por isso {tela} não consegue mostrar os jobs. Peça ao administrador da sua empresa para ligar o seu usuário a ela
          (Configurações › Acessos) e entre de novo.</div>
      </div>
    )
  }
  return <div className="p-6 text-[13px] text-[#3D2314]/70" data-testid="pm-escolha-empresa">Escolha uma empresa no seletor do topo para ver {tela}.</div>
}
