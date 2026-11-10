"use client";

import Link from "next/link";
import { CSSProperties, PropsWithChildren, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SWRConfig } from "swr";
import { StatusPill } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useBootstrap, useTasks } from "@/lib/hooks";
import { TaskCenterFlyout } from "@/components/task-center-flyout";

export function DashboardShell({ children }: PropsWithChildren) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        dedupingInterval: 5000,
      }}
    >
      <DashboardShellInner>{children}</DashboardShellInner>
    </SWRConfig>
  );
}

function DashboardShellInner({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();
  const { setLanguage } = useI18n();
  const { data: bootstrap } = useBootstrap();
  const { tasks, runningCount, failedCount, clearFinished, removeTask, refreshTasks } = useTasks();
  const [taskFlyoutOpen, setTaskFlyoutOpen] = useState(false);

  useEffect(() => {
    if (bootstrap) {
      setLanguage(bootstrap.language);
      if (bootstrap.passwordConfigured && !bootstrap.authenticated) {
        router.replace("/login");
      }
    }
  }, [bootstrap, router, setLanguage]);

  return (
    <div className="dashboard-canvas">
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar">
          <div className="dashboard-brand">
            <p className="dashboard-brand-mark">TGTLDR</p>
            <p className="dashboard-brand-copy">
              Too long, don't read. 为你每天节省时间。
            </p>
          </div>

          <nav
            className="nav-stack"
            style={{ "--active-nav-index": activeNavigationIndex(pathname) } as CSSProperties}
          >
            <span aria-hidden="true" className="nav-active-indicator" />
            {dashboardNavigation.map((item) => (
              <Link
                className={`nav-link ${isNavigationActive(pathname, item.href) ? "active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <span aria-hidden="true" className="nav-link-icon">
                  <NavigationIcon name={item.icon} />
                </span>
                <span className="nav-link-label">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* Ambient Task Center Button */}
          <div className="dashboard-sidebar-tasks">
            <button
              className={`sidebar-task-pill${runningCount > 0 ? " running" : failedCount > 0 ? " failed" : ""}`}
              onClick={() => setTaskFlyoutOpen(true)}
              type="button"
              title="查看后台任务进度"
            >
              <span className={`task-pulse-dot${runningCount > 0 ? " pulsing" : failedCount > 0 ? " alert" : ""}`} />
              <span className="task-pill-text">
                {runningCount > 0 ? `${runningCount} 个任务运行中` : failedCount > 0 ? `${failedCount} 个任务需关注` : "任务中心"}
              </span>
              {tasks.length > 0 && <span className="task-pill-count">{tasks.length}</span>}
            </button>
          </div>

          <div className="dashboard-sidebar-status">
            <div className="sidebar-status-item">
              <span>Telegram</span>
              <StatusPill tone={bootstrap?.telegramAuthorized ? "good" : "warn"}>
                {bootstrap?.telegramAuthorized ? "已连接" : "未连接"}
              </StatusPill>
            </div>
            <div className="sidebar-status-item">
              <span>Bot 推送</span>
              <StatusPill tone={bootstrap?.botEnabled ? "good" : "neutral"}>
                {bootstrap?.botEnabled ? "启用中" : "未启用"}
              </StatusPill>
            </div>
          </div>
        </aside>

        <div className="dashboard-main">
          <div className="dashboard-main-content" key={pathname}>
            {children}
          </div>
        </div>
      </div>

      <TaskCenterFlyout
        isOpen={taskFlyoutOpen}
        onClearFinished={clearFinished}
        onClose={() => setTaskFlyoutOpen(false)}
        onRefresh={() => void refreshTasks()}
        onRemoveTask={removeTask}
        tasks={tasks}
      />
    </div>
  );
}

const dashboardNavigation = [
  { href: "/dashboard/summaries", label: "今日简报", icon: "summaries" },
  { href: "/dashboard/chats", label: "消息与证据", icon: "chats" },
  { href: "/dashboard/settings", label: "信源与系统", icon: "settings" },
] as const;

function activeNavigationIndex(pathname: string) {
  const index = dashboardNavigation.findIndex((item) =>
    isNavigationActive(pathname, item.href)
  );
  return index < 0 ? 0 : index;
}

function isNavigationActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationIcon({ name }: { name: (typeof dashboardNavigation)[number]["icon"] }) {
  if (name === "chats") {
    return (
      <svg fill="none" viewBox="0 0 24 24">
        <path d="M7 18.5 3.5 21v-14A3.5 3.5 0 0 1 7 3.5h10A3.5 3.5 0 0 1 20.5 7v6A3.5 3.5 0 0 1 17 16.5H9.5L7 18.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M8 9.5h8M8 12.5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (name === "summaries") {
    return (
      <svg fill="none" viewBox="0 0 24 24">
        <path d="M7 3.5h8.5L20 8v12.5H7a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M15 3.5V8h5M8 12h8M8 15.5h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M9 5.5v3M15 10.5v3M11 15.5v3" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}
