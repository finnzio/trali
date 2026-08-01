import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const IS_MACOS = /Macintosh|Mac OS X/u.test(navigator.userAgent);

/** Flex spacer / chrome strip that is a native window drag region in Tauri. */
export function WindowDragRegion({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  if (!isTauri() || IS_MACOS) {
    return (
      <div
        className={cn("min-h-8 min-w-0 flex-1 select-none", className)}
        aria-hidden={children == null ? true : undefined}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-tauri-drag-region
      className={cn("min-h-8 min-w-0 flex-1 select-none", className)}
      aria-hidden={children == null ? true : undefined}
    >
      {children}
    </div>
  );
}

/** Minimize / maximize / close buttons; only rendered inside Tauri. */
export function WindowControls({ className }: { className?: string }) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri() || IS_MACOS) return;

    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void appWindow.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });

    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then((value) => {
          if (!cancelled) setMaximized(value);
        });
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!isTauri() || IS_MACOS) return null;

  const appWindow = getCurrentWindow();

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-md"
        onClick={() => void appWindow.minimize()}
        aria-label={t("minimizeWindow")}
      >
        <MinusIcon className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-md"
        onClick={() => void appWindow.toggleMaximize()}
        aria-label={
          maximized ? t("restoreWindow") : t("maximizeWindow")
        }
      >
        {maximized ? (
          <CopyIcon className="size-3" />
        ) : (
          <SquareIcon className="size-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-md hover:bg-destructive/15 hover:text-destructive"
        onClick={() => void appWindow.close()}
        aria-label={t("closeWindow")}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
