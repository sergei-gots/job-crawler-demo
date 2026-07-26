import { CrawlerJobDetailPage } from "@/widgets/crawler-job-detail";
import { Sidebar } from "@/widgets/sidebar";

export default async function CrawlerJobDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <CrawlerJobDetailPage jobId={Number(id)} />
    </div>
  );
}
