import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-border-strong bg-surface px-4 py-3",
        "text-sm leading-normal text-text placeholder:text-text-subtle",
        "transition-[border-color] duration-fast ease-out",
        "hover:border-iron",
        "focus-visible:border-text focus-visible:outline-hidden",
        "disabled:cursor-not-allowed disabled:opacity-55",
        "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error-bg",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
