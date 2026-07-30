import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

function Kbd({
  className,
  ...props
}: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 font-sans text-[11px] font-medium text-muted-foreground shadow-[0_1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

function ShortcutKeys({
  shortcut,
  className,
}: {
  shortcut: string;
  className?: string;
}) {
  const isMac = /Macintosh|Mac OS X/u.test(navigator.userAgent);
  const labels: Record<string, string> = {
    CommandOrControl: isMac ? "⌘" : "Ctrl",
    CmdOrCtrl: isMac ? "⌘" : "Ctrl",
    Control: isMac ? "⌃" : "Ctrl",
    Super: isMac ? "⌘" : "Win",
    Shift: "Shift",
    Alt: isMac ? "⌥" : "Alt",
    Space: "Space",
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {shortcut.split("+").map((key, index) => (
        <Kbd key={`${key}-${index}`}>{labels[key] ?? key}</Kbd>
      ))}
    </span>
  );
}

export { Kbd, ShortcutKeys };
