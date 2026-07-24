import { RoadmapView } from '@/components/RoadmapView';

export const dynamic = 'force-dynamic';

export default function RoadmapPage({ params }: { params: { id: string } }) {
  return <RoadmapView roadmapId={params.id} />;
}
