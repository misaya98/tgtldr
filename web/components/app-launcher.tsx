"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Bootstrap } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui";

function resolveEntryRoute(bootstrap: Bootstrap) {
  if (!bootstrap.passwordConfigured) {
    return "/setup";
  }
  if (!bootstrap.authenticated) {
    return "/login";
  }
  if (!bootstrap.settingsConfigured) {
    return "/setup";
  }
  if (!bootstrap.telegramAuthorized) {
    return "/setup";
  }
  return "/dashboard/summaries";
}

export function AppLauncher() {
  const router = useRouter();
  const { setLanguage } = useI18n();
  const [message, setMessage] = useState("正在检查当前状态...");
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const checkStatus = useCallback(async () => {
    setError(null);
    setRetrying(true);
    setMessage("正在连接服务并读取状态...");
    try {
      const bootstrap = await api.bootstrap();
      setLanguage(bootstrap.language);
      const target = resolveEntryRoute(bootstrap);
      if (target === "/setup") {
        setMessage("正在进入首次配置...");
      } else if (target === "/login") {
        setMessage("正在进入登录...");
      } else {
        setMessage("正在进入今日简报工作台...");
      }
      router.replace(target);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法连接后端服务或数据库异常";
      setError(msg);
      setMessage("后端服务连接失败");
    } finally {
      setRetrying(false);
    }
  }, [router, setLanguage]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  return (
    <main aria-busy={!error} className="app-launch">
      <div className="app-launch-shell">
        <p aria-hidden="true" className="app-launch-mark">
          TGTLDR
        </p>
        {!error ? (
          <p aria-live="polite" className="app-launch-status" role="status">
            {message}
          </p>
        ) : (
          <div className="app-launch-error" role="alert">
            <p className="app-launch-error-title">服务暂时不可达</p>
            <p className="app-launch-error-desc">{error}</p>
            <div className="app-launch-error-actions">
              <Button disabled={retrying} onClick={() => void checkStatus()} variant="primary">
                {retrying ? "正在重试..." : "重试连接"}
              </Button>
              <Button onClick={() => router.push("/setup")} variant="ghost">
                前往首次设置向导
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
