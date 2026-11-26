import {
  Bell,
  BellRing,
  ClipboardCheck,
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

export type AppRoutePath =
  | '/'
  | '/feed'
  | '/rising'
  | '/alerts'
  | '/sources'
  | '/my-work'
  | '/notifications'
  | '/clips'
  | '/reports'
  | '/settings'
  | '/live';

export interface NavItem {
  to: AppRoutePath;
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
    phaseLabel: 'Phase 3 active',
    description: 'Unified creator upload & stream feed with first-seen latency stamps.',
  },
  {
    to: '/rising',
    label: 'Rising',
    section: 'WORKSPACE',
    icon: TrendingUp,
    phaseLabel: 'Phase 3 active',
    description: 'Velocity & engagement breakout detector with hysteresis.',
  },
  {
    to: '/alerts',
    label: 'Alerts',
    section: 'WORKSPACE',
    icon: BellRing,
    phaseLabel: 'Phase 4 active',
    description: 'Evidence-backed Rising, Live Moment, and VOD-ready alerts with voting.',
  },
  {
    to: '/sources',
    label: 'Sources',
    section: 'WORKSPACE',
    icon: Users,
    phaseLabel: 'Phase 3 active',
    description: 'Tracked YouTube, Twitch, and Kick creator channels.',
  },
  {
    to: '/my-work',
    label: 'My Work',
    section: 'WORKSPACE',
    icon: ClipboardCheck,
    phaseLabel: 'Phase 3 active',
    description: 'Active item & time-range claims with optimistic workflow transitions.',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    section: 'WORKSPACE',
    icon: Bell,
    phaseLabel: 'Phase 4 active',
    description: 'Notification inbox, quiet hours, hourly budget, Discord, and Web Push.',
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
    phaseLabel: 'Phase 3 active',
    description: 'Real-time live stream monitor and viewer/clip moment alerts.',
  },
];
