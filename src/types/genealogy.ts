export type VerificationStatus = 'confirmed' | 'possible' | 'unverified';

export type Gender = 'male' | 'female' | 'other';

export type EventType =
  | 'birth'
  | 'death'
  | 'marriage'
  | 'divorce'
  | 'baptism'
  | 'migration'
  | 'education'
  | 'career'
  | 'award'
  | 'residence'
  | 'custom';

export interface DocumentAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}

export interface LifeEvent {
  id: string;
  type: EventType;
  title: string;
  date: string;
  place?: string;
  description?: string;
  verification: VerificationStatus;
  documents?: DocumentAttachment[];
}

export interface PhotoCrop {
  x: number; // percent offset -50..50
  y: number; // percent offset -50..50
  zoom: number; // scale 1..3
}

export type ArchiveCategory =
  | 'portrait'
  | 'group'
  | 'documents'
  | 'letters'
  | 'certificates'
  | 'places'
  | 'other';

export interface PhotoPersonTag {
  id: string;
  personId: string;
  x: number; // left % 0..100 (or legacy center % when w/h omitted)
  y: number; // top % 0..100 (or legacy center % when w/h omitted)
  w?: number; // width % 0..100
  h?: number; // height % 0..100
}

export interface PhotoAttachment {
  id: string;
  dataUrl: string;
  caption?: string;
  year?: string;
  date?: string;
  place?: string;
  category?: ArchiveCategory;
  customTags?: string[];
  archiveRef?: string;
  notes?: string;
  isPrimary?: boolean;
  crop?: PhotoCrop;
  tags?: PhotoPersonTag[];
}

export interface Person {
  id: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  maidenName?: string;
  gender: Gender;
  birthDate?: string;
  birthPlace?: string;
  birthDocuments?: DocumentAttachment[];
  deathDate?: string;
  deathPlace?: string;
  deathDocuments?: DocumentAttachment[];
  isLiving?: boolean;
  occupation?: string;
  notes: string;
  verification: VerificationStatus;
  events: LifeEvent[];
  photos: PhotoAttachment[];
  customPos?: { x: number; y: number };
  customPositions?: Partial<Record<'vertical' | 'horizontal' | 'compact', { x: number; y: number }>>;
  lineageColor?: string;
}

export type UnionStatus = 'married' | 'divorced' | 'partners' | 'widowed';

export interface Union {
  id: string;
  partnerIds: [string, string];
  status: UnionStatus;
  marriageDate?: string;
  marriagePlace?: string;
  divorceDate?: string;
  verification: VerificationStatus;
  notes?: string;
  documents?: DocumentAttachment[];
}

export type ParentChildType = 'biological' | 'adoptive' | 'foster' | 'step';

export interface ParentChildLink {
  id: string;
  parentId: string;
  childId: string;
  relationType: ParentChildType;
  verification: VerificationStatus;
}

export interface TreeDocument {
  id: string;
  title: string;
  subtitle?: string;
  updatedAt: string;
  persons: Record<string, Person>;
  unions: Union[];
  parentChildLinks: ParentChildLink[];
  placeCoords?: Record<string, { lat: number; lng: number }>;
  archivePhotos?: PhotoAttachment[];
}

export type TreeViewMode = 'vertical' | 'horizontal';

export type AppWorkspaceTab = 'tree' | 'timeline' | 'photos' | 'map' | 'archive';

export interface AggregatedTimelineEvent {
  id: string;
  sortKey: number;
  year: number | null;
  dateDisplay: string;
  rawDate: string;
  category: EventType;
  title: string;
  place?: string;
  description?: string;
  verification: VerificationStatus;
  personId: string;
  personName: string;
  partnerId?: string;
  partnerName?: string;
  ageAtEvent?: string;
  sourceKind: 'birth' | 'death' | 'marriage' | 'divorce' | 'life_event';
  sourceEventId?: string;
  sourceUnionId?: string;
  documents?: DocumentAttachment[];
}
