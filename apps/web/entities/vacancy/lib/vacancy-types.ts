export interface Vacancy {
  sourceId: number;
  externalId: string;
  title: string;
  company: string | null;
  url: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  description?: string | null;
  location?: string | null;
  isRemote?: boolean | null;
  skillsSummary?: string | null;
  specialization?: string | null;
  seniority?: string | null;
  /** Only present on Search page results with an active free-text query (`q`) - the Source detail
   * page's vacancy list never has one. See queryVacancies.ts's VacancyHighlight. */
  highlight?: {
    title?: string;
    company?: string;
    description?: string;
  };
}
