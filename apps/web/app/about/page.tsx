import { About } from "@/widgets/about";
import { Sidebar } from "@/widgets/sidebar";

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <About />
    </div>
  );
}
