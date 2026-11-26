import {
  FileBarChart2,
  Home,
  Radio,
  Rss,
  Scissors,
  Settings,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavSection = 'WORKSPACE' | 'LIVE MODULE';

export interface NavItem {
  to: '/' | '/feed' | '/rising' | '/sources' | '/clips' | '/reports' | '/settings' | '/live';
  label: string;
  section: NavSection;
  icon: LucideIcon;
  badge?: string;
  phaseLabel: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    section: 'WORKSPACE',
    icon: Home,
    phaseLabel: 'Phase 1 active',
    description: 'System health, Cloudflare Access identity, and workspace status.',
  },
  {
    to: '/feed',
    label: 'Feed',
    section: 'WORKSPACE',
    icon: Rss,
    phaseLabel: 'Phase 2–3 pending',
    description: 'Unified creator upload & stream feed with first-seen latency stamps.',
  },
  {
    to: '/rising',
    label: 'Rising',
    section: 'WORKSPACE',
    icon: TrendingUp,
    phaseLabel: 'Phase 3 pending',
    description: 'Velocity & engagement breakout detector with hysteresis.',
  },
  {
    to: '/sources',
    label: 'Sources',
    section: 'WORKSPACE',
    icon: Users,
    phaseLabel: 'Phase 3 pending',
    description: 'Tracked YouTube, Twitch, and Kick creator channels.',
  },
  {
    to: '/clips',
    label: 'Clip Log',
    section: 'WORKSPACE',
    icon: Scissors,
    phaseLabel: 'Phase 5 pending',
    description: 'Claimed moments, published clips, and source ROI tracking.',
  },
  {
    to: '/reports',
    label: 'Reports',
    section: 'WORKSPACE',
    icon: FileBarChart2,
    phaseLabel: 'Phase 5 pending',
    description: 'Accuracy scorecard, daily rollups, and workspace exports.',
  },
  {
    to: '/settings',
    label: 'Settings',
    section: 'WORKSPACE',
    icon: Settings,
    phaseLabel: 'Phase 5 pending',
    description: 'Workspace members, notification rules, and integrations.',
  },
  {
    to: '/live',
    label: 'Live Now',
    section: 'LIVE MODULE',
    icon: Radio,
    badge: 'LIVE',
    phaseLabel: 'Phase 3–4 pending',
    description: 'Real-time live stream monitor and viewer/clip moment alerts.',
  },
];
