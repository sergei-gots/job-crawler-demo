export interface FacetBucket {
  value: string;
  count: number;
}

export interface VacancySearchFacets {
  specialization: FacetBucket[];
  seniority: FacetBucket[];
  isRemote: FacetBucket[];
  location: FacetBucket[];
  company: FacetBucket[];
}

export interface VacancySearchFilters {
  q?: string;
  specialization?: string[];
  seniority?: string[];
  isRemote?: boolean[];
  location?: string[];
  company?: string[];
}
