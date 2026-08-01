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
}
