import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentBoard — One Trigger. Full Context. Real Output.',
  description:
    'Agent-native project management: a multi-user Kanban platform where Claude automatically picks up agent-ready tasks, builds context, executes and delivers real output.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0c0e14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
