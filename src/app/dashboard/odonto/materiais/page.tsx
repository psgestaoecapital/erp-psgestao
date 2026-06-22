import OdontoEmptyState from '@/components/odonto/OdontoEmptyState';
import { Package } from 'lucide-react';

export default function Page() {
  return (
    <OdontoEmptyState
      eyebrow="Clínica Odontológica · Processo"
      title="Materiais e Próteses"
      subtitle="Estoque clínico e laboratório no controle."
      Icon={Package}
      cta="Adicionar material"
      features={[
        { title: 'Estoque clínico', desc: 'Entradas, saídas e alerta de reposição automático.' },
        { title: 'Controle de protético', desc: 'Acompanhe cada trabalho enviado ao laboratório.' },
        { title: 'Vínculo com o tratamento', desc: 'Material e prótese ligados ao paciente e ao plano.' },
        { title: 'Custo por procedimento', desc: 'Saiba quanto cada material pesa na sua margem.' },
      ]}
    />
  );
}
