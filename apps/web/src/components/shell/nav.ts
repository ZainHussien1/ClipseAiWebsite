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
  | '/clip-log'
  | '/reports'
  | '/settings'
  | '/live';

export interface NavItem {
  to: AppRoutePath;
  label: string;
  section: NavSection;
  icon: LucideIcon;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    section: 'WORKSPACE',
    icon: Home,
    description: 'System health, Access identity, and workspace status.',
  },
  {
    to: '/feed',
    label: 'Feed',
    section: 'WORKSPACE',
    icon: Rss,
    description: 'Unified creator upload & stream feed with first-seen latency stamps.',
  },
  {
    to: '/rising',
    label: 'Rising',
    section: 'WORKSPACE',
    icon: TrendingUp,
    description: 'Velocity & engagement breakout detector with hysteresis.',
  },
  {
    to: '/alerts',
    label: 'Alerts',
    section: 'WORKSPACE',
    icon: BellRing,
    description: 'Evidence-backed Rising, Live Moment, and VOD-ready alerts with voting.',
  },
  {
    to: '/sources',
    label: 'Sources',
    section: 'WORKSPACE',
    icon: Users,
    description: 'Tracked YouTube, Twitch, and Kick creator channels.',
  },
  {
    to: '/my-work',
    label: 'My Work',
    section: 'WORKSPACE',
    icon: ClipboardCheck,
    description: 'Active item & time-range claims with optimistic workflow transitions.',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    section: 'WORKSPACE',
    icon: Bell,
    description: 'Notification inbox, quiet hours, hourly budget, Discord, and Web Push.',
  },
  {
    to: '/clip-log',
    label: 'Clip Log',
    section: 'WORKSPACE',
    icon: Scissors,
    description: 'Claimed moments, published clips, Our Channels, and manual vs API stats.',
  },
  {
    to: '/reports',
    label: 'Reports',
    section: 'WORKSPACE',
    icon: FileBarChart2,
    description: 'Daily report, source ROI, and accuracy scorecard.',
  },
  {
    to: '/settings',
    label: 'Settings',
    section: 'WORKSPACE',
    icon: Settings,
    description: 'Workspace members, JSON/CSV export, and atomic workspace deletion.',
  },
  {
    to: '/live',
    label: 'Live Now',
    section: 'LIVE MODULE',
    icon: Radio,
    description: 'Real-time live stream monitor and viewer/clip moment alerts.',
  },
];
