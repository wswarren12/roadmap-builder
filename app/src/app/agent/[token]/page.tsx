import { AgentLinkView } from '@/components/AgentLinkView';

export const dynamic = 'force-dynamic';

export default function AgentLinkPage({ params }: { params: { token: string } }) {
  return <AgentLinkView token={params.token} />;
}
