export const DIVISIONS = [
  'Social Media Management',
  'Content Delivery',
  'Ads Management',
  'Production'
] as const;

export const CATEGORIES = [
  'Client Meeting',
  'Internal Meeting',
  'Research',
  'Scripting',
  'Editing',
  'Revising Edit',
  'Scheduling and Captioning',
  'Shooting',
  'Research Deck Preparation',
  'Ideating Concepts',
  'Creator Recruitment',
  'Editor & Creator Briefing',
  'Data Analysis',
  'Audit',
  'Health Check',
  'Ad Copy',
  'Campaign Upload',
  'Monthly Reporting',
  'Client Comms',
  'Reviewing',
  'Other'
] as const;

export type Division = (typeof DIVISIONS)[number];
export type Category = (typeof CATEGORIES)[number];

export type Client = { id: number; name: string };

export type Creative = { id: number; name: string; clientId?: number };

export type Recent = {
  name: string;
  clientId?: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  lastUsed: number;
};

export type Running = {
  startedAt: number;
  name: string;
  clientId?: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  pausedAt?: number;
  accumulatedMs?: number;
} | null;
