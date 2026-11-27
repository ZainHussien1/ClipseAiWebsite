import {
  Bell,
  BellRing,
  ClipboardCheck,
  FileBarChart2,
  KanbanSquare,
  LayoutDashboard,
  Radio,
  Rss,
  Scissors,
  Settings,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavSection = 'Command' | 'Discover' | 'Work' | 'Insights' | 'Admin';

export type AppRoutePath =
  | '/'
  | '/live'
  | '/alerts'
  | '/feed'
  | '/rising'
  | '/sources'
  | '/work'
  | '/my-work'
  | '/clip-log'
  | '/reports'
  | '/notifications'
  | '/settings';

export interface NavItem {
  to: AppRoutePath;
  label: string;
  section: NavSection;
  icon: LucideIcon;
  description: string;
}

export const NAV_SECTIONS: NavSection[] = ['Command', 'Discover', 'Work', 'Insights', 'Admin'];

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Mission Control',
    section: 'Command',
    icon: LayoutDashboard,
    description: 'KPI strip, Needs Attention queue, Live Now rail, and provider health.',
  },
  {
    to: '/live',
    label: 'Live Now',
    section: 'Command',
    icon: Radio,
    description: 'Real-time live stream monitor and viewer/clip moment alerts.',
  },
  {
    to: '/alerts',
    label: 'Alerts',
    section: 'Command',
    icon: BellRing,
    description: 'Evidence-backed Rising, Live Moment, and VOD-ready alerts.',
  },
  {
    to: '/feed',
    label: 'Feed',
    section: 'Discover',
    icon: Rss,
    description: '3-lane creator upload & Shorts feed with saved views and drawer.',
  },
  {
    to: '/rising',
    label: 'Rising',
    section: 'Discover',
    icon: TrendingUp,
    description: 'Velocity & engagement breakout detector with hysteresis.',
  },
  {
    to: '/sources',
    label: 'Creators',
    section: 'Discover',
    icon: Users,
    description: 'Tracked YouTube, Twitch, and Kick creator channels.',
  },
  {
    to: '/work',
    label: 'Work Board',
    section: 'Work',
    icon: KanbanSquare,
    description: 'Team Kanban board from Hot unclaimed through Published.',
  },
  {
    to: '/my-work',
    label: 'My Work',
    section: 'Work',
    icon: ClipboardCheck,
    description: 'Filtered board of your claimed items and active edits.',
  },
  {
    to: '/clip-log',
    label: 'Clip Log',
    section: 'Work',
    icon: Scissors,
    description: 'Published clips, Our Channels, and manual vs API stats.',
  },
  {
    to: '/reports',
    label: 'Reports',
    section: 'Insights',
    icon: FileBarChart2,
    description: 'Daily report, source ROI, and accuracy scorecard.',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    section: 'Admin',
    icon: Bell,
    description: 'Notification inbox, quiet hours, hourly budget, Discord, and Web Push.',
  },
  {
    to: '/settings',
    label: 'Settings',
    section: 'Admin',
    icon: Settings,
    description: 'Integrations, members, Our Channels, export, and security.',
  },
];
