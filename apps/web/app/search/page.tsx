import { SearchPage } from "@/widgets/search";
import { Sidebar } from "@/widgets/sidebar";

export default function Search() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <SearchPage />
    </div>
  );
}
