import { SubcalendarView } from '@/components/SubcalendarView';

export const dynamic = 'force-dynamic';

export default function ItemPage({
  params,
}: {
  params: { id: string; itemId: string };
}) {
  return <SubcalendarView roadmapId={params.id} itemId={params.itemId} />;
}
