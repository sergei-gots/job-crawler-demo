import { SourceDetailPage } from "@/widgets/source-detail";
import { Sidebar } from "@/widgets/sidebar";

export default async function SourceDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <SourceDetailPage sourceId={Number(id)} />
    </div>
  );
}
